/**
 * Holds a list in the order it had when the user arrived.
 *
 * Both product lists rank from live data -- Health CS from `last_activity_at`
 * via rankTasks, Enrollment from an `updated_at` tiebreak in sortRecords -- and
 * every patch changes those fields. The row the user just edited therefore
 * jumped out from under their cursor. Freezing the order for the session is the
 * requested behaviour: contents update in place, position only changes on an
 * explicit boundary (sort change, filter change, navigation, refresh).
 *
 * Rows absent from the frozen order are inserted at their RANKED position, not
 * appended. Both lists are urgency queues, so a task just assigned to you or a
 * record you just created must not land at the bottom -- possibly below the
 * fold. Only rows the user has already seen are held in place.
 *
 * Callers must reset the frozen ids when the user explicitly asks for a
 * different order; otherwise clicking a column header would appear to do
 * nothing.
 */
export function applyFrozenOrder<T extends { id: string }>(
  rows: readonly T[],
  frozenIds: readonly string[]
): { rows: T[]; nextFrozenIds: string[] } {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const frozenSet = new Set(frozenIds);

  // Frozen rows that are still present, in their held order.
  const held: T[] = [];
  const heldSeen = new Set<string>();
  for (const id of frozenIds) {
    const row = byId.get(id);
    if (row && !heldSeen.has(id)) {
      held.push(row);
      heldSeen.add(id);
    }
  }

  // Each new row is placed just before the first held row that outranks it in
  // the incoming order, so it lands where the ranking says it belongs.
  const insertBefore = new Map<string, T[]>();
  const tail: T[] = [];
  const pendingNew: T[] = [];
  const placedNew = new Set<string>();
  for (const row of rows) {
    if (frozenSet.has(row.id)) {
      if (pendingNew.length > 0) {
        insertBefore.set(row.id, pendingNew.splice(0, pendingNew.length));
      }
    } else if (!placedNew.has(row.id)) {
      placedNew.add(row.id);
      pendingNew.push(row);
    }
  }
  tail.push(...pendingNew);

  const ordered: T[] = [];
  for (const row of held) {
    const before = insertBefore.get(row.id);
    if (before) ordered.push(...before);
    ordered.push(row);
  }
  ordered.push(...tail);

  return { rows: ordered, nextFrozenIds: ordered.map((row) => row.id) };
}
