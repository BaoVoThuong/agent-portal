import { canViewProviders } from "./access";

/**
 * Người nhận còn mở được thông báo Provider không. Provider List không chia
 * phạm vi theo người: xem được bảng là xem được mọi dòng còn hoạt động.
 *
 * Nằm trong module Provider để chuông (route của module Task) và push không
 * phải tự nhắc tới quyền của module khác — xem rbac/module-boundaries.test.ts.
 */
export function canViewProviderNotification(permissions: readonly string[] | undefined): boolean {
  return canViewProviders(permissions);
}
