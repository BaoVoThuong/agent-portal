import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Registry gác route — cổng TĨNH ba mức (audit 2026-09-25, D16):
 *   1. xác thực: biết ai đang gọi;
 *   2. quyền hành động: được làm loại việc này;
 *   3. scope object: đúng bản ghi / đúng response (chỉ ghi lại, không bắt buộc).
 *
 * Test chỉ phát hiện route THIẾU khai báo, hoặc lặng lẽ mất một cổng (snapshot
 * đổi). Nó KHÔNG chứng minh cổng đúng: /api/tasks/overview (S8) và
 * PATCH /api/admin/roles/[id] (S18) từng "có dấu hiệu gác" mà vẫn thủng — việc
 * đó là của test gọi API trực tiếp.
 */

const API_ROOT = join(process.cwd(), "src/app/api");

// Dấu hiệu (chuỗi con trong mã nguồn) cho từng mức gác. Thêm cơ chế gác mới thì
// thêm dấu hiệu vào đúng mức, đừng nới luật bên dưới.
const AUTHN = [
  "auth()",
  "requireApiPrincipal(",
  "requireApiGrant(",
  "getTimeOffActor(",
  "loadEnrollmentActor(",
  "loadConfigAdmin(",
  "loadConfigAdminForScope(",
  "loadConfigActorForScope(",
  "authorizeTaskReactionAccess(",
  "authorizeEnrollmentReactionAccess(",
  "checkCronAuthorization(",
] as const;

const ACTION = [
  "requireApiGrant(",
  "can(",
  "canAny(",
  "canAccessBoard(",
  "canAssign(",
  "canManageCategories(",
  "canManageTaskConfig(",
  "canReadTaskOverview(",
  "canReadTaskActivity(",
  "canChangeTaskStatus(",
  "canAssignToTask(",
  "canDeleteTask(",
  "resolveTaskCapabilities(",
  "canManageEnrollmentOptions(",
  "canReadEnrollmentOverview(",
  "canManageLeads(",
  "canWorkLeads(",
  "canActorExport(",
  "canActorImport(",
  "canActorImportEnrollment(",
  ".isManager",
  "getTimeOffActor(",
  "loadEnrollmentActor(",
  "loadConfigAdmin(",
  "loadConfigAdminForScope(",
  "loadConfigActorForScope(",
  "authorizeTaskReactionAccess(",
  "authorizeEnrollmentReactionAccess(",
  "checkCronAuthorization(",
] as const;

const OBJECT = [
  "loadScopedEnrollmentRecord(",
  "resolveEnrollmentScope(",
  "canViewTask(",
  "resolveTaskCapabilities(",
  "resolveLeadCapabilities(",
  "fetchTasksForActor(",
  "resolveLeadOwnerEmails(",
  "buildVisibleEntriesFilter(",
  "canManageEntry(",
  "canManagePcEntry(",
  "recipient_email",
  "requester_id",
  "authorizeTaskReactionAccess(",
  "authorizeEnrollmentReactionAccess(",
] as const;

// Handler của chính Auth.js.
const EXEMPT: Record<string, string> = {
  "auth/[...nextauth]/route.ts": "Handler của Auth.js — chính nó là lớp xác thực.",
};

// Route chỉ phục vụ CHÍNH người đang đăng nhập: không có quyền hành động riêng,
// phạm vi là email trong phiên.
const SELF_SERVICE: Record<string, string> = {
  "notifications/push/subscribe/route.ts": "Chỉ ghi/xoá subscription của email trong phiên.",
  "settings/avatar/route.ts": "Chỉ đổi ảnh của account trong phiên.",
  "tasks/notifications/route.ts": "Chỉ đọc thông báo có recipient_email = email trong phiên.",
  "tasks/notifications/read/route.ts": "Chỉ đánh dấu đã đọc thông báo của chính mình.",
};

function listRoutes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listRoutes(full);
    return name === "route.ts" ? [full] : [];
  });
}

function detect(source: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => source.includes(marker));
}

const routes = listRoutes(API_ROOT)
  .map((file) => {
    const source = readFileSync(file, "utf8");
    return {
      route: relative(API_ROOT, file).split("\\").join("/"),
      authn: detect(source, AUTHN),
      action: detect(source, ACTION),
      object: detect(source, OBJECT),
    };
  })
  .sort((a, b) => a.route.localeCompare(b.route));

describe("registry gác route", () => {
  it("tìm thấy route để kiểm", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("mọi route đều xác thực người gọi", () => {
    const missing = routes
      .filter((entry) => !EXEMPT[entry.route] && entry.authn.length === 0)
      .map((entry) => entry.route);
    expect(missing).toEqual([]);
  });

  it("mọi route không tự phục vụ đều có cổng quyền hành động", () => {
    const missing = routes
      .filter(
        (entry) =>
          !EXEMPT[entry.route] && !SELF_SERVICE[entry.route] && entry.action.length === 0
      )
      .map((entry) => entry.route);
    expect(missing).toEqual([]);
  });

  it("danh sách miễn trừ không trỏ tới route không còn tồn tại", () => {
    const known = new Set(routes.map((entry) => entry.route));
    const stale = [...Object.keys(EXEMPT), ...Object.keys(SELF_SERVICE)].filter(
      (route) => !known.has(route)
    );
    expect(stale).toEqual([]);
  });

  it("bản đồ cổng khớp snapshot — route mới hoặc cổng bị gỡ phải được review", () => {
    expect(routes).toMatchSnapshot();
  });
});
