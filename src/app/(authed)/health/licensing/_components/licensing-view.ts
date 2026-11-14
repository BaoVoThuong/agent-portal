import type { LicensingAppointment, LicensingProduct, LicensingStatus } from "@/lib/health-licensing/types";

export type MapFill = "active" | "pending" | "none";

export type LicensingFilters = {
  /** Ô tìm: chuỗi con của tên hãng, hoặc mã / tên bang. */
  query: string;
  states: string[];
  products: string[];
  carriers: string[];
  statuses: LicensingStatus[];
  /** account id */
  agents: string[];
  // products = columnId của cột sản phẩm.
};

export const DEFAULT_FILTERS: LicensingFilters = {
  query: "",
  states: [],
  products: [],
  carriers: [],
  statuses: ["active", "pending"],
  agents: [],
};

function sameStatuses(a: readonly LicensingStatus[], b: readonly LicensingStatus[]) {
  return a.length === b.length && a.every((s) => b.includes(s));
}

/** Số bộ lọc khác mặc định (cho nút Filters trên điện thoại và "Clear all"). */
export function activeFilterCount(f: LicensingFilters): number {
  return (
    [f.states, f.products, f.carriers, f.agents].filter((list) => list.length > 0).length +
    (sameStatuses(f.statuses, DEFAULT_FILTERS.statuses) ? 0 : 1)
  );
}

type Ctx = { activeProducts: ReadonlySet<string>; stateNames: Readonly<Record<string, string>> };
// activeProducts = columnId của các sản phẩm đang hoạt động.

function productOk(a: LicensingAppointment, f: LicensingFilters, ctx: Ctx) {
  return ctx.activeProducts.has(a.columnId) && (f.products.length === 0 || f.products.includes(a.columnId));
}

function statusOk(a: LicensingAppointment, f: LicensingFilters) {
  return f.statuses.length === 0 || f.statuses.includes(a.status);
}

/** Hãng / agent / bang / ô tìm — các bộ lọc "chọn ra" appointment trong một ô. */
export function narrowMatches(a: LicensingAppointment, f: LicensingFilters, ctx: Ctx): boolean {
  if (f.states.length && !f.states.includes(a.stateCode)) return false;
  if (f.carriers.length && !f.carriers.includes(a.carrier)) return false;
  if (f.agents.length && !a.agents.some((x) => f.agents.includes(x.accountId))) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const stateName = (ctx.stateNames[a.stateCode] ?? "").toLowerCase();
    if (!a.carrier.toLowerCase().includes(q) && a.stateCode.toLowerCase() !== q && !stateName.includes(q)) return false;
  }
  return true;
}

export function isNarrowed(f: LicensingFilters): boolean {
  return Boolean(f.query.trim() || f.states.length || f.carriers.length || f.agents.length);
}

function context(products: readonly LicensingProduct[], stateNames: Readonly<Record<string, string>>): Ctx {
  return { activeProducts: new Set(products.map((p) => p.columnId)), stateNames };
}

/**
 * Màu bang. Terminated không bao giờ tô. Khi đang lọc hãng / agent / bang / tìm,
 * bang không còn appointment nào khớp thì mờ đi.
 */
export function stateFills(
  appointments: readonly LicensingAppointment[],
  products: readonly LicensingProduct[],
  f: LicensingFilters,
  stateNames: Readonly<Record<string, string>>,
): Map<string, { fill: MapFill; dim: boolean }> {
  const ctx = context(products, stateNames);
  const narrowed = isNarrowed(f);
  const out = new Map<string, { fill: MapFill; dim: boolean }>();
  const rank = (x: MapFill) => (x === "active" ? 2 : x === "pending" ? 1 : 0);
  for (const a of appointments) {
    if (a.status === "terminated" || !productOk(a, f, ctx) || !statusOk(a, f)) continue;
    const cur = out.get(a.stateCode) ?? { fill: "none" as MapFill, dim: narrowed };
    if (narrowMatches(a, f, ctx)) {
      cur.dim = false;
      if (rank(a.status as MapFill) > rank(cur.fill)) cur.fill = a.status as MapFill;
    }
    out.set(a.stateCode, cur);
  }
  return out;
}

/** Appointment hiện trong ô của bảng: đúng sản phẩm + trạng thái. */
export function visibleAppointments(
  appointments: readonly LicensingAppointment[],
  products: readonly LicensingProduct[],
  f: LicensingFilters,
  stateNames: Readonly<Record<string, string>>,
): LicensingAppointment[] {
  const ctx = context(products, stateNames);
  return appointments.filter((a) => productOk(a, f, ctx) && statusOk(a, f));
}

/** Bang có dòng trong bảng: có ít nhất một appointment hiện và khớp các bộ lọc chọn. */
export function tableStates(
  visible: readonly LicensingAppointment[],
  products: readonly LicensingProduct[],
  f: LicensingFilters,
  stateNames: Readonly<Record<string, string>>,
): string[] {
  const ctx = context(products, stateNames);
  const states = new Set(visible.filter((a) => narrowMatches(a, f, ctx)).map((a) => a.stateCode));
  return [...states].sort((a, b) => (stateNames[a] ?? a).localeCompare(stateNames[b] ?? b));
}

/** Cột Carriers trên bản đồ: mỗi hãng có ở bao nhiêu bang, theo các bộ lọc trừ hãng và ô tìm. */
export function carrierCounts(
  appointments: readonly LicensingAppointment[],
  products: readonly LicensingProduct[],
  f: LicensingFilters,
  stateNames: Readonly<Record<string, string>>,
) {
  const ctx = context(products, stateNames);
  const base: LicensingFilters = { ...f, carriers: [], query: "" };
  const map = new Map<string, Set<string>>();
  for (const a of appointments) {
    if (a.status === "terminated" || !productOk(a, base, ctx) || !statusOk(a, base) || !narrowMatches(a, base, ctx)) continue;
    const set = map.get(a.carrier) ?? new Set<string>();
    set.add(a.stateCode);
    map.set(a.carrier, set);
  }
  return [...map.entries()]
    .map(([carrier, states]) => ({ carrier, states: states.size }))
    .sort((a, b) => b.states - a.states || a.carrier.localeCompare(b.carrier));
}

export function formatDay(value: string | null): string {
  if (!value) return "";
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const STATUS_LABEL: Record<LicensingStatus, string> = {
  active: "Active",
  pending: "Pending",
  terminated: "Terminated",
};
