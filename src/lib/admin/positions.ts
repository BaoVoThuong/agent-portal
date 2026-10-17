import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Positions an admin assigns in Account Manager (table `positions`).
 *
 * A Position says what someone does, never what they may do: permissions come
 * only from their Role. `kind` marks which Agent/Assistant facts a Position
 * stands for. Not to be confused with the task-side label in
 * lib/tasks/positions.ts (Admin / Agent / Assistant / Customer Service), which
 * is derived from permissions and membership.
 */
export const POSITION_KINDS = ["agent", "assistant", "cs", "other"] as const;
export type PositionKind = (typeof POSITION_KINDS)[number];

export const POSITION_KIND_LABELS: Record<PositionKind, string> = {
  agent: "Agent",
  assistant: "Assistant",
  cs: "Customer Service",
  other: "Other",
};

export type PositionHolder = {
  user_id: string;
  name: string | null;
  email: string;
  is_active: boolean;
};

export type PositionRecord = {
  id: string;
  name: string;
  kind: PositionKind;
  /** Set on the four seeded rows; those are never edited or deleted. */
  system_key: string | null;
  /** Every account holding it, disabled ones included. */
  holders: PositionHolder[];
};

/** The slice Account Manager needs to show and pick a Position. */
export type PositionOption = Pick<PositionRecord, "id" | "name" | "kind" | "system_key">;

const MAX_NAME_LENGTH = 80;

export function parsePositionInput(
  body: unknown,
): { ok: true; name: string; kind: PositionKind } | { ok: false; error: string } {
  const input = (body ?? {}) as { name?: unknown; kind?: unknown };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "Position name is required." };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Position name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  }
  const kind = input.kind;
  if (typeof kind !== "string" || !(POSITION_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "Choose a position group." };
  }
  return { ok: true, name, kind: kind as PositionKind };
}

/** Whether Role Manager may still rename, regroup or delete this Position. */
export function positionLockReason(position: Pick<PositionRecord, "system_key" | "holders">): string | null {
  if (position.system_key) return "Built-in position. It cannot be edited or deleted.";
  if (position.holders.length > 0) {
    return "Accounts hold this position. Move them to another position first.";
  }
  return null;
}

export function positionWriteFailure(error: { code?: string; message: string }): {
  status: 400 | 404 | 409 | 500;
  error: string;
} {
  if (error.message.includes("POSITION_NOT_FOUND")) {
    return { status: 404, error: "Position not found." };
  }
  if (error.message.includes("POSITION_SYSTEM")) {
    return { status: 400, error: "Built-in positions cannot be edited or deleted." };
  }
  // POSITION_IN_USE from update_unused_position; 23503 is the foreign key
  // from portal_account.position_id refusing a delete.
  if (error.message.includes("POSITION_IN_USE") || error.code === "23503") {
    return {
      status: 409,
      error: "Accounts hold this position. Move them to another position first.",
    };
  }
  if (error.code === "23505") {
    return { status: 409, error: "A position with this name already exists." };
  }
  return { status: 500, error: error.message };
}

type PositionRow = Pick<PositionRecord, "id" | "name" | "kind" | "system_key">;
type HolderRow = { id: string; name: string | null; email: string; is_active: boolean; position_id: string };

const SYSTEM_ORDER = ["agent", "assistant", "cs", "cs_manager"];

function comparePositions(a: PositionRow, b: PositionRow): number {
  const rank = (row: PositionRow) =>
    row.system_key ? SYSTEM_ORDER.indexOf(row.system_key) : SYSTEM_ORDER.length;
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}

export async function fetchPositionOptions(): Promise<PositionOption[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("positions")
    .select("id,name,kind,system_key");
  if (error) throw new Error(error.message);
  return ((data ?? []) as PositionRow[]).sort(comparePositions);
}

export async function fetchPositionsWithHolders(): Promise<PositionRecord[]> {
  const supabase = getSupabaseAdmin();
  const [positions, holders] = await Promise.all([
    fetchPositionOptions(),
    supabase
      .from("portal_account")
      .select("id,name,email,is_active,position_id")
      .not("position_id", "is", null),
  ]);
  if (holders.error) throw new Error(holders.error.message);

  const holdersByPosition = new Map<string, PositionHolder[]>();
  for (const row of (holders.data ?? []) as HolderRow[]) {
    const list = holdersByPosition.get(row.position_id) ?? [];
    list.push({ user_id: row.id, name: row.name, email: row.email, is_active: row.is_active });
    holdersByPosition.set(row.position_id, list);
  }

  return positions.map((position) => ({
    ...position,
    holders: (holdersByPosition.get(position.id) ?? []).sort((a, b) =>
      (a.name?.trim() || a.email).localeCompare(b.name?.trim() || b.email),
    ),
  }));
}
