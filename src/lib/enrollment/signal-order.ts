import {
  hasAnySignal,
  signalRankWeight,
  type TaskSignalBadges,
} from "@/lib/tasks/signal-badges";

/**
 * Floats records carrying an unread signal to the front, in badge-weight order.
 *
 * This is a stable partition, not a sort. Enrollment has no default ranking the
 * way the CS board does -- its list order is whatever column the user picked --
 * so the caller's active sort still decides the order inside each group.
 * Building a full band system here would change how every user's list behaves
 * and is deliberately out of scope.
 */
export function partitionBySignal<T extends { id: string }>(
  rows: readonly T[],
  badgesByRecord: Record<string, TaskSignalBadges>
): T[] {
  const badged: { row: T; weight: number }[] = [];
  const rest: T[] = [];

  for (const row of rows) {
    const badges = badgesByRecord[row.id];
    if (badges && hasAnySignal(badges)) {
      badged.push({ row, weight: signalRankWeight(badges) });
    } else {
      rest.push(row);
    }
  }

  // Array.prototype.sort is stable in every runtime this ships to, so equal
  // weights keep the order the column sort produced.
  badged.sort((a, b) => a.weight - b.weight);
  return [...badged.map((entry) => entry.row), ...rest];
}
