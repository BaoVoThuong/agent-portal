import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { buildNewLeadRow } from "@/lib/leads/create";
import {
  activeImportColumns,
  findMissingChoiceLabels,
  toImportCustomValues,
} from "@/lib/leads/import-custom-values";
import { findEventIdByName, normalizeEventName, resolveEventByName } from "@/lib/leads/events";
import { EVENT_NOT_CREATED_YET, findExistingLeadMatches } from "@/lib/leads/import-existing";
import { readSpreadsheet } from "@/lib/leads/import-read";
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
import { isPersonalLeadEventName } from "@/lib/leads/lead-type";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
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

  // Lead type (2026-10-03): người import KHAI BÁO Personal hay Event; Event thì
  // gõ tên — tên đã có thì dùng event đó, chưa có thì Import thật tạo mới.
  // Preview chỉ tìm, không tạo. event_id vẫn nhận cho client cũ.
  const leadType = String(form.get("lead_type") ?? "").trim();
  if (leadType && leadType !== "event" && leadType !== "personal") {
    return NextResponse.json({ error: "Choose Personal lead or Event lead." }, { status: 400 });
  }
  const rawEventId = leadType ? "" : String(form.get("event_id") ?? "").trim();
  if (rawEventId && !UUID_RE.test(rawEventId)) return NextResponse.json({ error: "The event is not valid." }, { status: 400 });
  const typedEventName = leadType === "event" ? normalizeEventName(String(form.get("event_name") ?? "")) : "";
  if (leadType === "event") {
    // Preview chạy ngay khi chọn file (user chốt 2026-10-04) — chưa gõ tên event
    // vẫn xem trước được; chỉ Import thật mới bắt buộc tên.
    if (!typedEventName && !dryRun) return NextResponse.json({ error: "Type the event name." }, { status: 400 });
    if (typedEventName.length > 200) return NextResponse.json({ error: "The event name is too long." }, { status: 400 });
    if (isPersonalLeadEventName(typedEventName)) {
      return NextResponse.json(
        { error: "Personal leads have no event. Choose Personal lead instead." },
        { status: 400 },
      );
    }
  }
  const isPersonal = leadType === "personal" || (!leadType && !rawEventId);
  // Personal lead (2026-10-04): người import chọn MỘT Agent cho cả file; cột
  // Agent trong file bị bỏ qua. Client cũ không gửi thì giữ cách cũ (theo cột).
  const chosenAgentEmail = isPersonal
    ? String(form.get("agent_email") ?? "").trim().toLowerCase()
    : "";
  if (leadType === "personal" && !chosenAgentEmail && !dryRun) {
    return NextResponse.json({ error: "Choose the Agent these Personal leads belong to." }, { status: 400 });
  }
  const excludedByUser = parseExcludedRows(form.get("exclude_rows"));

  let sheet;
  try {
    // Nhiều sheet thì lấy sheet khớp mẫu cột nhiều nhất.
    sheet = readSpreadsheet(
      await file.arrayBuffer(),
      (headers) => Object.keys(matchTemplateHeaders(headers).headerByField).length,
    );
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
  // eventId null + !isPersonal = event gõ tên chưa có; chỉ tạo ngay trước khi
  // ghi lead, để lượt import không ghi được dòng nào không để lại event rỗng.
  let eventId: string | null = rawEventId || null;
  let eventName: string | null = typedEventName || null;
  if (typedEventName) {
    const found = await findEventIdByName(supabase, typedEventName);
    if (!found.ok) return NextResponse.json({ error: found.error }, { status: 500 });
    eventId = found.id;
  } else if (eventId) {
    const { data: event, error: eventError } = await supabase
      .from("lead_events")
      .select("id,name")
      .eq("id", eventId)
      .is("archived_at", null)
      .maybeSingle();
    if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });
    if (!event) return NextResponse.json({ error: "That event is no longer available." }, { status: 400 });
    eventName = event.name as string;
    if (isPersonalLeadEventName(event.name)) {
      return NextResponse.json(
        { error: "Personal leads do not have an Event pool. Import them without an Event and include an Agent." },
        { status: 400 },
      );
    }
  }

  const loadContext = () =>
    fetchWriteValidationContext(
      {
        scope: "lead",
        mode: "create",
        touchedSystemKeys: ["full_name", "phone", "email", "fub", "event"],
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
  const existingClients = findExistingLeadMatches(
    parsed.rows,
    candidates.leads,
    isPersonal ? null : eventId ?? EVENT_NOT_CREATED_YET,
  );
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
  let chosenAgent: ImportAgentResolution | null = null;
  if (chosenAgentEmail) {
    const agent = agentAccounts.find((candidate) => candidate.email === chosenAgentEmail);
    if (!agent) {
      return NextResponse.json(
        { error: "Choose one of the Agents in Account Management." },
        { status: 400 },
      );
    }
    chosenAgent = { status: "matched", email: agent.email, name: agent.name?.trim() || agent.email };
  }
  // Preview Personal lead chưa chọn Agent: coi như sẽ chọn — không báo dòng nào
  // bị bỏ vì thiếu Agent, vì cột Agent trong file không còn được dùng.
  const agentChosenLater = leadType === "personal" && !chosenAgent;
  const resolutionOf = (row: TemplateLead): ImportAgentResolution | null => {
    if (chosenAgent) return chosenAgent;
    if (agentChosenLater || !row.agentName) return null;
    return resolutionByName.get(row.agentName) ?? null;
  };
  const unmatchedAgents: UnmatchedImportAgent[] = [];
  for (const [name, resolution] of chosenAgent || agentChosenLater ? [] : resolutionByName) {
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
  // Không có Event = Personal lead. Mỗi dòng phải nêu một Agent đang hoạt động;
  // không âm thầm đưa Personal lead vào pool như Event lead.
  const personalAgentSkipped: ImportRowNote[] = isPersonal && !agentChosenLater
    ? partitioned.valid
        .filter((row) => resolutionOf(row)?.status !== "matched")
        .map((row) => ({
          row: row.row,
          reason: "Personal leads require an Agent from Account Management.",
        }))
    : [];
  const validRows = isPersonal && !agentChosenLater
    ? partitioned.valid.filter((row) => resolutionOf(row)?.status === "matched")
    : partitioned.valid;
  const skipped = [...parsed.skipped, ...partitioned.skipped, ...personalAgentSkipped]
    .sort((a, b) => a.row - b.row);
  warnings.sort((a, b) => a.row - b.row);

  if (dryRun) {
    const preview: LeadImportPreview = {
      dryRun: true,
      sheetName: sheet.sheetName,
      eventName: isPersonal ? null : eventName,
      eventIsNew: !isPersonal && Boolean(eventName) && eventId === null,
      totalRows: parsed.rows.length + parsed.skipped.length,
      importable: validRows.length,
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
      // Mọi dòng (tối đa MAX_ROWS) — dialog tự chia trang (user chốt 2026-10-04).
      previewRows: parsed.rows.map((row) => ({
        row: row.row,
        name: row.full_name,
        age: cellText(row.customRaw.age),
        gender: cellText(row.customRaw.gender),
        phone: row.phone,
        email: row.email,
        ticketNumber: cellText(row.customRaw.ticket_number),
        contactMethod: cellText(row.customRaw.contact_method),
        bestTimeToContact: cellText(row.customRaw.best_time_to_contact),
        insuranceNeeds: cellText(row.customRaw.insurance_needs),
        fubLink: row.fub_link,
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
  };
  const sourceId = readLeadMutationSourceId(request);
  if (createdOptions.length > 0) {
    after(async () => { await broadcastTableConfigInvalidation(["lead"]); });
  }
  if (validRows.length === 0) return NextResponse.json(result);

  if (!isPersonal && eventId === null) {
    // Tìm-hoặc-tạo: ai đó vừa tạo cùng tên thì dùng luôn event đó.
    const resolved = await resolveEventByName(supabase, typedEventName, actorEmail);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 500 });
    eventId = resolved.id;
  }

  // Lead import phải có status như lead tạo tay.
  const defaultStatusId = await fetchDefaultLeadStatusId(supabase);
  // Mỗi dòng mang một token riêng để nối id vừa chèn về đúng dòng — cần cho
  // bước gán theo cột Agent. Không dựa vào thứ tự RETURNING.
  const rowsWithToken = validRows.map((row) => ({ row, token: crypto.randomUUID() }));
  const newLeadRow = ({ row, token }: (typeof rowsWithToken)[number]) => {
    const agent = resolutionOf(row);
    return buildNewLeadRow({
      eventId,
      statusId: defaultStatusId,
      fullName: row.full_name,
      phone: row.phone,
      email: row.email,
      fubLink: row.fub_link,
      description: row.description,
      assignedToEmail:
        isPersonal && agent?.status === "matched"
          ? agent.email
          : null,
      customValues: row.custom_values,
      actorEmail,
      clientRequestId: token,
    });
  };

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

  // Personal lead đã có Agent ngay từ INSERT (DB ghi lịch sử cùng lúc). Event
  // lead mới dùng RPC ở đây vì chúng có thể nằm trong pool.
  if (isPersonal) {
    result.assignedFromFile = insertedIdByToken.size;
  } else {
  // Gán theo cột Agent — chỉ người nằm trong danh sách Agent ở Config. Hỏng
  // một người thì các lead đó nằm ở pool; lượt import đã thành công rồi.
  // KHÔNG tự chia lead không có Agent (bỏ 2026-10-04): chúng nằm trong pool
  // của Event, người quản lý bấm Distribute pool khi muốn chia.
  const idsByAgent = new Map<string, string[]>();
  for (const { row, token } of rowsWithToken) {
    const id = insertedIdByToken.get(token);
    if (!id) continue;
    const resolution = resolutionOf(row);
    if (resolution?.status === "matched") {
      idsByAgent.set(resolution.email, [...(idsByAgent.get(resolution.email) ?? []), id]);
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
      continue;
    }
    result.assignedFromFile += ids.length;
  }
  }

  after(async () => { await broadcastLeadsChanged(sourceId); });
  return NextResponse.json(result);
}
