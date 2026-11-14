import { isUsStateCode } from "@/lib/us-states";
import { LICENSING_STATUSES, type LicensingStatus } from "./types";

export const MAX_NOTE_LENGTH = 1000;
export const MAX_AGENTS_PER_APPOINTMENT = 200;
export const MAX_CARRIERS_PER_PRODUCT = 200;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Chi tiết một appointment. Thêm mới thì cần thêm bang + hãng (option). */
export type AppointmentDetails = {
  status: LicensingStatus;
  appointedOn: string | null;
  note: string | null;
  agents: Array<{ accountId: string; appointedOn: string | null }>;
};
export type NewAppointmentInput = AppointmentDetails & { stateCode: string; optionId: string };

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function validDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DATE_RE.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return undefined;
  return value;
}

/**
 * Trạng thái / ngày / ghi chú / agent. `agentIds` = agent đang hoạt động, cộng
 * agent đang có sẵn trên appointment (sửa ghi chú không bị chặn chỉ vì một
 * agent cũ đã đổi Position).
 */
export function parseAppointmentDetails(
  body: unknown,
  ctx: { agentIds: ReadonlySet<string> },
): Result<AppointmentDetails> {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the appointment as JSON." };
  const b = body as Record<string, unknown>;

  const status = (LICENSING_STATUSES as readonly unknown[]).includes(b.status)
    ? (b.status as LicensingStatus)
    : null;
  if (!status) return { ok: false, error: "Choose Active, Pending or Terminated." };

  const appointedOn = validDate(b.appointedOn);
  if (appointedOn === undefined) return { ok: false, error: "Enter the appointment date as a valid date." };

  const rawNote = b.note === null || b.note === undefined ? "" : b.note;
  if (typeof rawNote !== "string") return { ok: false, error: "The note must be text." };
  const note = rawNote.trim();
  if (note.length > MAX_NOTE_LENGTH) return { ok: false, error: `Keep the note under ${MAX_NOTE_LENGTH} characters.` };

  const rawAgents = b.agents === undefined ? [] : b.agents;
  if (!Array.isArray(rawAgents)) return { ok: false, error: "Agents must be a list." };
  if (rawAgents.length > MAX_AGENTS_PER_APPOINTMENT) {
    return { ok: false, error: `Add at most ${MAX_AGENTS_PER_APPOINTMENT} agents to one appointment.` };
  }
  const agents: AppointmentDetails["agents"] = [];
  const seen = new Set<string>();
  for (const raw of rawAgents) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const accountId = entry.accountId;
    if (!isUuid(accountId) || !ctx.agentIds.has(accountId)) {
      return { ok: false, error: "One of the agents is no longer an active Agent. Remove them and try again." };
    }
    if (seen.has(accountId)) continue;
    seen.add(accountId);
    const agentDate = validDate(entry.appointedOn);
    if (agentDate === undefined) return { ok: false, error: "Enter each agent's date as a valid date." };
    agents.push({ accountId, appointedOn: agentDate });
  }

  return { ok: true, value: { status, appointedOn, note: note || null, agents } };
}

export function parseNewAppointment(
  body: unknown,
  ctx: { optionIds: ReadonlySet<string>; agentIds: ReadonlySet<string> },
): Result<NewAppointmentInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const stateCode = typeof b.stateCode === "string" ? b.stateCode.trim().toUpperCase() : "";
  if (!isUsStateCode(stateCode)) return { ok: false, error: "Choose a state." };
  const optionId = b.optionId;
  if (!isUuid(optionId) || !ctx.optionIds.has(optionId)) return { ok: false, error: "Choose a carrier." };
  const details = parseAppointmentDetails(body, ctx);
  if (!details.ok) return details;
  return { ok: true, value: { ...details.value, stateCode, optionId } };
}

/**
 * Các ô chọn nhiều của một bang: `{ selection: { [columnId]: optionId[] } }`.
 * Chỉ nhận cột sản phẩm đang hoạt động và hãng thuộc đúng cột đó.
 */
export function parseStateSelection(
  body: unknown,
  optionsByColumn: ReadonlyMap<string, ReadonlySet<string>>,
): Result<Record<string, string[]>> {
  const selection = (body as { selection?: unknown } | null)?.selection;
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    return { ok: false, error: "Send the carriers for each product." };
  }
  const out: Record<string, string[]> = {};
  for (const [columnId, raw] of Object.entries(selection as Record<string, unknown>)) {
    const allowed = optionsByColumn.get(columnId);
    if (!allowed) return { ok: false, error: "A product was changed in Table Configuration. Reload the page." };
    if (!Array.isArray(raw)) return { ok: false, error: "Carriers must be a list." };
    if (raw.length > MAX_CARRIERS_PER_PRODUCT) return { ok: false, error: "Too many carriers for one product." };
    const ids = [...new Set(raw)];
    for (const id of ids) {
      if (typeof id !== "string" || !allowed.has(id)) {
        return { ok: false, error: "A carrier was changed in Table Configuration. Reload the page." };
      }
    }
    out[columnId] = ids as string[];
  }
  return { ok: true, value: out };
}
