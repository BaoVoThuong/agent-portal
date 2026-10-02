import type { LeadRow } from "./types";

/**
 * Pure helpers for the lead list's client state. They live here rather than in
 * the component because vitest runs with `environment: "node"` in this repo —
 * a `.tsx` file cannot be tested, so the rules worth pinning have to be `.ts`.
 */

/**
 * Merge one inline edit into the row that is already on screen.
 *
 * `custom_values` arrives as a PARTIAL map — one key, the field being edited.
 * Spreading the patch wholesale replaces the object, so every other custom
 * column on that row blinks to "—" until the server response lands. It heals
 * itself, but on a slow connection it is visible and reads as data loss.
 */
export function mergeLeadPatch(
  lead: LeadRow,
  patch: Record<string, unknown>
): LeadRow {
  const next = { ...lead, ...(patch as Partial<LeadRow>) };
  if (patch.custom_values && typeof patch.custom_values === "object") {
    next.custom_values = {
      ...(lead.custom_values ?? {}),
      ...(patch.custom_values as Record<string, unknown>),
    };
  }
  return next;
}

// Dời sang lib/collaboration để màn khác dùng chung; export lại cho import cũ.
export { createKeyedSerializer } from "@/lib/collaboration/keyed-serializer";

/**
 * Bản server trả về cho MỘT lượt sửa, phủ thêm những lượt sửa CÙNG lead còn
 * đang xếp hàng.
 *
 * Không phủ thì dòng nhảy lùi về bản chưa có các lượt sau cho tới khi chúng ghi
 * xong — và ô Product đang mở sẽ tính cú tick kế tiếp từ bản lùi đó, gửi đi một
 * mảng làm rơi mất product vừa tick.
 */
export function overlayPendingPatches(
  row: LeadRow,
  pending: readonly Record<string, unknown>[]
): LeadRow {
  return pending.reduce<LeadRow>((next, patch) => mergeLeadPatch(next, patch), row);
}

/**
 * Đẩy mốc `updated_at` của một dòng lên sau một thao tác đổi mốc mà không trả về
 * cả dòng (viết comment). Không bao giờ LÙI mốc: một lượt sửa khác về trước có
 * thể đã mang mốc mới hơn.
 *
 * Mốc này là thứ Archive gửi kèm để server phát hiện có người sửa chen giữa.
 * Giữ mốc cũ thì Archive ngay sau khi comment luôn bị từ chối.
 */
export function touchLeadUpdatedAt(lead: LeadRow, updatedAt: string): LeadRow {
  const next = Date.parse(updatedAt);
  if (!Number.isFinite(next)) return lead;
  const current = Date.parse(lead.updated_at);
  if (Number.isFinite(current) && current > next) return lead;
  return { ...lead, updated_at: updatedAt };
}

/**
 * Keep a bulk selection across a background refresh, dropping only the rows
 * that are no longer there.
 *
 * The selection used to be cleared on every refresh — including the 60-second
 * poll and any realtime echo of someone else's edit — so a manager ticking
 * twenty leads lost them by pausing to read one row. Clearing belongs after
 * *your own* assign completes, not on a clock.
 *
 * Rows that vanished (archived, or reassigned out of your scope) must still be
 * dropped: leaving them in makes the next bulk action fail on rows nobody can
 * see, with nothing on screen explaining why.
 */
export function retainSelection(
  selected: ReadonlySet<string>,
  rows: readonly LeadRow[]
): Set<string> {
  const alive = new Set(rows.map((row) => row.id));
  return new Set([...selected].filter((id) => alive.has(id)));
}

/**
 * The refreshed copy of the row the detail modal is showing, or null when that
 * row is gone.
 *
 * Falling back to the stale copy kept the modal open on a lead that had been
 * archived or moved out of the viewer's scope; it looked editable, and only the
 * next save revealed the truth with a 403 or 404. Closing is the honest answer.
 */
export function syncSelectedLead(
  current: LeadRow | null,
  rows: readonly LeadRow[]
): LeadRow | null {
  if (!current) return null;
  return rows.find((row) => row.id === current.id) ?? null;
}
