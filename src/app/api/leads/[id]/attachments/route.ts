import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, isLeadViewAdmin } from "@/lib/leads/access";
import { resolveLeadCapabilities } from "@/lib/leads/capabilities";
import { isAssistantToLeadMember } from "@/lib/leads/membership";
import {
  attachmentTooLargeMessage,
  TASK_ATTACHMENT_MAX_BYTES,
  validateAttachmentFile,
} from "@/lib/tasks/attachments";
import {
  removeTaskFile,
  sanitizeFileName,
  signTaskFile,
  uploadTaskFile,
} from "@/lib/tasks/storage";
import { getSupabaseAdmin } from "@/lib/supabase";
import { RouteTiming } from "@/lib/server-timing";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
type AttachmentRow = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  storage_path: string;
  created_at: string;
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const COLUMNS = "id,file_name,mime_type,size_bytes,storage_path,created_at";

function measure<T>(
  timing: RouteTiming | undefined,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  return timing ? timing.measure(name, operation) : operation();
}

async function loadContext(id: string, timing?: RouteTiming) {
  const session = await measure(timing, "auth", async () => auth());
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized", status: 401 } as const;
  if (!UUID_RE.test(id)) return { error: "Invalid lead id.", status: 400 } as const;

  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  const supabase = getSupabaseAdmin();
  const { data: lead, error } = await measure(timing, "lead_scope", async () =>
    supabase
      .from("leads")
      .select("id,assigned_to_email,collaborator_emails")
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle(),
  );
  if (error) return { error: error.message, status: 500 } as const;
  if (!lead) return { error: "Not found", status: 404 } as const;
  const isOwnerOrAssistant = actor.isManager
    ? false
    : await measure(timing, "membership", async () =>
        isAssistantToLeadMember(
          lead.assigned_to_email,
          lead.collaborator_emails,
          email,
        ),
      );
  const capabilities = resolveLeadCapabilities(actor, lead, { isOwnerOrAssistant });
  if (!capabilities.canView) return { error: "Forbidden", status: 403 } as const;
  return { actor, capabilities, supabase } as const;
}

async function withSignedUrl(row: AttachmentRow) {
  return {
    id: row.id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    url: await signTaskFile(row.storage_path),
  };
}

export async function GET(_request: Request, { params }: Ctx) {
  const timing = new RouteTiming("lead-attachments");
  const respond = (
    body: unknown,
    status = 200,
    headers?: HeadersInit,
  ) => {
    const response = NextResponse.json(body, { status, headers });
    response.headers.set("Server-Timing", timing.headerValue());
    timing.log(status);
    return response;
  };
  const { id } = await params;
  const context = await loadContext(id, timing);
  if ("error" in context) {
    return respond({ error: context.error }, context.status);
  }
  const { data, error } = await timing.measure("file_rows", async () =>
    context.supabase
      .from("lead_attachments")
      .select(COLUMNS)
      .eq("lead_id", id)
      .order("created_at", { ascending: true }),
  );
  if (error) return respond({ error: error.message }, 500);
  try {
    const attachments = await timing.measure("file_sign", async () =>
      Promise.all(((data ?? []) as AttachmentRow[]).map(withSignedUrl)),
    );
    return respond(
      { attachments },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch {
    return respond({ error: "Could not load attachments." }, 500);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const context = await loadContext(id);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }
  if (!context.capabilities.canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.name || file.name.length > 255) {
    return NextResponse.json({ error: "Choose a valid file." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty files cannot be uploaded." }, { status: 400 });
  }
  if (file.size > TASK_ATTACHMENT_MAX_BYTES) {
    return NextResponse.json({ error: attachmentTooLargeMessage() }, { status: 400 });
  }
  const rawRequestId = form?.get("client_request_id");
  const requestId = typeof rawRequestId === "string" ? rawRequestId : null;
  if (requestId !== null && !UUID_RE.test(requestId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }
  const actorEmail = context.actor.email.trim().toLowerCase();
  if (requestId) {
    const { data: existing, error } = await context.supabase
      .from("lead_attachments")
      .select(COLUMNS)
      .eq("lead_id", id)
      .eq("uploaded_by", actorEmail)
      .eq("client_request_id", requestId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (existing) {
      return NextResponse.json({ attachment: await withSignedUrl(existing as AttachmentRow) });
    }
  }

  const { count, error: countError } = await context.supabase
    .from("lead_attachments")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", id);
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((count ?? 0) >= 50) {
    return NextResponse.json({ error: "A lead can have at most 50 files." }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const validation = validateAttachmentFile(file.name, bytes);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const path = `leads/${id}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
  try {
    await uploadTaskFile(path, bytes, validation.contentType);
    // Sign before writing metadata: a signing failure must not leave a row
    // pointing to a file the client cannot open or safely retry.
    const signedUrl = await signTaskFile(path);
    const { data, error } = await context.supabase
      .from("lead_attachments")
      .insert({
        lead_id: id,
        storage_path: path,
        file_name: file.name,
        mime_type: validation.contentType,
        size_bytes: file.size,
        uploaded_by: actorEmail,
        client_request_id: requestId,
      })
      .select(COLUMNS)
      .single();
    if (error || !data) {
      await removeTaskFile(path);
      if (requestId && error?.code === "23505") {
        const { data: winner } = await context.supabase
          .from("lead_attachments")
          .select(COLUMNS)
          .eq("lead_id", id)
          .eq("uploaded_by", actorEmail)
          .eq("client_request_id", requestId)
          .maybeSingle();
        if (winner) return NextResponse.json({ attachment: await withSignedUrl(winner as AttachmentRow) });
      }
      return NextResponse.json({ error: error?.message ?? "Could not save attachment." }, { status: 500 });
    }
    const attachment = data as AttachmentRow;
    return NextResponse.json({ attachment: {
      id: attachment.id,
      file_name: attachment.file_name,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
      created_at: attachment.created_at,
      url: signedUrl,
    } }, { status: 201 });
  } catch (error) {
    await removeTaskFile(path).catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not upload attachment." },
      { status: 500 },
    );
  }
}
