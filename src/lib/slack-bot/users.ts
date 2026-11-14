/**
 * Danh sách người được dùng Slack bot ở #agent_portal (2026-11-14).
 *
 * Quyền dùng bot cấp THEO NGƯỜI, không theo role: mỗi account chỉ có đúng một
 * role, và còn phải cấp cho email ngoài portal. Không tick gì = Ask only (bot
 * chỉ trả lời cách dùng portal, không tra dữ liệu). Change access / Edit code /
 * Approve chỉ cho người đã gắn account portal — DB cũng chặn bằng
 * slack_bot_users_linked_for_write.
 */

export type SlackBotFlags = {
  can_diagnose: boolean;
  can_change_access: boolean;
  can_edit_code: boolean;
  can_approve: boolean;
};

export type SlackBotUserInput = SlackBotFlags & {
  slack_email: string;
  portal_account_id: string | null;
  note: string | null;
};

export type SlackBotUserRow = SlackBotUserInput & {
  id: string;
  created_by_email: string;
  updated_by_email: string;
  created_at: string;
  updated_at: string;
};

export const SLACK_BOT_USER_COLUMNS =
  "id,slack_email,portal_account_id,can_diagnose,can_change_access,can_edit_code,can_approve,note,created_by_email,updated_by_email,created_at,updated_at";

const FLAG_KEYS = ["can_diagnose", "can_change_access", "can_edit_code", "can_approve"] as const;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEEDS_ACCOUNT = "Change access, Edit code and Approve need a linked portal account.";

export function parseSlackBotUserInput(
  body: unknown,
): { ok: true; value: SlackBotUserInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request." };
  }
  const input = body as Record<string, unknown>;

  const email = typeof input.slack_email === "string" ? input.slack_email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid Slack email." };

  const rawAccount = input.portal_account_id;
  let accountId: string | null = null;
  if (rawAccount !== undefined && rawAccount !== null && rawAccount !== "") {
    if (typeof rawAccount !== "string" || !UUID_RE.test(rawAccount)) {
      return { ok: false, error: "Invalid portal account." };
    }
    accountId = rawAccount;
  }

  const flags = {} as SlackBotFlags;
  for (const key of FLAG_KEYS) {
    const value = input[key];
    if (value === undefined) {
      flags[key] = false;
      continue;
    }
    if (typeof value !== "boolean") return { ok: false, error: "Invalid Slack bot permissions." };
    flags[key] = value;
  }
  if (!accountId && (flags.can_change_access || flags.can_edit_code || flags.can_approve)) {
    return { ok: false, error: NEEDS_ACCOUNT };
  }

  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null;

  return {
    ok: true,
    value: { slack_email: email, portal_account_id: accountId, ...flags, note },
  };
}

export function slackBotWriteFailure(error: { code?: string; message: string }): {
  status: 400 | 409 | 500;
  error: string;
} {
  if (error.code === "23505") return { status: 409, error: "This Slack email is already on the list." };
  if (error.code === "23514" && error.message.includes("slack_bot_users_linked_for_write")) {
    return { status: 400, error: NEEDS_ACCOUNT };
  }
  if (error.code === "23514") return { status: 400, error: "Enter a valid Slack email." };
  if (error.code === "23503") return { status: 400, error: "Invalid portal account." };
  return { status: 500, error: error.message };
}
