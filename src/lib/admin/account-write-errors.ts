const CODE_MESSAGES: Array<[string, 400 | 404 | 409, string]> = [
  ["LAST_ADMIN", 400, "At least one active Admin account is required."],
  ["USER_NOT_FOUND", 404, "User not found."],
  [
    "AGENT_HAS_PERSONAL_LEADS",
    409,
    "This Agent still owns Personal leads. Reassign them to another Agent before deactivating the account.",
  ],
  // Position / Agent / Assistant / manager (update_account_atomic, 2026-10-16).
  [
    "ACCOUNT_CONFIG_CONFLICT",
    409,
    "Someone changed this account's position, Agents or manager after you opened it. Reload the page and try again.",
  ],
  ["POSITION_NOT_FOUND", 400, "That position no longer exists. Reload the page and try again."],
  ["ASSISTANT_AGENTS_NEED_ASSISTANT_POSITION", 400, "Only an Assistant position can support Agents."],
  ["ASSISTANT_NEEDS_AGENT", 400, "Choose at least one Agent this Assistant supports."],
  ["ASSISTANT_SELF_MEMBERSHIP", 400, "A person cannot assist themselves."],
  ["AGENT_ASSISTANT_CONFLICT", 409, "A person cannot be an Agent and an Assistant at the same time."],
  ["ASSISTANT_AGENT_INELIGIBLE", 409, "One of the selected Agents is no longer an active Agent. Reload the page and try again."],
  ["ASSISTANT_ACCOUNT_INELIGIBLE", 409, "A disabled account cannot be given new Agents to assist."],
  ["MANAGER_INVALID", 400, "Choose an active account as manager."],
  ["PORTAL_ACCOUNT_MANAGER_CYCLE", 400, "That manager would put this person above themselves in the management tree."],
  ["PORTAL_ACCOUNT_MANAGER_CHAIN_TOO_DEEP", 400, "That manager would put this person above themselves in the management tree."],
];

export function accountWriteFailure(error: { code?: string; message: string }): {
  status: 400 | 404 | 409 | 500;
  error: string;
} {
  for (const [code, status, message] of CODE_MESSAGES) {
    if (error.message.includes(code)) return { status, error: message };
  }
  if (error.code === "23505") {
    return { status: 409, error: "An account with this email or Agent ID already exists." };
  }
  // portal_account_manager_not_self
  if (error.code === "23514") {
    return { status: 400, error: "A person cannot be their own manager." };
  }
  return { status: 500, error: error.message };
}
