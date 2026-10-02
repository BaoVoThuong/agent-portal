import { isDirectNotification } from "./alert-policy";
import type { NotificationCopyType } from "./copy";

/** No preference row means alerts remain enabled. */
export function alertsMutedFromRow(
  row: { sound_enabled?: boolean | null } | null | undefined,
): boolean {
  return row?.sound_enabled === false;
}

/** Keep in-page notifications, but suppress non-direct sound and pop-up alerts. */
export function alertableNotifications<T extends { type: NotificationCopyType }>(
  items: readonly T[],
  alertsMuted: boolean,
): T[] {
  return alertsMuted
    ? items.filter((item) => isDirectNotification(item.type))
    : [...items];
}

/** Apply push and alert preferences without changing the recipient list itself. */
export function pushAllowedEmails(
  emails: readonly string[],
  rows: readonly {
    email: string;
    push_enabled?: boolean | null;
    sound_enabled?: boolean | null;
  }[],
  direct: boolean,
): string[] {
  const blocked = new Set(
    rows
      .filter(
        (row) =>
          row.push_enabled === false ||
          (!direct && row.sound_enabled === false),
      )
      .map((row) => row.email.trim().toLowerCase()),
  );
  return emails.filter((email) => !blocked.has(email.trim().toLowerCase()));
}
