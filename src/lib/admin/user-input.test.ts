import { describe, expect, it } from "vitest";
import { parseCreateUserInput } from "@/lib/admin/user-input";

// Golden-master cho validate FORMAT payload tạo user (các nhánh đã tách từ route).
describe("parseCreateUserInput", () => {
  it("thiếu email -> 400", () => {
    const r = parseCreateUserInput({ password: "12345678", agentId: "A1" });
    expect(r).toEqual({
      ok: false,
      error: "Email and password are required.",
      status: 400,
    });
  });

  it("password < 8 ký tự -> 400", () => {
    const r = parseCreateUserInput({
      email: "a@b.com",
      password: "short",
      agentId: "A1",
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
    if (!r.ok) expect(r.error).toContain("at least 8");
  });

  it("thiếu agentId -> 400", () => {
    const r = parseCreateUserInput({
      email: "a@b.com",
      password: "12345678",
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
    if (!r.ok) expect(r.error).toContain("Agent ID");
  });

  it("nhiều hơn 1 role -> 400", () => {
    const r = parseCreateUserInput({
      email: "a@b.com",
      password: "12345678",
      agentId: "A1",
      roleIds: ["r1", "r2"],
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("chuẩn hoá email (trim + lowercase), name, agentId; role mặc định agent", () => {
    const r = parseCreateUserInput({
      email: "  A@B.COM  ",
      password: "12345678",
      name: "  John  ",
      agentId: "  A1 ",
      role: "weird",
      roleIds: ["r1"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        email: "a@b.com",
        password: "12345678",
        name: "John",
        agentId: "A1",
        legacyRoleFallback: "agent",
        roleIds: ["r1"],
      });
    }
  });

  it("name rỗng -> null; legacy role 'admin' giữ nguyên", () => {
    const r = parseCreateUserInput({
      email: "a@b.com",
      password: "12345678",
      name: "   ",
      agentId: "A1",
      role: "admin",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBeNull();
      expect(r.value.legacyRoleFallback).toBe("admin");
      expect(r.value.roleIds).toEqual([]);
    }
  });
});
