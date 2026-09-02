import { after, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import {
  autoAssignLeads,
  isAutoAssignEnabled,
  type AutoAssignOutcome,
} from "@/lib/leads/auto-assign";
import { parseLeadRows, type LeadColumnMapping } from "@/lib/leads/import-parse";
import { partitionImportRows } from "@/lib/leads/import-validate";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import { isLeadProduct, type LeadProduct } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  fetchWriteValidationContext,
  TableConfigUnavailableError,
} from "@/lib/table-config/write-context";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ExistingPhoneRow = { phone: string | null };

/** Mỗi lượt hỏi tối đa ngần này số. Xem chú thích trong hàm. */
const PHONE_LOOKUP_CHUNK = 200;

async function findExistingPhones(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  eventId: string | null,
  phones: string[]
): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  const found = new Set<string>();
  // PostgREST đặt bộ lọc trên query string. MAX_ROWS cho phép 2.000 số, tức
  // khoảng 24 KB — vượt giới hạn URL phổ biến của proxy/gateway (8–16 KB). Một
  // lượt import đúng giới hạn UI mà hỏng ở tầng mạng thì thông báo lỗi chẳng
  // nói được gì hữu ích, và đó mới là phần tệ nhất. Hàm này còn được gọi HAI
  // lần mỗi lượt import (đọc trước, và đọc lại sau khi va chạm).
  for (let start = 0; start < phones.length; start += PHONE_LOOKUP_CHUNK) {
    const chunk = phones.slice(start, start + PHONE_LOOKUP_CHUNK);
    let query = supabase
      .from("leads")
      .select("phone")
      .in("phone", chunk)
      .is("archived_at", null);
    query = eventId === null ? query.is("event_id", null) : query.eq("event_id", eventId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    for (const row of (data as ExistingPhoneRow[] | null) ?? []) {
      if (row.phone) found.add(row.phone);
    }
  }
  return found;
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
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

  const rawProduct = String(form.get("product") ?? "").trim();
  const product: LeadProduct | null = rawProduct === ""
    ? null
    : isLeadProduct(rawProduct)
      ? rawProduct
      : null;
  if (rawProduct !== "" && !product) {
    return NextResponse.json({ error: "Unknown product." }, { status: 400 });
  }
  const rawEventId = String(form.get("event_id") ?? "").trim();
  const eventId = rawEventId || null;
  if (eventId && !UUID_RE.test(eventId)) return NextResponse.json({ error: "The event is not valid." }, { status: 400 });

  // Dùng chính id vừa chèn, KHÔNG truy vấn lại "lead chưa gán của event này":
  // truy vấn như thế sẽ nuốt cả lead cũ mà lượt import trước cố ý để lại pool.
  const insertedIds: string[] = [];
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

  // Cùng bộ luật với PATCH. Không có nó, cái admin đánh dấu "Required" chỉ có
  // tác dụng ở một nửa số cửa vào lead.
  let writeContext;
  try {
    writeContext = await fetchWriteValidationContext(
      {
        scope: "lead",
        mode: "create",
        touchedSystemKeys: ["full_name", "phone", "email", "product", "event"],
        touchedCustomKeys: [
          ...new Set(parsed.rows.flatMap((row) => Object.keys(row.custom_values))),
        ],
        submittedCustomValues: Object.assign(
          {},
          ...parsed.rows.map((row) => row.custom_values)
        ),
      },
      supabase
    );
  } catch (error) {
    if (error instanceof TableConfigUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  const partitioned = partitionImportRows(parsed.rows, writeContext);
  const skipped = [...parsed.skipped, ...partitioned.skipped].sort((a, b) => a.row - b.row);
  if (partitioned.valid.length === 0) {
    return NextResponse.json({
      inserted: 0,
      skipped,
      duplicates: 0,
      ignoredHeaders: partitioned.ignoredHeaders,
    });
  }

  let remaining = partitioned.valid;
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
          products: product ? [product] : [],
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
        if (retryRows.length === remaining.length) {
          // Với lead không thuộc event nào, `leads_phone_no_event_unique_idx`
          // mới là thứ chặn trùng — lượt đọc trước đó không thấy được dòng mà
          // một lượt import song song vừa chèn. Báo là trùng, không phải 500.
          if ((error as { code?: string }).code === "23505") {
            return NextResponse.json({
              inserted,
              duplicates: remaining.length,
              skipped,
              ignoredHeaders: partitioned.ignoredHeaders,
              autoAssign: null,
            });
          }
          throw new Error(error.message);
        }
        if (retryRows.length > 0) {
          const retry = await supabase.from("leads").insert(retryRows.map((row) => ({
            product, products: product ? [product] : [], event_id: eventId, full_name: row.full_name, phone: row.phone,
            email: row.email, custom_values: row.custom_values,
            created_by_email: actor.email.trim().toLowerCase(),
          }))).select("id");
          if (retry.error) throw new Error(retry.error.message);
          inserted += retry.data?.length ?? 0;
          for (const row of retry.data ?? []) insertedIds.push((row as { id: string }).id);
        }
      } else {
        inserted += data?.length ?? 0;
        for (const row of data ?? []) insertedIds.push((row as { id: string }).id);
      }
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not import leads." }, { status: 500 });
  }

  // Chia tự động chỉ chạy khi admin đã bật toàn cục VÀ người bấm import tick ô
  // trong dialog. Hai lớp vì đây là hành động khó lùi: gán nhầm 2.000 lead phải
  // gỡ bằng tay.
  const wantsAutoAssign = String(form.get("auto_assign") ?? "") === "true";
  let autoAssign: AutoAssignOutcome | null = null;
  if (wantsAutoAssign && insertedIds.length > 0) {
    if (!product) {
      // Không chọn product thì không có vòng xoay nào để chia. Lead vào pool
      // và chờ ai đó phân loại — không phải lỗi, chỉ là chưa đủ thông tin.
      autoAssign = {
        assigned: 0,
        unassigned: insertedIds.length,
        reason: "Pick a product to auto-assign these leads.",
      };
    } else if (await isAutoAssignEnabled(product, supabase)) {
      try {
        autoAssign = await autoAssignLeads(
          insertedIds,
          product,
          actor.email.trim().toLowerCase(),
          supabase
        );
      } catch (error) {
        // Import đã thành công rồi; lead nằm ở pool là hoàn toàn dùng được.
        // Làm hỏng cả lượt import vì bước chia là mất việc lớn vì việc nhỏ.
        autoAssign = {
          assigned: 0,
          unassigned: insertedIds.length,
          reason: error instanceof Error ? error.message : "Could not distribute the new leads.",
        };
      }
    } else {
      autoAssign = {
        assigned: 0,
        unassigned: insertedIds.length,
        reason: "Auto-assign is switched off in Lead Table Configuration.",
      };
    }
  }

  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId); });
  return NextResponse.json({
    inserted,
    // Đếm trên số hàng ĐÃ qua validation: hàng bị bỏ vì sai dữ liệu đã nằm ở
    // `skipped` kèm lý do rồi, gộp vào "trùng" là nói sai với người import.
    duplicates: partitioned.valid.length - inserted,
    skipped,
    ignoredHeaders: partitioned.ignoredHeaders,
    autoAssign,
  });
}
