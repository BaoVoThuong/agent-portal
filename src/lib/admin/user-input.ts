import type { UserRole } from "@/lib/domain/account.types";

// Các giá trị legacy role hợp lệ (dùng khi không chọn roleIds RBAC).
const LEGACY_ROLES: UserRole[] = ["admin", "agent"];

export type CreateUserInput = {
  email: string;
  password: string;
  name: string | null;
  agentId: string;
  legacyRoleFallback: UserRole;
  roleIds: string[];
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

// Chuẩn hoá + validate FORMAT của payload tạo user (phần thuần, không chạm DB).
// Tách nguyên văn các bước kiểm tra đang nằm trong route handler để handler mỏng
// hơn và phần này test được. Các kiểm tra cần DB (trùng email/agentId, role active)
// vẫn ở lại handler.
export function parseCreateUserInput(body: unknown): ParseResult<CreateUserInput> {
  const {
    email,
    password,
    name,
    role,
    roleIds,
    agentId,
  } = (body ?? {}) as Record<string, unknown>;

  const normalizedEmail =
    typeof email === "string" ? email.trim().toLowerCase() : "";
  const normalizedAgentId = typeof agentId === "string" ? agentId.trim() : "";
  const legacyRoleFallback: UserRole = LEGACY_ROLES.includes(role as UserRole)
    ? (role as UserRole)
    : "agent";
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

  if (!normalizedAgentId) {
    return { ok: false, error: "Agent ID is required.", status: 400 };
  }

  if (selectedRoleIds.length > 1) {
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
      legacyRoleFallback,
      roleIds: selectedRoleIds,
    },
  };
}
