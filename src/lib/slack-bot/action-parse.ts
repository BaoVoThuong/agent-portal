import type { BotAccountAction } from "@/lib/admin/bot-account-change";

/** Phần thuần (không gọi DB) của lib/slack-bot/actions.ts, để route và test dùng không kéo theo auth. */

export type BotAction = { kind: "role_permission"; role_name: string; permission_key: string; enabled: boolean } | BotAccountAction;

const normEmail = (value: string) => value.trim().toLowerCase();

/** Đọc và kiểm hình dạng action từ JSON. Trả null nếu sai. */
export function parseBotAction(raw: unknown): BotAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const str = (key: string) => (typeof a[key] === "string" && (a[key] as string).trim() ? (a[key] as string).trim() : null);
  const bool = (key: string) => (typeof a[key] === "boolean" ? (a[key] as boolean) : null);
  switch (a.kind) {
    case "role_permission": {
      const role_name = str("role_name");
      const permission_key = str("permission_key");
      const enabled = bool("enabled");
      return role_name && permission_key && enabled !== null ? { kind: "role_permission", role_name, permission_key, enabled } : null;
    }
    case "account_role": {
      const account_email = str("account_email");
      const role_name = str("role_name");
      return account_email && role_name ? { kind: "account_role", account_email: normEmail(account_email), role_name } : null;
    }
    case "account_position": {
      const account_email = str("account_email");
      const position_name = str("position_name");
      const list = a.assisted_agent_emails;
      if (list !== undefined && (!Array.isArray(list) || !list.every((x) => typeof x === "string"))) return null;
      return account_email && position_name
        ? {
            kind: "account_position",
            account_email: normEmail(account_email),
            position_name,
            ...(list ? { assisted_agent_emails: (list as string[]).map(normEmail) } : {}),
          }
        : null;
    }
    case "assistant_link": {
      const account_email = str("account_email");
      const agent_email = str("agent_email");
      const linked = bool("linked");
      return account_email && agent_email && linked !== null
        ? { kind: "assistant_link", account_email: normEmail(account_email), agent_email: normEmail(agent_email), linked }
        : null;
    }
    case "account_active": {
      const account_email = str("account_email");
      const active = bool("active");
      return account_email && active !== null ? { kind: "account_active", account_email: normEmail(account_email), active } : null;
    }
    default:
      return null;
  }
}

