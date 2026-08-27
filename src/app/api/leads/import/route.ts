import { after, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads } from "@/lib/leads/access";
import { parseLeadRows, type LeadColumnMapping } from "@/lib/leads/import-parse";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import { isLeadProduct, toLeadProduct } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ExistingPhoneRow = { phone: string | null };

async function findExistingPhones(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  eventId: string | null,
  phones: string[]
): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  let query = supabase
    .from("leads")
    .select("phone")
    .in("phone", phones)
    .is("archived_at", null);
  query = eventId === null ? query.is("event_id", null) : query.eq("event_id", eventId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return new Set((data as ExistingPhoneRow[] | null ?? []).flatMap((row) => row.phone ? [row.phone] : []));
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email);
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That file is larger than 5 MB." }, { status: 400 });

  let mapping: LeadColumnMapping;
  try {
    const parsed = JSON.parse(String(form.get("mapping") ?? "")) as Record<string, unknown>;
    mapping = {
      full_name: typeof parsed.full_name === "string" ? parsed.full_name : undefined,
      phone: typeof parsed.phone === "string" ? parsed.phone : "",
      email: typeof parsed.email === "string" ? parsed.email : undefined,
    };
  } catch {
    return NextResponse.json({ error: "Column mapping is missing." }, { status: 400 });
  }
  if (!mapping.phone) return NextResponse.json({ error: "Choose which column holds the phone number." }, { status: 400 });

  const rawProduct = form.get("product");
  if (!isLeadProduct(rawProduct)) return NextResponse.json({ error: "Unknown product." }, { status: 400 });
  const product = toLeadProduct(rawProduct);
  const rawEventId = String(form.get("event_id") ?? "").trim();
  const eventId = rawEventId || null;
  if (eventId && !UUID_RE.test(eventId)) return NextResponse.json({ error: "The event is not valid." }, { status: 400 });

  let records: Record<string, unknown>[];
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return NextResponse.json({ error: "That file has no sheets." }, { status: 400 });
    records = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null });
  } catch {
    return NextResponse.json({ error: "That file could not be read as an Excel workbook." }, { status: 400 });
  }
  if (records.length > MAX_ROWS) return NextResponse.json({ error: `That file has ${records.length} rows; the limit is ${MAX_ROWS}.` }, { status: 400 });

  const parsed = parseLeadRows(records, mapping);
  if (parsed.rows.length === 0) {
    return NextResponse.json({ inserted: 0, skipped: parsed.skipped, duplicates: 0 });
  }

  const supabase = getSupabaseAdmin();
  let remaining = parsed.rows;
  let inserted = 0;
  try {
    // The schema uses a partial active-row unique index, which cannot be named
    // as a PostgREST onConflict target. Pre-reading active phones lets us avoid
    // the invalid inference target and also reports duplicates honestly.
    const existingPhones = await findExistingPhones(supabase, eventId, remaining.map((row) => row.phone));
    remaining = remaining.filter((row) => !existingPhones.has(row.phone));
    if (remaining.length > 0) {
      const { data, error } = await supabase
        .from("leads")
        .insert(remaining.map((row) => ({
          product,
          event_id: eventId,
          full_name: row.full_name,
          phone: row.phone,
          email: row.email,
          custom_values: row.custom_values,
          created_by_email: actor.email.trim().toLowerCase(),
        })))
        .select("id");
      if (error) {
        // A concurrent import may win the race after the pre-read. Reconcile
        // once so a harmless race is reported as duplicates, not a false 500.
        const afterRace = await findExistingPhones(supabase, eventId, remaining.map((row) => row.phone));
        const retryRows = remaining.filter((row) => !afterRace.has(row.phone));
        if (retryRows.length === remaining.length) throw new Error(error.message);
        if (retryRows.length > 0) {
          const retry = await supabase.from("leads").insert(retryRows.map((row) => ({
            product, event_id: eventId, full_name: row.full_name, phone: row.phone,
            email: row.email, custom_values: row.custom_values,
            created_by_email: actor.email.trim().toLowerCase(),
          }))).select("id");
          if (retry.error) throw new Error(retry.error.message);
          inserted += retry.data?.length ?? 0;
        }
      } else {
        inserted += data?.length ?? 0;
      }
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not import leads." }, { status: 500 });
  }

  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId); });
  return NextResponse.json({
    inserted,
    duplicates: parsed.rows.length - inserted,
    skipped: parsed.skipped,
  });
}
