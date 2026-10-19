type ListRow = { id: string; created_at: string };

export type BellList<T extends ListRow> = { items: T[]; hasMore: boolean; fetchedAt: number | null };

/**
 * One list from several: each id once (the first list wins, so pass the
 * freshest first), newest first.
 */
export function mergeNotifs<T extends ListRow>(...lists: T[][]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const list of lists) {
    for (const row of list) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/**
 * Puts a fresh first page on top of a list that may already hold older pages.
 * When the fresh page shares no row with that list, more than a page arrived
 * in between and rows may sit between the two: start over from the fresh page
 * rather than show a list with a hole in it.
 */
export function mergeFirstPage<T extends ListRow>(
  fresh: T[],
  freshHasMore: boolean,
  current: Pick<BellList<T>, "items" | "hasMore">,
): Pick<BellList<T>, "items" | "hasMore"> {
  if (current.items.length === 0 || fresh.length === 0) {
    return { items: fresh, hasMore: freshHasMore };
  }
  const currentIds = new Set(current.items.map((row) => row.id));
  if (freshHasMore && !fresh.some((row) => currentIds.has(row.id))) {
    return { items: fresh, hasMore: freshHasMore };
  }
  const boundary = Date.parse(fresh[fresh.length - 1].created_at);
  const reachesFurther = current.items.some((row) => Date.parse(row.created_at) < boundary);
  return {
    items: mergeNotifs(fresh, current.items),
    hasMore: freshHasMore ? (reachesFurther ? current.hasMore : true) : false,
  };
}
