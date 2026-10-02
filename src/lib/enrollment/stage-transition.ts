export function needsReopenReason(
  from: { is_terminal: boolean } | null | undefined,
  to: { is_terminal: boolean } | null | undefined,
): boolean {
  return Boolean(from?.is_terminal) && !Boolean(to?.is_terminal);
}
