import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import {
  autoAssignLeads,
  isAutoAssignEnabled,
  type AutoAssignOutcome,
} from "@/lib/leads/auto-assign";
import { buildNewLeadRow } from "@/lib/leads/create";
import {
  activeImportColumns,
  findMissingChoiceLabels,
  toImportCustomValues,
} from "@/lib/leads/import-custom-values";
import { findExistingLeadMatches } from "@/lib/leads/import-existing";
import { readFirstSheet } from "@/lib/leads/import-read";
import {
  createMissingChoiceOptions,
  fetchActiveAccounts,
  fetchImportCandidates,
} from "@/lib/leads/import-server";
import {
  cellText,
  LEAD_IMPORT_CUSTOM_FIELDS,
  LEAD_IMPORT_TEMPLATE,
  matchTemplateHeaders,
  parseTemplateRows,
  resolveImportAgent,
  type ImportAgentResolution,
  type ImportRowNote,
  type TemplateLead,
} from "@/lib/leads/import-template";
import type {
  LeadImportPreview,
  LeadImportPreviewRow,
  LeadImportResult,
  UnmatchedImportAgent,
} from "@/lib/leads/import-types";
import { partitionImportRows } from "@/lib/leads/import-validate";
import { fetchDefaultLeadStatusId } from "@/lib/leads/queries";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import {
  isLeadProduct,
  normalizeLeadProducts,
  UNKNOWN_LEAD_PRODUCT,
  type LeadProduct,
} from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchTaskAgents } from "@/lib/tasks/assignees";
import { broadcastTableConfigInvalidation } from "@/lib/table-config/realtime";
import type { TableColumnOption } from "@/lib/table-config/types";
import {
  fetchWriteValidationContext,
  TableConfigUnavailableError,
} from "@/lib/table-config/write-context";

export const dynamic = "force-dynamic";

// Vercel chặn body trên 4.5 MB trước khi request tới route (cùng lý do trần
// đính kèm là 4 MB). Một file CSV 2.000 dòng chỉ khoảng 300 KB.
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 2000;
const PREVIEW_ROWS = 10;
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
  // PostgREST đặt bộ lọc trên query string. 2.000 số là khoảng 24 KB — vượt
  // giới hạn URL phổ biến của proxy/gateway (8–16 KB), nên hỏi theo lô.
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

function parseExcludedRows(raw: FormDataEntryValue | null): Set<number> {
  try {
    const parsed: unknown = JSON.parse(String(raw ?? "[]"));
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is number => Number.isSafeInteger(value))
        : [],
    );
  } catch {
    return new Set();
  }
}

function agentLabel(resolution: ImportAgentResolution | null): LeadImportPreviewRow["agent"] {
  if (!resolution) return { status: "none", label: null };
  switch (resolution.status) {
    case "matched":
    case "not-agent":
      return { status: resolution.status, label: resolution.name };
    case "ambiguous":
      return { status: "ambiguous", label: resolution.candidates.join(" / ") };
    case "not-found":
      return { status: "not-found", label: null };
  }
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const actorEmail = actor.email.trim().toLowerCase();

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That file is larger than 4 MB." }, { status: 400 });
  const dryRun = String(form.get("dry_run") ?? "") === "true";

  // Product cho cả file, chọn nhiều (`products` = JSON mảng). Không chọn =
  // chưa biết khách quan tâm gì = Unknown. Insurance Needs là một cột riêng giữ
  // đúng dữ liệu, KHÔNG suy ra product (user chốt 2026-10-03).
  let products: LeadProduct[];
  const rawProducts = form.get("products");
  if (rawProducts !== null) {
    let parsedProducts: unknown;
    try {
      parsedProducts = JSON.parse(String(rawProducts));
    } catch {
      parsedProducts = null;
    }
    if (!Array.isArray(parsedProducts) || !parsedProducts.every(isLeadProduct)) {
      return NextResponse.json({ error: "Invalid product." }, { status: 400 });
    }
    products = normalizeLeadProducts(parsedProducts);
  } else {
    const rawProduct = String(form.get("product") ?? "").trim();
    if (rawProduct !== "" && !isLeadProduct(rawProduct)) {
      return NextResponse.json({ error: "Invalid product." }, { status: 400 });
    }
    products = [isLeadProduct(rawProduct) ? rawProduct : UNKNOWN_LEAD_PRODUCT];
  }
  /** Product chính — dùng cho vòng chia tự động (mỗi product một pool). */
  const product: LeadProduct = products[0];
  const rawEventId = String(form.get("event_id") ?? "").trim();
  const eventId = rawEventId || null;
  if (eventId && !UUID_RE.test(eventId)) return NextResponse.json({ error: "The event is not valid." }, { status: 400 });
  const excludedByUser = parseExcludedRows(form.get("exclude_rows"));

  let sheet;
  try {
    sheet = readFirstSheet(await file.arrayBuffer());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That file could not be read." },
      { status: 400 },
    );
  }
  if (sheet.records.length > MAX_ROWS) {
    return NextResponse.json({ error: `That file has ${sheet.records.length} rows; the limit is ${MAX_ROWS}.` }, { status: 400 });
  }
  const headerMatch = matchTemplateHeaders(sheet.headers);
  if (Object.keys(headerMatch.headerByField).length === 0) {
    return NextResponse.json(
      {
        error: `This file does not use the lead import template. Expected columns: ${LEAD_IMPORT_TEMPLATE.map((column) => column.header).join(", ")}.`,
      },
      { status: 400 },
    );
  }
  const parsed = parseTemplateRows(sheet.records, sheet.rowNumbers, headerMatch.headerByField);

  const supabase = getSupabaseAdmin();
  if (eventId) {
    const { data: event, error: eventError } = await supabase
      .from("lead_events")
      .select("id")
      .eq("id", eventId)
      .is("archived_at", null)
      .maybeSingle();
    if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });
    if (!event) return NextResponse.json({ error: "That event is no longer available." }, { status: 400 });
  }

  const loadContext = () =>
    fetchWriteValidationContext(
      {
        scope: "lead",
        mode: "create",
        touchedSystemKeys: ["full_name", "phone", "email", "fub", "product", "event"],
        touchedCustomKeys: LEAD_IMPORT_CUSTOM_FIELDS,
        submittedCustomValues: {},
      },
      supabase,
    );

  let context;
  let candidates;
  let accounts;
  let agents;
  try {
    [context, candidates, accounts, agents] = await Promise.all([
      loadContext(),
      fetchImportCandidates(supabase),
      fetchActiveAccounts(supabase),
      // Danh sách Agent ở Account Management → Agent membership — cùng nguồn Task CS.
      fetchTaskAgents(),
    ]);
  } catch (error) {
    if (error instanceof TableConfigUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not prepare the import." },
      { status: 500 },
    );
  }

  // Cột của mẫu chưa có trong Table Config thì dữ liệu cột đó không vào — nói ra.
  const importColumns = activeImportColumns(context.columns);
  const ignoredColumns = LEAD_IMPORT_CUSTOM_FIELDS.filter(
    (field) => headerMatch.headerByField[field] && !importColumns.has(field),
  ).map((field) => headerMatch.headerByField[field] as string);

  // Khách cũ: dò TRƯỚC khi bỏ dòng nào, để preview hiện đủ.
  const existingClients = findExistingLeadMatches(parsed.rows, candidates.leads, eventId);
  const blockedRows = new Set(
    existingClients.filter((match) => match.sameEventBlocked).map((match) => match.row),
  );
  // Server chỉ nhận tick bỏ trên dòng THẬT SỰ là khách cũ — một request méo
  // không được xoá dòng bất kỳ.
  const existingRows = new Set(existingClients.map((match) => match.row));
  const excludedRows = new Set(
    [...excludedByUser].filter((row) => existingRows.has(row) && !blockedRows.has(row)),
  );

  // Agent: khớp một lần cho mỗi tên.
  const agentAccounts = agents.map((agent) => ({
    email: agent.email.trim().toLowerCase(),
    name: agent.name,
  }));
  const resolutionByName = new Map<string, ImportAgentResolution>();
  for (const row of parsed.rows) {
    if (row.agentName && !resolutionByName.has(row.agentName)) {
      resolutionByName.set(row.agentName, resolveImportAgent(row.agentName, agentAccounts, accounts));
    }
  }
  const resolutionOf = (row: TemplateLead) =>
    row.agentName ? resolutionByName.get(row.agentName) ?? null : null;
  const unmatchedAgents: UnmatchedImportAgent[] = [];
  for (const [name, resolution] of resolutionByName) {
    if (resolution.status === "matched") continue;
    unmatchedAgents.push({
      name,
      status: resolution.status,
      accountName: resolution.status === "not-agent" ? resolution.name : null,
      candidates: resolution.status === "ambiguous" ? resolution.candidates : [],
      rows: parsed.rows.filter((row) => row.agentName === name).map((row) => row.row),
    });
  }

  // Lựa chọn chưa có thì TẠO ("có gì ghi nấy"). Dry run chỉ giả lập option để
  // bước kiểm bên dưới chạy y như import thật.
  const missingLabels = findMissingChoiceLabels(parsed.rows, context.columns, context.options);
  const optionsToCreate = missingLabels.flatMap(({ column, labels }) =>
    labels.map((label) => ({ column: column.label, label })),
  );
  let createdOptions: { column: string; label: string }[] = [];
  if (dryRun) {
    const synthetic: TableColumnOption[] = missingLabels.flatMap(({ column, labels }) =>
      labels.map((label, index) => ({
        id: `preview:${column.id}:${index}`,
        column_id: column.id,
        label,
        color: null,
        position: 0,
        archived_at: null,
      }) as TableColumnOption),
    );
    context = { ...context, options: [...context.options, ...synthetic] };
  } else if (missingLabels.length > 0) {
    try {
      createdOptions = await createMissingChoiceOptions(supabase, missingLabels);
      context = await loadContext();
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not add the new options." },
        { status: 500 },
      );
    }
  }

  const warnings: ImportRowNote[] = [...parsed.warnings];
  const candidatesForImport = parsed.rows
    .filter((row) => !blockedRows.has(row.row) && !excludedRows.has(row.row))
    .map((row) => {
      const converted = toImportCustomValues(row, context.columns, context.options);
      for (const reason of converted.warnings) warnings.push({ row: row.row, reason });
      return { ...row, custom_values: converted.values };
    });
  const partitioned = partitionImportRows(candidatesForImport, context, {
    optionalSystemKeys: ["phone"],
  });
  const skipped = [...parsed.skipped, ...partitioned.skipped].sort((a, b) => a.row - b.row);
  warnings.sort((a, b) => a.row - b.row);

  if (dryRun) {
    const preview: LeadImportPreview = {
      dryRun: true,
      totalRows: parsed.rows.length + parsed.skipped.length,
      importable: partitioned.valid.length,
      skipped,
      warnings,
      presentHeaders: LEAD_IMPORT_TEMPLATE.filter(
        (column) => headerMatch.headerByField[column.field],
      ).map((column) => column.header),
      missingHeaders: headerMatch.missingExpected,
      unknownHeaders: headerMatch.unknownHeaders,
      ignoredColumns,
      existingClients,
      existingCheckTruncated: candidates.truncated,
      unmatchedAgents,
      optionsToCreate,
      rowsWithoutPhone: parsed.rows.filter((row) => !row.phone).length,
      previewRows: parsed.rows.slice(0, PREVIEW_ROWS).map((row) => ({
        row: row.row,
        name: row.full_name,
        phone: row.phone,
        insuranceNeeds: cellText(row.customRaw.insurance_needs),
        agent: agentLabel(resolutionOf(row)),
        description: row.description,
      })),
    };
    return NextResponse.json(preview);
  }

  const result: LeadImportResult = {
    inserted: 0,
    duplicates: blockedRows.size,
    excluded: excludedRows.size,
    skipped,
    warnings,
    assignedFromFile: 0,
    unmatchedAgents,
    createdOptions,
    ignoredColumns,
    autoAssign: null,
  };
  const sourceId = readLeadMutationSourceId(request);
  if (createdOptions.length > 0) {
    after(async () => { await broadcastTableConfigInvalidation(["lead"]); });
  }
  if (partitioned.valid.length === 0) return NextResponse.json(result);

  // Lead import phải có status như lead tạo tay.
  const defaultStatusId = await fetchDefaultLeadStatusId(supabase);
  // Mỗi dòng mang một token riêng để nối id vừa chèn về đúng dòng — cần cho
  // bước gán theo cột Agent. Không dựa vào thứ tự RETURNING.
  const rowsWithToken = partitioned.valid.map((row) => ({ row, token: crypto.randomUUID() }));
  const newLeadRow = ({ row, token }: (typeof rowsWithToken)[number]) =>
    buildNewLeadRow({
      product,
      products,
      eventId,
      statusId: defaultStatusId,
      fullName: row.full_name,
      phone: row.phone,
      email: row.email,
      fubLink: row.fub_link,
      description: row.description,
      customValues: row.custom_values,
      actorEmail,
      clientRequestId: token,
    });

  const insertedIdByToken = new Map<string, string>();
  const insert = async (batch: typeof rowsWithToken) => {
    const { data, error } = await supabase
      .from("leads")
      .insert(batch.map(newLeadRow))
      .select("id,client_request_id");
    if (!error) {
      for (const row of (data ?? []) as { id: string; client_request_id: string }[]) {
        insertedIdByToken.set(row.client_request_id, row.id);
      }
    }
    return error;
  };
  try {
    const error = await insert(rowsWithToken);
    if (error) {
      // Một lượt import song song có thể chèn cùng số sau lần dò ở trên. Lọc các
      // số đã có trong event rồi thử lại MỘT lần, báo phần đó là trùng.
      if ((error as { code?: string }).code !== "23505") throw new Error(error.message);
      const taken = await findExistingPhones(
        supabase,
        eventId,
        rowsWithToken.flatMap(({ row }) => (row.phone ? [row.phone] : [])),
      );
      const retry = rowsWithToken.filter(({ row }) => !row.phone || !taken.has(row.phone));
      result.duplicates += rowsWithToken.length - retry.length;
      if (retry.length > 0) {
        const retryError = await insert(retry);
        if (retryError) throw new Error(retryError.message);
      }
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not import leads." },
      { status: 500 },
    );
  }
  result.inserted = insertedIdByToken.size;

  // Gán theo cột Agent — chỉ người nằm trong danh sách Agent ở Config. Hỏng
  // một người thì các lead đó nằm ở pool; lượt import đã thành công rồi.
  const idsByAgent = new Map<string, string[]>();
  const unassignedIds: string[] = [];
  for (const { row, token } of rowsWithToken) {
    const id = insertedIdByToken.get(token);
    if (!id) continue;
    const resolution = resolutionOf(row);
    if (resolution?.status === "matched") {
      idsByAgent.set(resolution.email, [...(idsByAgent.get(resolution.email) ?? []), id]);
    } else {
      unassignedIds.push(id);
    }
  }
  for (const [agentEmail, ids] of idsByAgent) {
    const { error } = await supabase.rpc("assign_leads_manual", {
      p_lead_ids: ids,
      p_to_email: agentEmail,
      p_actor_email: actorEmail,
      p_reason: "Imported: Agent column",
    });
    if (error) {
      console.error("lead.import.assign_failed", { agentEmail, count: ids.length, error: error.message });
      unassignedIds.push(...ids);
      continue;
    }
    result.assignedFromFile += ids.length;
  }

  // Chia tự động chỉ cho lead CHƯA có Agent, và chỉ khi admin bật toàn cục VÀ
  // người import tick ô — gán nhầm 2.000 lead phải gỡ bằng tay.
  const wantsAutoAssign = String(form.get("auto_assign") ?? "") === "true";
  if (wantsAutoAssign && unassignedIds.length > 0) {
    let outcome: AutoAssignOutcome;
    if (await isAutoAssignEnabled(product, supabase)) {
      try {
        outcome = await autoAssignLeads(unassignedIds, product, actorEmail, supabase);
      } catch (error) {
        outcome = {
          assigned: 0,
          unassigned: unassignedIds.length,
          reason: error instanceof Error ? error.message : "Could not distribute the new leads.",
        };
      }
    } else {
      outcome = {
        assigned: 0,
        unassigned: unassignedIds.length,
        reason: "Auto-assign is switched off in Lead Table Configuration.",
      };
    }
    result.autoAssign = outcome;
  }

  after(async () => { await broadcastLeadsChanged(sourceId); });
  return NextResponse.json(result);
}
