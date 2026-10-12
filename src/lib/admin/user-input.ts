export type CreateUserInput = {
  email: string;
  password: string;
  name: string | null;
  agentId: string | null;
  /** Exactly one role id. The legacy `role` ("admin"/"agent") field is gone. */
  roleIds: string[];
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

// Chuẩn hoá + validate FORMAT của payload tạo user (phần thuần, không chạm DB).
// Tách nguyên văn các bước kiểm tra đang nằm trong route handler để handler mỏng
// hơn và phần này test được. Các kiểm tra cần DB (trùng email/agentId, role active)
// vẫn ở lại handler.
//
// Từ 2026-10-09 không còn trường `role` cũ: gửi `role: "admin"` từng tự gán role
// Admin mà không qua kiểm tra nào. Tài khoản mới bắt buộc chọn đúng một role.
export function parseCreateUserInput(body: unknown): ParseResult<CreateUserInput> {
  const {
    email,
    password,
    name,
    roleIds,
    agentId,
  } = (body ?? {}) as Record<string, unknown>;

  const normalizedEmail =
    typeof email === "string" ? email.trim().toLowerCase() : "";
  if (
    agentId !== undefined &&
    agentId !== null &&
    typeof agentId !== "string"
  ) {
    return { ok: false, error: "Invalid Agent ID.", status: 400 };
  }
  const normalizedAgentId =
    typeof agentId === "string" && agentId.trim()
      ? agentId.trim()
      : null;
  const selectedRoleIds = Array.isArray(roleIds)
    ? roleIds.filter((item): item is string => typeof item === "string")
    : [];

  if (!normalizedEmail || typeof password !== "string") {
    return { ok: false, error: "Email and password are required.", status: 400 };
  }

  if (password.length < 8) {
    return {
      ok: false,
      error: "Password must be at least 8 characters.",
      status: 400,
    };
  }

  if (selectedRoleIds.length !== 1) {
    return {
      ok: false,
      error: "Select exactly one role for this account.",
      status: 400,
    };
  }

  return {
    ok: true,
    value: {
      email: normalizedEmail,
      password,
      name: typeof name === "string" && name.trim() ? name.trim() : null,
      agentId: normalizedAgentId,
      roleIds: selectedRoleIds,
    },
  };
}
