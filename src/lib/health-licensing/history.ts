import type { LicensingHistoryEntry } from "./types";

export type LicensingEventRow = {
  id: number;
  action: string;
  state_code: string | null;
  product_key: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
  actor_id: string | null;
};

type Snapshot = {
  carrier?: string;
  state_code?: string;
  product_key?: string;
  status?: string;
  appointed_on?: string | null;
  note?: string | null;
  agents?: Array<{ account_id: string; appointed_on?: string | null }>;
};

type ProductSnapshot = Array<{ key: string; label: string; is_active: boolean }>;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function fmtDate(value: string | null | undefined): string {
  if (!value) return "none";
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Diễn giải một dòng licensing_events thành câu hiển thị. Thuần: tên sản phẩm
 * và tên người đã nạp sẵn ở hai map.
 */
export function describeLicensingEvent(
  row: LicensingEventRow,
  ctx: { productLabel: (key: string) => string; personName: (id: string) => string | null },
): LicensingHistoryEntry {
  const base = {
    id: row.id,
    at: row.created_at,
    actorName: row.actor_id ? ctx.personName(row.actor_id) : null,
    stateCode: row.state_code,
  };

  if (row.action === "appointment.import") {
    const count = Number((row.after as { count?: unknown } | null)?.count ?? 0);
    const source = String((row.after as { source?: unknown } | null)?.source ?? "a file");
    return { ...base, summary: `imported ${count} appointments from ${source}`, carrier: null, changes: [] };
  }

  if (row.action === "products.update") {
    const before = (row.before ?? []) as unknown as ProductSnapshot;
    const after = (row.after ?? []) as unknown as ProductSnapshot;
    const changes: string[] = [];
    for (const p of after) {
      const old = before.find((b) => b.key === p.key);
      if (!old) changes.push(`Added column ${p.label}`);
      else {
        if (old.label !== p.label) changes.push(`Renamed ${old.label} to ${p.label}`);
        if (old.is_active !== p.is_active) changes.push(`${p.is_active ? "Showed" : "Hid"} ${p.label}`);
      }
    }
    const order = (list: ProductSnapshot) => list.filter((p) => before.some((b) => b.key === p.key)).map((p) => p.key).join();
    if (order(after) !== order(before)) changes.push("Changed the column order");
    return { ...base, summary: "changed the product columns", carrier: null, changes };
  }

  const snap = ((row.after ?? row.before ?? {}) as Snapshot);
  const carrier = snap.carrier ?? "a carrier";
  const where = `${ctx.productLabel(snap.product_key ?? row.product_key ?? "")} · ${snap.state_code ?? row.state_code ?? ""}`;

  if (row.action === "appointment.create") {
    const changes = [`Status: ${cap(snap.status ?? "active")}`];
    if (snap.agents?.length) changes.push(`Agents: ${agentNames(snap.agents, ctx).join(", ")}`);
    return { ...base, summary: `added ${carrier} · ${where}`, carrier, changes };
  }
  if (row.action === "appointment.delete") {
    return { ...base, summary: `removed ${carrier} · ${where}`, carrier, changes: [] };
  }

  const before = (row.before ?? {}) as Snapshot;
  const after = (row.after ?? {}) as Snapshot;
  const changes: string[] = [];
  if (before.carrier !== after.carrier || before.state_code !== after.state_code || before.product_key !== after.product_key) {
    changes.push(`Moved from ${before.carrier} · ${ctx.productLabel(before.product_key ?? "")} · ${before.state_code}`);
  }
  if (before.status !== after.status) changes.push(`Status: ${cap(before.status ?? "")} → ${cap(after.status ?? "")}`);
  if ((before.appointed_on ?? null) !== (after.appointed_on ?? null)) {
    changes.push(`Appointed on: ${fmtDate(before.appointed_on)} → ${fmtDate(after.appointed_on)}`);
  }
  if ((before.note ?? null) !== (after.note ?? null)) changes.push(after.note ? `Note: ${after.note}` : "Note removed");
  const beforeIds = new Set((before.agents ?? []).map((a) => a.account_id));
  const afterIds = new Set((after.agents ?? []).map((a) => a.account_id));
  const added = (after.agents ?? []).filter((a) => !beforeIds.has(a.account_id));
  const removed = (before.agents ?? []).filter((a) => !afterIds.has(a.account_id));
  if (added.length || removed.length) {
    changes.push(
      `Agents: ${[...agentNames(added, ctx).map((n) => `+ ${n}`), ...agentNames(removed, ctx).map((n) => `− ${n}`)].join(", ")}`,
    );
  }
  const datesChanged = (after.agents ?? []).some((a) => {
    const old = (before.agents ?? []).find((b) => b.account_id === a.account_id);
    return old && (old.appointed_on ?? null) !== (a.appointed_on ?? null);
  });
  if (datesChanged) changes.push("Changed agent dates");
  return { ...base, summary: `edited ${carrier} · ${where}`, carrier, changes };
}

function agentNames(
  agents: Array<{ account_id: string }>,
  ctx: { personName: (id: string) => string | null },
): string[] {
  return agents.map((a) => ctx.personName(a.account_id) ?? "Former account");
}
