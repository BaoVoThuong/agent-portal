import { principalFromSessionUser } from "@/lib/authz/principal";
import { taskActorFromGrants } from "./access";
import type { TaskActor } from "./types";

type SessionUser = Parameters<typeof principalFromSessionUser>[0];

/**
 * TaskActor của người đang đăng nhập, dựng từ grant của principal.
 *
 * Nhận `session.user` mà route đã có (thay vì gọi `getPrincipal()`) để không
 * giải mã phiên lần hai trong route handler — nơi `cache()` của React không gộp
 * lời gọi. Grant lấy qua cache định nghĩa role 30 giây, không tốn truy vấn.
 */
export async function taskActorForUser(user: SessionUser, email: string): Promise<TaskActor> {
  const principal = await principalFromSessionUser({ ...user, email });
  return taskActorFromGrants(email, principal?.grants ?? []);
}
