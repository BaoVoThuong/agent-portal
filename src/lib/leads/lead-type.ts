import { normalizeEventName } from "./events";
import type { LeadRow } from "./types";

/**
 * Lead type (2026-10-03). KHÔNG phải một cột trong DB: nó suy ra từ ô Event.
 * Lead có event là Event lead; không có event là Personal lead — lead do agent
 * tự mang về, không đến từ sự kiện nào.
 *
 * Suy ra thay vì lưu riêng để chỉ có MỘT nơi nói lead đến từ đâu. Lưu hai nơi
 * thì sẽ có lúc "Personal" mà vẫn mang event, và bộ lọc với báo cáo theo event
 * sẽ nói hai chuyện khác nhau.
 */
export const LEAD_TYPES = ["event", "personal"] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

export const LEAD_TYPE_LABEL: Record<LeadType, string> = {
  event: "Event lead",
  personal: "Personal lead",
};

export function isLeadType(value: unknown): value is LeadType {
  return (
    typeof value === "string" &&
    (LEAD_TYPES as readonly string[]).includes(value)
  );
}

export function leadTypeOf(lead: Pick<LeadRow, "event_id">): LeadType {
  return lead.event_id ? "event" : "personal";
}

/**
 * Trước khi có Lead type, người dùng gõ tay một event tên "Personal Lead" để
 * đánh dấu lead cá nhân (LEAD-227/228 trên production). Gõ lại cái tên đó thì
 * hiểu là "không có event", để không đẻ ra một event giả nữa.
 */
const PERSONAL_EVENT_NAMES = new Set(["personal", "personal lead", "personal leads"]);

export function isPersonalLeadEventName(raw: string | null | undefined): boolean {
  return PERSONAL_EVENT_NAMES.has(normalizeEventName(raw ?? "").toLowerCase());
}
