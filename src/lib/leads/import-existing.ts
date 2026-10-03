import { normalizePhone } from "./import-parse";
import {
  fubPersonKey,
  normalizePersonName,
  type TemplateLead,
} from "./import-template";

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

export type ExistingMatchField = "name" | "phone" | "email" | "fub";

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
 * Dò khách cũ (2026-10-03): dòng nào trong file trùng MỘT trong bốn trường —
 * tên, phone, email, FUB link — với một lead chưa archive ở bất kỳ event nào.
 *
 * Chỉ là cảnh báo: preview hiện đỏ trên đầu, người import tick để bỏ dòng. Tên
 * ngắn ("Mai", "Chris") khớp nhầm nhiều, nên trả về khớp theo trường nào để
 * người dùng tự quyết, không tự bỏ.
 *
 * So ở Node chứ không ở SQL: DB không có extension `unaccent`, mà tên trong
 * file thường không dấu còn tên agent gõ tay thì có dấu.
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
    const name = normalizePersonName(lead.full_name);
    add(name ? `name:${name}` : null, lead);
    add(lead.phone ? `phone:${normalizePhone(lead.phone) ?? lead.phone}` : null, lead);
    add(lead.email ? `email:${lead.email.trim().toLowerCase()}` : null, lead);
    add(fubPersonKey(lead.fub_link) ? `fub:${fubPersonKey(lead.fub_link)}` : null, lead);
  }

  const result: ExistingLeadMatch[] = [];
  for (const row of rows) {
    const name = normalizePersonName(row.full_name);
    const fub = fubPersonKey(row.fub_link);
    const keys: [ExistingMatchField, string | null][] = [
      ["name", name ? `name:${name}` : null],
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
