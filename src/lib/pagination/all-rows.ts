import { isTransientPostgrestError } from "./keyset";

export const FULL_READ_PAGE_SIZE = 500;

type PageError = { message: string; code?: string };

export type FullReadPage<T, E extends PageError = PageError> = {
  data: T[] | null;
  error: E | null;
  count?: number | null;
  status?: number;
};

/**
 * Read a complete, scoped collection without depending on PostgREST max_rows.
 *
 * Pages walk the immutable `id` keyset in order, one request at a time. The
 * walk stops at an empty page, or at a short page once the first page's exact
 * count has been reached.
 *
 * It never stops just because the count was reached on a FULL page. A row
 * inserted above the cursor during the walk would push an original row past
 * that point, and the original row would be dropped silently.
 *
 * A short page below the count is not treated as the end: the server may cap
 * pages below `pageSize`. If the set only shrank, the next page comes back
 * empty and the walk ends.
 *
 * Every row that matched for the whole walk is returned. Rows that left the
 * filter between pages (archived, closed, moved out of scope) are not, so
 * `data.length` can end up below `count`. That means the set changed, not that
 * the read was truncated, and it is the caller's choice whether to log it.
 */
export async function readAllRowsById<T extends { id: string }, E extends PageError = PageError>(
  readPage: (
    afterId: string | null,
    pageSize: number,
    withCount: boolean,
  ) => PromiseLike<FullReadPage<T, E>>,
  pageSize = FULL_READ_PAGE_SIZE,
): Promise<FullReadPage<T, E>> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("Full read page size must be between 1 and 1000.");
  }

  const rows: T[] = [];
  const seenIds = new Set<string>();
  let afterId: string | null = null;
  let count: number | null = null;
  for (;;) {
    const withCount = afterId === null;
    let page = await readPage(afterId, pageSize, withCount);
    if (page.error && isTransientPostgrestError({ ...page.error, status: page.status })) {
      page = await readPage(afterId, pageSize, withCount);
    }
    if (page.error) return { data: null, error: page.error, count };
    if (page.data === null) throw new Error("Full read returned no rows without an error.");
    if (withCount && typeof page.count === "number") count = page.count;
    const batch = page.data;
    if (batch.length === 0) break;
    for (const row of batch) {
      if (typeof row.id !== "string" || seenIds.has(row.id)) {
        throw new Error("Full read cursor did not advance.");
      }
      seenIds.add(row.id);
      afterId = row.id;
      rows.push(row);
    }
    if (batch.length < pageSize && count !== null && rows.length >= count) break;
  }
  return { data: rows, error: null, count };
}
