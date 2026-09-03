import { auth } from "@/auth";
import {
  canManageEnrollmentOptions,
  loadEnrollmentActor,
  type EnrollmentActor,
} from "@/lib/enrollment/access";
import {
  buildLeadActor,
  canManageLeads,
  canWorkLeads,
  isLeadViewAdmin,
} from "@/lib/leads/access";
import type { TableScope } from "./types";

export async function loadConfigActor() {
  return loadEnrollmentActor();
}

export async function loadConfigAdmin(): Promise<
  | { ok: true; actor: EnrollmentActor }
  | { ok: false; error: "Unauthorized" | "Forbidden"; status: 401 | 403 }
> {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) return actorResult;
  if (!canManageEnrollmentOptions(actorResult.actor)) {
    return { ok: false, error: "Forbidden", status: 403 };
  }
  return actorResult;
}

/**
 * Kết quả gác cho các route BIẾT mình đang làm việc với scope nào.
 *
 * Chỉ hứa `actor.email` — đó là thứ duy nhất mà các handler cấu hình dùng tới
 * (`created_by_email`, và khoá dòng `user_table_layout`). Hứa ít thì hai nhánh
 * task/lead không phải giả vờ có chung một hình dạng actor mà chúng vốn không có.
 */
type ScopeGateResult =
  | { ok: true; actor: { email: string } }
  | { ok: false; error: "Unauthorized" | "Forbidden"; status: 401 | 403 };

async function loadLeadConfigGate(need: "work" | "manage"): Promise<ScopeGateResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Unauthorized", status: 401 };
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  const allowed = need === "manage" ? canManageLeads(actor) : canWorkLeads(actor);
  if (!allowed) return { ok: false, error: "Forbidden", status: 403 };
  return { ok: true, actor: { email: actor.email } };
}

/**
 * Ai được GHI cấu hình của scope này.
 *
 * Bảng Health giữ nguyên luật cũ (`loadConfigAdmin` — `task.manage` VÀ vai trò
 * task-admin). Bảng lead đi theo `canManageLeads`. Một cổng chung cho cả bốn là
 * hoặc nới quyền Health, hoặc chặn mất người quản lead: 12 handler dưới
 * `/api/config/*` đều gác bằng `loadConfigAdmin`, nên hai tài khoản trên
 * production chỉ có quyền lead **chưa bao giờ** sửa được cấu hình bảng lead —
 * kể cả ở `/leads/config`, màn hình dựng riêng cho họ.
 */
export async function loadConfigAdminForScope(scope: TableScope): Promise<ScopeGateResult> {
  return scope === "lead" ? loadLeadConfigGate("manage") : loadConfigAdmin();
}

/**
 * Ai được ĐỌC cấu hình của scope này.
 *
 * Đường đọc cũng phải mở, không chỉ đường ghi: `ConfigClient` gọi lại
 * `GET /api/config/columns?scope=…` sau **mỗi** lần sửa cột, và `LeadsClient`
 * đọc `/api/config/layout?scope=lead` mỗi lần mở bảng. Mở ghi mà quên đọc là
 * lưu được nhưng màn hình không bao giờ cập nhật.
 */
export async function loadConfigActorForScope(scope: TableScope): Promise<ScopeGateResult> {
  return scope === "lead" ? loadLeadConfigGate("work") : loadConfigActor();
}
