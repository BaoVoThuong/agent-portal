import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { readAllRowsById } from "@/lib/pagination/all-rows";
import { getSupabaseAdmin } from "@/lib/supabase";
import { formatEmailAsName } from "@/lib/tasks/people";
import { describeLicensingEvent, type LicensingEventRow } from "./history";
import type {
  LicensingAgentOption,
  LicensingAppointment,
  LicensingBoard,
  LicensingCarrierOption,
  LicensingHistoryEntry,
  LicensingProduct,
  LicensingStatus,
} from "./types";

const LICENSING_SCOPE = "licensing";
const HISTORY_PAGE_SIZE = 50;

type ColumnRow = { id: string; key: string; label: string; position: number };
type OptionRow = { id: string; column_id: string; label: string; color: string | null; position: number };
type AppointmentRow = {
  id: string;
  state_code: string;
  option_id: string;
  status: LicensingStatus;
  appointed_on: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
};
type AgentLinkRow = { id: string; appointment_id: string; account_id: string; appointed_on: string | null };
type AccountRow = { id: string; email: string; name: string | null };

function displayName(account: AccountRow): string {
  return account.name?.trim() || formatEmailAsName(account.email);
}

/** Tên của các account theo id (kể cả account đã tắt, để lịch sử vẫn có tên). */
async function fetchNames(ids: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const names = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await getSupabaseAdmin()
      .from(PORTAL_ACCOUNT_TABLE)
      .select("id,email,name")
      .in("id", unique.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as AccountRow[]) names.set(row.id, displayName(row));
  }
  return names;
}

/** Sản phẩm = cột multiselect đang hoạt động của bảng licensing. */
export async function fetchLicensingProducts(): Promise<LicensingProduct[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("table_column")
    .select("id,key,label,position")
    .eq("scope", LICENSING_SCOPE)
    .eq("type", "multiselect")
    .is("archived_at", null)
    .order("position")
    .order("label");
  if (error) throw new Error(error.message);
  return ((data ?? []) as ColumnRow[]).map((c) => ({ columnId: c.id, key: c.key, label: c.label, position: c.position }));
}

/** Hãng đang hoạt động của các sản phẩm. */
export async function fetchLicensingOptions(columnIds: readonly string[]): Promise<LicensingCarrierOption[]> {
  if (columnIds.length === 0) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("table_column_option")
    .select("id,column_id,label,color,position")
    .in("column_id", [...columnIds])
    .is("archived_at", null)
    .order("position")
    .order("label");
  if (error) throw new Error(error.message);
  return ((data ?? []) as OptionRow[]).map((o) => ({
    id: o.id,
    columnId: o.column_id,
    label: o.label,
    color: o.color,
    position: o.position,
  }));
}

/** Sản phẩm + hãng đang hoạt động, cho các route ghi. */
export async function fetchLicensingCatalog() {
  const products = await fetchLicensingProducts();
  const options = await fetchLicensingOptions(products.map((p) => p.columnId));
  const optionsByColumn = new Map<string, Set<string>>(products.map((p) => [p.columnId, new Set<string>()]));
  for (const option of options) optionsByColumn.get(option.columnId)?.add(option.id);
  return { products, options, optionsByColumn, optionIds: new Set(options.map((o) => o.id)) };
}

export async function loadLicensingBoard(): Promise<LicensingBoard> {
  const supabase = getSupabaseAdmin();
  const [catalog, appointmentsRead, linksRead, lastEventRead] = await Promise.all([
    fetchLicensingCatalog(),
    readAllRowsById<AppointmentRow>((afterId, pageSize, withCount) => {
      let query = supabase
        .from("licensing_appointments")
        .select(
          "id,state_code,option_id,status,appointed_on,note,created_at,created_by,updated_at,updated_by",
          withCount ? { count: "exact" } : undefined,
        )
        .is("deleted_at", null);
      if (afterId) query = query.gt("id", afterId);
      return query.order("id").limit(pageSize);
    }),
    readAllRowsById<AgentLinkRow>((afterId, pageSize, withCount) => {
      let query = supabase
        .from("licensing_appointment_agents")
        .select("id,appointment_id,account_id,appointed_on", withCount ? { count: "exact" } : undefined);
      if (afterId) query = query.gt("id", afterId);
      return query.order("id").limit(pageSize);
    }),
    supabase
      .from("licensing_events")
      .select("created_at,actor_id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (appointmentsRead.error) throw new Error(appointmentsRead.error.message);
  if (linksRead.error) throw new Error(linksRead.error.message);
  if (lastEventRead.error) throw new Error(lastEventRead.error.message);

  const optionById = new Map(catalog.options.map((o) => [o.id, o]));
  // Hãng hoặc sản phẩm đã archive ở Table Configuration: appointment ẩn khỏi trang.
  const rows = (appointmentsRead.data ?? []).filter((a) => optionById.has(a.option_id));
  const links = linksRead.data ?? [];
  const lastEvent = lastEventRead.data as { created_at: string; actor_id: string | null } | null;
  const names = await fetchNames([
    ...links.map((l) => l.account_id),
    ...(lastEvent?.actor_id ? [lastEvent.actor_id] : []),
    ...rows.flatMap((a) => [a.created_by, a.updated_by].filter((id): id is string => Boolean(id))),
  ]);

  const agentsByAppointment = new Map<string, LicensingAppointment["agents"]>();
  for (const link of links) {
    const list = agentsByAppointment.get(link.appointment_id) ?? [];
    list.push({
      accountId: link.account_id,
      name: names.get(link.account_id) ?? "Former account",
      appointedOn: link.appointed_on,
    });
    agentsByAppointment.set(link.appointment_id, list);
  }

  const productPosition = new Map(catalog.products.map((p, i) => [p.columnId, i]));
  const appointments: LicensingAppointment[] = rows
    .map((a) => {
      const option = optionById.get(a.option_id)!;
      return {
        id: a.id,
        stateCode: a.state_code,
        optionId: a.option_id,
        columnId: option.columnId,
        carrier: option.label,
        color: option.color,
        optionPosition: option.position,
        status: a.status,
        appointedOn: a.appointed_on,
        note: a.note,
        agents: (agentsByAppointment.get(a.id) ?? []).sort((x, y) => x.name.localeCompare(y.name)),
        createdAt: a.created_at,
        createdByName: a.created_by ? names.get(a.created_by) ?? "Former account" : null,
        updatedAt: a.updated_at,
        updatedByName: a.updated_by ? names.get(a.updated_by) ?? "Former account" : null,
      };
    })
    .sort(
      (x, y) =>
        x.stateCode.localeCompare(y.stateCode) ||
        (productPosition.get(x.columnId) ?? 0) - (productPosition.get(y.columnId) ?? 0) ||
        x.optionPosition - y.optionPosition ||
        x.carrier.localeCompare(y.carrier),
    );

  return {
    products: catalog.products,
    options: catalog.options,
    appointments,
    lastUpdate: lastEvent
      ? { at: lastEvent.created_at, actorName: lastEvent.actor_id ? names.get(lastEvent.actor_id) ?? null : null }
      : null,
  };
}

/** Account đang hoạt động có Position thuộc loại Agent. */
export async function fetchLicensingAgents(): Promise<LicensingAgentOption[]> {
  const supabase = getSupabaseAdmin();
  const { data: positions, error: positionError } = await supabase.from("positions").select("id").eq("kind", "agent");
  if (positionError) throw new Error(positionError.message);
  const positionIds = ((positions ?? []) as Array<{ id: string }>).map((p) => p.id);
  if (positionIds.length === 0) return [];

  const { data, error } = await supabase
    .from(PORTAL_ACCOUNT_TABLE)
    .select("id,email,name")
    .eq("is_active", true)
    .in("position_id", positionIds);
  if (error) throw new Error(error.message);
  return ((data ?? []) as AccountRow[])
    .map((row) => ({ accountId: row.id, name: displayName(row) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchAppointmentAgentIds(appointmentId: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("licensing_appointment_agents")
    .select("account_id")
    .eq("appointment_id", appointmentId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ account_id: string }>).map((r) => r.account_id);
}

/** Lịch sử mới nhất trước, 50 dòng một lần; `beforeId` = id nhỏ nhất của trang trước. */
export async function loadLicensingHistory(opts: {
  stateCode?: string | null;
  appointmentId?: string | null;
  beforeId?: number | null;
}): Promise<{ entries: LicensingHistoryEntry[]; nextBeforeId: number | null }> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("licensing_events")
    .select("id,action,state_code,product_key,before,after,created_at,actor_id")
    .order("id", { ascending: false })
    .limit(HISTORY_PAGE_SIZE + 1);
  if (opts.stateCode) query = query.eq("state_code", opts.stateCode);
  if (opts.appointmentId) query = query.eq("appointment_id", opts.appointmentId);
  if (opts.beforeId) query = query.lt("id", opts.beforeId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as LicensingEventRow[];
  const page = rows.slice(0, HISTORY_PAGE_SIZE);
  const personIds = new Set<string>();
  for (const row of page) {
    if (row.actor_id) personIds.add(row.actor_id);
    for (const snap of [row.before, row.after]) {
      const agents = (snap as { agents?: Array<{ account_id?: string }> } | null)?.agents;
      if (Array.isArray(agents)) for (const a of agents) if (a.account_id) personIds.add(a.account_id);
    }
  }
  // Nhãn sản phẩm theo key, kể cả cột đã archive (lịch sử cũ vẫn đọc được tên).
  const [names, columnsRead] = await Promise.all([
    fetchNames(personIds),
    supabase.from("table_column").select("key,label").eq("scope", LICENSING_SCOPE),
  ]);
  if (columnsRead.error) throw new Error(columnsRead.error.message);
  const labels = new Map(((columnsRead.data ?? []) as Array<{ key: string; label: string }>).map((c) => [c.key, c.label]));

  return {
    entries: page.map((row) =>
      describeLicensingEvent(row, {
        productLabel: (key) => labels.get(key) ?? key,
        personName: (id) => names.get(id) ?? null,
      }),
    ),
    nextBeforeId: rows.length > HISTORY_PAGE_SIZE ? page[page.length - 1].id : null,
  };
}
