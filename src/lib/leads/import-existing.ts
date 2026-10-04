import { normalizePhone } from "./import-parse";
import { fubPersonKey, type TemplateLead } from "./import-template";

/** Một lead đang có, chỉ những trường cần để so (đọc ở route Import). */
export type ExistingLeadCandidate = {
  id: string;
  display_number: number;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  fub_link: string | null;
  assigned_to_email: string | null;
  event_id: string | null;
  event_name: string | null;
};

/**
 * Không có "name": trùng tên KHÔNG làm một dòng thành khách cũ (user chốt
 * 2026-10-04) — tên trùng nhau là chuyện thường ("Elizabeth" khớp hai lead của
 * hai người khác nhau). Chỉ phone, email, FUB link mới định danh một người.
 */
export type ExistingMatchField = "phone" | "email" | "fub";

/**
 * Event lead với tên event chưa có (preview của Import — chưa tạo gì). Event
 * chưa tồn tại thì không lead nào nằm trong đó, nên không dòng nào bị chặn;
 * KHÔNG được truyền null thay vào — null là Personal lead.
 */
export const EVENT_NOT_CREATED_YET = "event-not-created-yet";

export type ExistingLeadMatch = {
  /** Số dòng Excel của dòng trong file. */
  row: number;
  /** Tên trong file. */
  name: string | null;
  matches: {
    leadId: string;
    displayNumber: number;
    leadName: string | null;
    /** null = Personal lead. */
    eventName: string | null;
    owner: string | null;
    on: ExistingMatchField[];
  }[];
  /**
   * Lead đã có trong CHÍNH event này với cùng số (hoặc, khi dòng không có số,
   * cùng FUB link / email). Import đằng nào cũng không ghi được — DB chặn trùng
   * số trong một event — nên ô "Remove" bị khoá ở trạng thái đã tick.
   */
  sameEventBlocked: boolean;
};

/**
 * Dò khách cũ: dòng nào trong file trùng MỘT trong ba trường — phone, email,
 * FUB link — với một lead chưa archive ở bất kỳ event nào. Trùng tên không
 * tính (xem `ExistingMatchField`).
 *
 * Chỉ là cảnh báo: preview hiện đỏ trên đầu, người import tick để bỏ dòng.
 * Trả về khớp theo trường nào để người dùng tự quyết, không tự bỏ.
 */
export function findExistingLeadMatches(
  rows: readonly TemplateLead[],
  leads: readonly ExistingLeadCandidate[],
  eventId: string | null,
): ExistingLeadMatch[] {
  const byKey = new Map<string, ExistingLeadCandidate[]>();
  const add = (key: string | null, lead: ExistingLeadCandidate) => {
    if (!key) return;
    const list = byKey.get(key);
    if (list) list.push(lead);
    else byKey.set(key, [lead]);
  };
  for (const lead of leads) {
    add(lead.phone ? `phone:${normalizePhone(lead.phone) ?? lead.phone}` : null, lead);
    add(lead.email ? `email:${lead.email.trim().toLowerCase()}` : null, lead);
    add(fubPersonKey(lead.fub_link) ? `fub:${fubPersonKey(lead.fub_link)}` : null, lead);
  }

  const result: ExistingLeadMatch[] = [];
  for (const row of rows) {
    const fub = fubPersonKey(row.fub_link);
    const keys: [ExistingMatchField, string | null][] = [
      ["phone", row.phone ? `phone:${row.phone}` : null],
      ["email", row.email ? `email:${row.email}` : null],
      ["fub", fub ? `fub:${fub}` : null],
    ];
    const hits = new Map<string, ExistingLeadMatch["matches"][number]>();
    let sameEventBlocked = false;
    for (const [field, key] of keys) {
      if (!key) continue;
      for (const lead of byKey.get(key) ?? []) {
        const hit = hits.get(lead.id) ?? {
          leadId: lead.id,
          displayNumber: lead.display_number,
          leadName: lead.full_name,
          eventName: lead.event_name,
          owner: lead.assigned_to_email,
          on: [],
        };
        if (!hit.on.includes(field)) hit.on.push(field);
        hits.set(lead.id, hit);

        // Cùng luật chặn trùng với lúc ghi: có số thì theo số (index DB); không
        // có số thì theo FUB link, không có FUB thì theo email.
        if ((lead.event_id ?? null) === eventId) {
          const blocks = row.phone
            ? field === "phone"
            : fub
              ? field === "fub"
              : field === "email";
          if (blocks) sameEventBlocked = true;
        }
      }
    }
    if (hits.size === 0) continue;
    result.push({
      row: row.row,
      name: row.full_name,
      matches: [...hits.values()].sort((left, right) => right.displayNumber - left.displayNumber),
      sameEventBlocked,
    });
  }
  return result;
}
