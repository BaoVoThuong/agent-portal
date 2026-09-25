function normalizeRosterEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Người này có tên trong roster agent (`task_agents`) không.
 *
 * Pure, so không phân biệt hoa thường: roster cũ có thể còn email viết hoa, và
 * email trong body request là thứ người gọi tự gõ.
 */
export function isRosterAgent(
  email: string | null | undefined,
  roster: ReadonlySet<string>
): boolean {
  const normalized = normalizeRosterEmail(email);
  if (!normalized) return false;
  for (const member of roster) {
    if (normalizeRosterEmail(member) === normalized) return true;
  }
  return false;
}
