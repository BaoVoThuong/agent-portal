import { getUserAccessByEmail } from "@/lib/rbac/access";
import { botFail, type BotActionResult } from "@/lib/rbac/bot-changes";
import { botSetRolePermission } from "@/lib/rbac/bot-role-change";
import { botChangeAccount } from "@/lib/admin/bot-account-change";
import type { BotAction } from "./action-parse";

/**
 * Thay đổi mà Slack bot thực hiện SAU KHI một người có quyền Approve bấm duyệt
 * trong Slack (2026-11-15, giai đoạn 2 của spec slack-support-bot).
 *
 * Mỗi thay đổi chạy như thể chính người duyệt (`approver_email`, account portal của
 * họ) tự làm trên Role Manager (lib/rbac/bot-role-change.ts) hoặc Account Manager
 * (lib/admin/bot-account-change.ts): cùng quyền đòi hỏi, cùng kiểm uỷ quyền, cùng
 * hàm SQL ghi. File này chỉ tra quyền người duyệt và điều phối; mỗi module tự kiểm
 * quyền của mình (luật module-boundaries). Luật "không đụng quyền quản trị" của bot:
 * lib/rbac/bot-changes.ts.
 */

export { parseBotAction, type BotAction } from "./action-parse";
export { BOT_PROTECTED_PERMISSIONS, escapeLike, touchesProtected, type BotActionResult } from "@/lib/rbac/bot-changes";

export async function runBotAction(action: BotAction, approverEmail: string): Promise<BotActionResult> {
  const approver = await getUserAccessByEmail(approverEmail.trim().toLowerCase());
  if (approver.unavailable) return botFail(503, "Could not check the approver's access. Try again.");
  if (!approver.isActive) return botFail(403, "The approver has no active portal account.");
  if (action.kind === "role_permission") return botSetRolePermission(action, approver.permissions);
  return botChangeAccount(action, approver.permissions, approverEmail);
}
