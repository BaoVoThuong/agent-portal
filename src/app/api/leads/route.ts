import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canWorkLeads } from "@/lib/leads/access";
import { fetchLeadsPage } from "@/lib/leads/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actor = buildLeadActor(session.user.permissions, email);
  if (!canWorkLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const { rows, total, filter } = await fetchLeadsPage(actor, params);
  return NextResponse.json({
    leads: rows,
    total,
    limit: filter.limit,
    offset: filter.offset,
  });
}
