import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, isLeadViewAdmin } from "@/lib/leads/access";
import { resolveLeadCapabilities } from "@/lib/leads/capabilities";
import { isLeadOwnerOrAssistant } from "@/lib/leads/membership";
import type { LeadRow } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMENT_COLUMNS =
  "id,lead_id,parent_id,author_email,body,client_request_id,created_at,updated_at,deleted_at";

async function loadAccess(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };

  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("leads")
    .select("id,assigned_to_email")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };

  const lead = data as Pick<LeadRow, "assigned_to_email">;
  const isOwnerOrAssistant = actor.isManager
    ? false
    : await isLeadOwnerOrAssistant(lead.assigned_to_email, email);
  const capabilities = resolveLeadCapabilities(actor, lead, {
    isOwnerOrAssistant,
  });
  return { actor, capabilities, supabase };
}

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 400 });
  }
  const access = await loadAccess(id);
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  if (!access.capabilities.canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await access.supabase
    .from("lead_comments")
    .select(COMMENT_COLUMNS)
    .eq("lead_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comments: data ?? [] });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 400 });
  }
  const access = await loadAccess(id);
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  if (!access.capabilities.canLog) {
    return NextResponse.json({ error: "This lead is not assigned to you." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Comment is empty." }, { status: 400 });
  if (text.length > 4000) {
    return NextResponse.json({ error: "Comment is too long." }, { status: 400 });
  }

  const parentId = typeof body?.parent_id === "string" && body.parent_id ? body.parent_id : null;
  if (parentId && !UUID_RE.test(parentId)) {
    return NextResponse.json({ error: "Invalid parent comment." }, { status: 400 });
  }
  const requestId =
    typeof body?.client_request_id === "string" && body.client_request_id
      ? body.client_request_id
      : null;
  if (requestId && !UUID_RE.test(requestId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

  const { data, error } = await access.supabase
    .rpc("create_lead_comment_atomic", {
      p_lead_id: id,
      p_author_email: access.actor.email,
      p_body: text,
      p_parent_id: parentId,
      p_client_request_id: requestId,
    })
    .single();
  if (error) {
    if (error.message.includes("LEAD_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (error.message.includes("INVALID_PARENT")) {
      return NextResponse.json({ error: "Invalid parent comment." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = data as {
    comment: unknown;
    lead_updated_at: string;
    was_created: boolean;
  };
  return NextResponse.json({
    comment: result.comment,
    lead_updated_at: result.lead_updated_at,
  });
}
