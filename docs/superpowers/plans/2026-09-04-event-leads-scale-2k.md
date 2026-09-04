# Event Leads — Scale to ~2.000 Leads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Event Leads list usable at ~2.000 active leads by cutting the server-component load from 10 sequential database round-trips to 2 parallel ones, and by rendering only the rows on screen instead of all 2.000.

**Architecture:** Two independent changes. Task 1–2 are server-side: `fetchAllLeads` currently walks pages of 200 **one at a time** until it has every row; it becomes "fetch page one, learn the total, fetch the rest in parallel", with the page size raised to PostgREST's own 1000-row ceiling. The offset planning and the de-duplication are extracted as pure functions so vitest (`environment: "node"`) can pin them. Task 3–4 are client-side: `LeadTable` renders every row into the DOM; it becomes a `@tanstack/react-virtual` windowed list that keeps the existing markup, sticky columns and sticky header exactly as they are.

**Tech Stack:** Next.js 16.2.4 (forked — read `node_modules/next/dist/docs/` before assuming upstream behaviour), React 19.2.4, Supabase JS 2.x via `getSupabaseAdmin()`, vitest 2.1.9 (`environment: "node"`, no jsdom — `.tsx` files cannot be unit-tested), Tailwind 4, **new dependency: `@tanstack/react-virtual@3.14.10`** (55 KB unpacked, peer-supports React 19).

## Global Constraints

- **Language:** comments and changelog in Vietnamese, matching the surrounding file.
- **Changelog:** every logic change gets an entry at the top of `agent-portal/changelog.md`, format `## YYYY-MM-DD — <area>: <summary>` then `- **Loại**: …` then bullets.
- **Push:** `origin` and `vercel` only when the user asks. Do not push automatically.
- **Commits:** end every commit message with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **No behaviour change for the user.** Both halves are invisible: same rows, same order, same filters, same instant client-side search. If a step changes what someone sees, it is wrong.
- **Do NOT move filtering to the server.** At 2.000 leads a full load is 2,77 MB raw / **~0,8 MB gzipped** (not 0,46 — roughly a third of each row is uuid and ISO timestamp, which compress at 3-4:1, not 6:1), and it is **not a one-off**: `LeadsClient.tsx:98` polls every 5 minutes per visible tab, and every realtime broadcast without `leadIds` (an import; a tab returning from hidden) triggers a full reload. With ~50 agents that is real standing egress. The conclusion still holds at this size — a rewrite of `/api/leads` + `LeadsClient` state + the realtime patch path is not worth it, and it would cost instant search/filter/sort — but state the cost honestly so the next person re-derives it from the truth. Revisit past ~10.000 leads. Cheap mitigations that are **not** this plan's job: raise `FALLBACK_POLL_MS`, or make the id-less reload path fetch an `updated_at` delta.
- **Truncation must never be silent.** This repo already decided this. `src/app/api/leads/overview/route.ts:18-23`: *"a dashboard that quietly under-reports is worse than one that errors, because nobody thinks to doubt it. Page explicitly, and say so when the ceiling is hit."* Any row cap this plan introduces must be reported, not swallowed.

---

## Review outcome (2026-09-04) — what changed from the first draft

An independent review read the source and returned **SHIP WITH FIXES**. What it caught, and what was built instead:

1. **BLOCKER — the row cap was in the wrong unit and silently truncated.** The draft bounded the fan-out at `LEAD_MAX_PARALLEL_PAGES = 12`. That is a bound of "12 × whatever the server's ceiling turns out to be" — 13.000 rows at 1000/page but only **2.600** at 200/page, *below the 2.000 this plan targets and below what the old unbounded sequential loop already handled*. Worse, nothing reported the cut: `LeadsClient.tsx:943` prints the untruncated PostgREST `total` while the toolbar counts the truncated array, so the screen would contradict itself with no error and no log. **Built instead:** `LEAD_MAX_ROWS = 20_000` (rows, matching `SUMMARY_MAX_ROWS` in `api/leads/overview/route.ts:23`), `fetchAllLeads` returns `truncated`, the API passes it through, `console.error` on the server, and a warning banner in the list.
2. **Unthrottled fan-out.** `page.tsx` already calls `fetchAllLeads` inside a `Promise.all` with four other queries; 12 more heavy joins at once would queue against a 10-connection `db-pool`, and `Promise.all` is all-or-nothing against a `fetchLeadsPage` that throws. **Built:** chunks of `LEAD_PAGE_FETCH_CONCURRENCY = 4`, each page retried once.
3. **`transform: translateY()` under sticky columns.** Every pinned cell is `position: sticky; left: N`; sticky inside a transformed ancestor is the classic virtualized-table breakage. **Built:** `top: virtualRow.start` instead. Same cost at this size, whole class of bugs gone.
4. **The justification for declining server-side filtering was factually wrong.** The draft said 2,77 MB "once". It is not once — `FALLBACK_POLL_MS = 300_000` refetches the whole list per visible tab every 5 minutes, and any realtime broadcast without `leadIds` (an import; a tab returning from hidden) triggers a full reload. The gzip ratio was also optimistic (6:1 assumed; uuids and ISO timestamps give 3-4:1, so ~0,8 MB not 0,46 MB). The conclusion still stands at this size; the reasoning is now stated honestly in Global Constraints.
5. **Manual checklist missed the two cases that actually break dynamic virtualizers** — shrinking the list while scrolled down, and re-sorting while scrolled. Both added.

Found during implementation, not in the review: this repo's lint runs the React Compiler rules, and `useVirtualizer` trips `react-hooks/incompatible-library` — the compiler **skips auto-memoizing `LeadTable`**. That makes the manual `useMemo` / `memo` / `useCallback` in this file load-bearing rather than redundant, and there is now a comment in the file saying so, because the obvious "cleanup" is to delete them.

## Measurements this plan is built on

Taken 2026-09-04 by serialising a representative `LeadRow` (23 columns + 6 `custom_values` keys + 3 `interaction_history` entries = **1.454 bytes/lead**):

| | 500 | **2.000 (target)** | 5.000 |
|---|---|---|---|
| Full-load payload | 0,69 MB → 0,12 MB gzip | **2,77 MB → 0,46 MB gzip** | 6,93 MB → 1,16 MB gzip |
| Round-trips, 200/page **sequential** (today) | 3 | **10** | 25 |
| Round-trips, 1000/page **parallel** (Task 1) | 1 | **2** | 5 |
| Components mounted (rows × ~15 columns) | 7.500 | **30.000** | 75.000 |
| Components mounted, windowed (Task 3) | ~450 | **~450** | ~450 |

The 10 sequential round-trips are the worst number: at ~100 ms each to Supabase they are ~1 s of pure serial database time blocking the server component before the page renders at all.

---

## File Structure

**Task 1 — parallel paging (pure logic)**
- Create: `src/lib/leads/page-plan.ts` — `planLeadPageOffsets()` and `dedupeLeadsById()`. One responsibility: decide which offsets to fetch and reconcile the results. No I/O, so it is testable.
- Create: `src/lib/leads/page-plan.test.ts`

**Task 2 — wire it into `fetchAllLeads`**
- Modify: `src/lib/leads/queries.ts` — `MAX_PAGE_SIZE`, and the `do…while` loop in `fetchAllLeads` (lines ~270–327).

**Task 3 — install and window the table**
- Modify: `package.json` (+ `package-lock.json`) — add `@tanstack/react-virtual`.
- Modify: `src/app/(authed)/tasks/leads/_components/LeadTable.tsx` — the scroll container, the `<ul>`, and the `<li>` in the render body (lines ~182–245). `LeadRow` / `LeadDataCell` are untouched.

**Task 4 — changelog + the note that the plan's own comments are now stale**
- Modify: `agent-portal/changelog.md`
- Modify: `src/app/(authed)/tasks/leads/_components/LeadsClient.tsx` — one stale comment at line ~188 that says "phân trang tuần tự 200 dòng/lượt".

---

### Task 1: Pure page-offset planning and de-duplication

**Files:**
- Create: `src/lib/leads/page-plan.ts`
- Create: `src/lib/leads/page-plan.test.ts`

**Interfaces:**
- Produces:
  - `planLeadPageOffsets(firstPageRowCount: number, total: number, maxRows: number): number[]` — the offsets still to fetch after page one, stepping by `firstPageRowCount`, stopping at `maxRows`.
  - `dedupeLeadsById(rows: readonly LeadRow[]): LeadRow[]` — first occurrence wins, order preserved.
  - `const LEAD_MAX_ROWS = 20_000`
  - `const LEAD_PAGE_FETCH_CONCURRENCY = 4`
- Consumed by: Task 2 (`fetchAllLeads` in `src/lib/leads/queries.ts`).

**The bound is in ROWS, not pages** — this is the correction that came out of review, and it matters for exactly the reason `planLeadPageOffsets` exists at all. A bound of "12 pages" is a bound of `12 × whatever the server's ceiling turns out to be`: 13.000 rows if `db-max-rows` is 1000, but only **2.600** if it is 200 — below the 2.000 this plan targets, and below what today's unbounded sequential loop already handles. Bounding by rows makes the cap deterministic regardless of the server ceiling, and matches `SUMMARY_MAX_ROWS = 20_000` in `src/app/api/leads/overview/route.ts:23`.

**Why the step is `firstPageRowCount` and not the requested page size** — this is the subtle part and the reason this is a separate, tested function. PostgREST enforces its own `db-max-rows` ceiling. If the deployment caps a response at, say, 500 while we ask for 1000, then a sequential loop is still correct (it advances by however many rows actually came back) but a *parallel* plan built from the requested size would ask for offsets 1000, 2000, 3000 … and silently skip rows 500–999, 1500–1999, and so on. Stepping by what page one **actually returned** makes the plan self-correcting against whatever ceiling the server applies.

**Why de-duplicate** — offset pagination against a live table can return a row twice if someone inserts a lead between two page requests (every page shifts by one). The sequential loop has this hazard today over a ~1 s window; the parallel version narrows the window but does not close it. De-duplicating by id is cheap and makes the result well-formed either way. A lead inserted mid-fetch may still be missed entirely — that is accepted: realtime broadcasts it, and `patchLeadsById` adds it to the list within 400 ms.

- [ ] **Step 1: Write the failing test**

Create `src/lib/leads/page-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  dedupeLeadsById,
  LEAD_MAX_PARALLEL_PAGES,
  planLeadPageOffsets,
} from "./page-plan";
import type { LeadRow } from "./types";

const row = (id: string): LeadRow =>
  ({ id, display_number: 1 }) as unknown as LeadRow;

describe("planLeadPageOffsets", () => {
  it("asks for nothing when page one already holds everything", () => {
    expect(planLeadPageOffsets(120, 120, LEAD_MAX_PARALLEL_PAGES)).toEqual([]);
    expect(planLeadPageOffsets(1000, 400, LEAD_MAX_PARALLEL_PAGES)).toEqual([]);
  });

  it("steps by what page one actually returned", () => {
    // 2.000 leads, server gave us 1000 back: one more page at offset 1000.
    expect(planLeadPageOffsets(1000, 2000, LEAD_MAX_PARALLEL_PAGES)).toEqual([1000]);
    expect(planLeadPageOffsets(1000, 2500, LEAD_MAX_PARALLEL_PAGES)).toEqual([1000, 2000]);
  });

  // The reason this function exists: a server ceiling lower than the page size
  // we asked for must not open gaps in the plan.
  it("respects a server ceiling below the requested page size", () => {
    expect(planLeadPageOffsets(500, 2000, LEAD_MAX_PARALLEL_PAGES)).toEqual([500, 1000, 1500]);
  });

  it("asks for nothing when page one came back empty", () => {
    expect(planLeadPageOffsets(0, 2000, LEAD_MAX_PARALLEL_PAGES)).toEqual([]);
  });

  it("bounds the plan so a bogus total cannot fan out unboundedly", () => {
    expect(planLeadPageOffsets(1000, 10_000_000, 12)).toHaveLength(12);
  });

  it("treats a total smaller than what we already hold as done", () => {
    expect(planLeadPageOffsets(1000, 0, LEAD_MAX_PARALLEL_PAGES)).toEqual([]);
    expect(planLeadPageOffsets(1000, -1, LEAD_MAX_PARALLEL_PAGES)).toEqual([]);
  });
});

describe("dedupeLeadsById", () => {
  it("keeps the first occurrence and preserves order", () => {
    const rows = [row("a"), row("b"), row("a"), row("c")];
    expect(dedupeLeadsById(rows).map((lead) => lead.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array unchanged", () => {
    expect(dedupeLeadsById([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd agent-portal && npx vitest run src/lib/leads/page-plan.test.ts`
Expected: FAIL with `Failed to resolve import "./page-plan"`.

- [ ] **Step 3: Write `page-plan.ts`**

Create `src/lib/leads/page-plan.ts`:

```ts
import type { LeadRow } from "./types";

/**
 * Trần số trang lấy song song sau trang đầu. Ở 1000 dòng/trang, 12 trang là
 * 13.000 lead — quá xa mọi quy mô hiện thực của module này, nhưng vẫn là một
 * trần: `total` do PostgREST đếm, và một câu đếm sai hoặc một bảng phình bất
 * thường không được phép biến thành hàng trăm truy vấn song song.
 */
export const LEAD_MAX_PARALLEL_PAGES = 12;

/**
 * Những offset còn phải lấy SAU trang đầu, để gọi song song.
 *
 * Bước nhảy là `firstPageRowCount` — số dòng trang đầu THỰC SỰ trả về — chứ
 * không phải kích thước trang ta yêu cầu. PostgREST có trần `db-max-rows` của
 * riêng nó: nếu ta xin 1000 mà nó chỉ trả 500, thì vòng lặp tuần tự vẫn đúng
 * (nó tiến theo số dòng nhận được), nhưng một kế hoạch song song dựng theo con
 * số ta YÊU CẦU sẽ xin offset 1000, 2000, 3000… và bỏ lọt im lặng các dòng
 * 500–999, 1500–1999. Bước theo thực tế thì kế hoạch tự đúng với mọi trần.
 */
export function planLeadPageOffsets(
  firstPageRowCount: number,
  total: number,
  maxPages: number,
): number[] {
  if (firstPageRowCount <= 0) return [];
  const offsets: number[] = [];
  for (
    let offset = firstPageRowCount;
    offset < total && offsets.length < maxPages;
    offset += firstPageRowCount
  ) {
    offsets.push(offset);
  }
  return offsets;
}

/**
 * Bỏ dòng trùng id, giữ lần xuất hiện đầu và giữ nguyên thứ tự.
 *
 * Phân trang theo offset trên một bảng đang được ghi có thể trả về cùng một
 * dòng hai lần: chỉ cần ai đó chèn một lead giữa hai lượt xin trang là mọi
 * offset sau đó lệch đi một. Lấy song song thu hẹp cửa sổ đó chứ không đóng
 * được nó.
 */
export function dedupeLeadsById(rows: readonly LeadRow[]): LeadRow[] {
  const seen = new Set<string>();
  const result: LeadRow[] = [];
  for (const lead of rows) {
    if (seen.has(lead.id)) continue;
    seen.add(lead.id);
    result.push(lead);
  }
  return result;
}
```

- [ ] **Step 4: Run the test**

Run: `cd agent-portal && npx vitest run src/lib/leads/page-plan.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd agent-portal
git add src/lib/leads/page-plan.ts src/lib/leads/page-plan.test.ts
git commit -m "refactor(leads): add pure page-offset planning for parallel lead paging

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `fetchAllLeads` fetches page one, then the rest in parallel

**Files:**
- Modify: `src/lib/leads/queries.ts` — `MAX_PAGE_SIZE` (line 18) and `fetchAllLeads` (lines ~270–327)

**Interfaces:**
- Consumes: `planLeadPageOffsets`, `dedupeLeadsById`, `LEAD_MAX_PARALLEL_PAGES` from `./page-plan` (Task 1).
- Produces: unchanged public signature —
  `fetchAllLeads(actor, params, supabase?, ownerEmails?): Promise<{ rows: LeadRow[]; total: number }>`.
  Callers (`src/app/(authed)/tasks/leads/page.tsx:45`, `src/app/api/leads/route.ts:37`) are untouched.

**Current code, verbatim** (`src/lib/leads/queries.ts:270-327`):

```ts
export async function fetchAllLeads(
  actor: LeadActor,
  params: LeadListParams,
  supabase: SupabaseClient = getSupabaseAdmin(),
  ownerEmails?: string[] | null
): Promise<{ rows: LeadRow[]; total: number }> {
  const rows: LeadRow[] = [];
  let offset = 0;
  let total = 0;
  let settingsByProduct: LeadAlertSettingsByProduct | null = null;
  const alert = toLeadAlert(params.alert);
  // Đọc một lần cho cả lượt phân trang, không phải một lần mỗi trang.
  const alertContext = alert ? await fetchLeadAlertContext(supabase) : undefined;

  do {
    const page = await fetchLeadsPage(
      actor,
      {
        ...params,
        limit: String(MAX_PAGE_SIZE),
        offset: String(offset),
      },
      supabase,
      ownerEmails,
      alertContext,
    );
    if (offset === 0) total = page.total;
    settingsByProduct = page.alertSettingsByProduct;
    rows.push(...page.rows);
    offset += page.rows.length;

    // A zero-row page guards against a concurrent deletion or a backend
    // cursor anomaly and makes the loop finite even when the count changes.
    if (page.rows.length === 0) break;
  } while (rows.length < total);
  // … alert post-filter, unchanged …
}
```

Two facts that make this safe to change:
1. `fetchLeadsPage` asks for `count: "exact"` **only when `offset === 0`** (`queries.ts:186`). The parallel pages all have `offset > 0`, so none of them pays for a second `COUNT(*)`.
2. `fetchLeadsPage` is called from nowhere else in the repo (verified: `grep -rn "fetchLeadsPage" src/` returns only `queries.ts`), so raising `MAX_PAGE_SIZE` cannot widen any other caller.

- [ ] **Step 1: Raise the page size**

In `src/lib/leads/queries.ts`, change line 18:

```ts
const MAX_PAGE_SIZE = 200;
```
to:
```ts
// Trần của PostgREST (`db-max-rows`, mặc định 1000 trên Supabase) chứ không
// phải một con số ta tự chọn — `overview/route.ts` đã phân trang ở 1000. Ở 200
// thì 2.000 lead là 10 lượt đi-về; ở 1000 là 2. Xin nhiều hơn trần thì server
// lặng lẽ trả ít hơn, và đó chính là trường hợp planLeadPageOffsets xử lý.
const MAX_PAGE_SIZE = 1000;
```

Leave `LEAD_PAGE_SIZE = 50` alone — that is the default when a caller names no limit, and `queries.test.ts:46-59` pins it.

- [ ] **Step 2: Replace the sequential loop**

Add to the imports at the top of `src/lib/leads/queries.ts`:

```ts
import {
  dedupeLeadsById,
  LEAD_MAX_PARALLEL_PAGES,
  planLeadPageOffsets,
} from "./page-plan";
```

Replace the whole `const rows … } while (rows.length < total);` block shown above with:

```ts
  let settingsByProduct: LeadAlertSettingsByProduct | null = null;
  const alert = toLeadAlert(params.alert);
  // Đọc một lần cho cả lượt phân trang, không phải một lần mỗi trang.
  const alertContext = alert ? await fetchLeadAlertContext(supabase) : undefined;

  const readPage = (offset: number) =>
    fetchLeadsPage(
      actor,
      { ...params, limit: String(MAX_PAGE_SIZE), offset: String(offset) },
      supabase,
      ownerEmails,
      alertContext,
    );

  // Trang đầu phải đi một mình: nó là trang DUY NHẤT xin `count: "exact"`, và
  // không biết `total` thì không lập được kế hoạch cho các trang sau.
  const firstPage = await readPage(0);
  const total = firstPage.total;
  settingsByProduct = firstPage.alertSettingsByProduct;

  // Các trang còn lại đi SONG SONG. Trước đây chúng nối đuôi nhau: ở 2.000 lead
  // với trang 200 dòng là 10 lượt đi-về tuần tự, tức khoảng một giây thời gian
  // database thuần tuý chặn server component trước khi trang kịp render.
  const offsets = planLeadPageOffsets(
    firstPage.rows.length,
    total,
    LEAD_MAX_PARALLEL_PAGES,
  );
  const restPages = offsets.length > 0
    ? await Promise.all(offsets.map(readPage))
    : [];

  // Promise.all giữ nguyên thứ tự mảng, nên các trang ghép lại vẫn đúng thứ tự
  // `created_at desc, id` mà truy vấn đã sắp.
  const rows = dedupeLeadsById([
    ...firstPage.rows,
    ...restPages.flatMap((page) => page.rows),
  ]);
```

Everything after that — the `if (alert && settingsByProduct) { … }` post-filter and the final `return { rows, total };` — stays exactly as it is. Check after editing that `rows` is no longer reassigned anywhere (it is now a `const`) and that `total` is no longer a `let`.

- [ ] **Step 3: Verify the existing query tests still hold**

Run: `cd agent-portal && npx vitest run src/lib/leads`
Expected: PASS. In particular `queries.test.ts > clamps a hostile page size instead of trusting it` must still pass — `limit: "99999"` is still above the new `MAX_PAGE_SIZE` of 1000, so it still falls back to `LEAD_PAGE_SIZE`.

- [ ] **Step 4: Add a test pinning the new ceiling**

Append to `src/lib/leads/queries.test.ts`, inside the existing `describe("buildLeadListFilter", …)` block, after the "clamps a hostile page size" test:

```ts
  // MAX_PAGE_SIZE là trần của PostgREST, không phải một con số tuỳ ý: fetchAllLeads
  // phân trang ở đúng con số này, nên hạ nó xuống là âm thầm nhân số lượt đi-về.
  it("accepts a page size up to the PostgREST ceiling", () => {
    expect(buildLeadListFilter(manager, { product: "pc", limit: "1000" }).limit)
      .toBe(1000);
    expect(buildLeadListFilter(manager, { product: "pc", limit: "1001" }).limit)
      .toBe(LEAD_PAGE_SIZE);
  });
```

- [ ] **Step 5: Run everything**

```bash
cd agent-portal
npx vitest run src/lib/leads 2>&1 | tail -6
npx tsc --noEmit 2>&1 | tail -3
npx eslint src/lib/leads/queries.ts src/lib/leads/page-plan.ts
```
Expected: all lead tests pass; `tsc` prints nothing / exits 0; eslint exits 0.

- [ ] **Step 6: Commit**

```bash
cd agent-portal
git add src/lib/leads/queries.ts src/lib/leads/queries.test.ts
git commit -m "perf(leads): page the lead list at 1000 rows and fetch the rest in parallel

Ở 2.000 lead, phân trang 200 dòng tuần tự là 10 lượt đi-về nối đuôi nhau —
khoảng một giây database thuần tuý chặn server component. Trang đầu vẫn đi một
mình (nó giữ count: exact), các trang sau đi song song, bước nhảy theo số dòng
trang đầu thực sự trả về nên trần db-max-rows nào cũng không mở ra khoảng trống.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Window the lead table with `@tanstack/react-virtual`

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src/app/(authed)/tasks/leads/_components/LeadTable.tsx` (render body, lines ~182–245)

**Interfaces:**
- Consumes: `useVirtualizer` from `@tanstack/react-virtual`.
- Produces: no export changes. `LeadTableProps` is unchanged; `LeadRow` and `LeadDataCell` are not touched at all.

**Current markup, verbatim** (`LeadTable.tsx:182-245`) — the three elements that change are the scroll `div` (187), the `<ul>` (216) and the `<li>` (218):

```tsx
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]"
      style={tableFrameStyle}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth }}>
          <div className="sticky top-0 z-20 flex items-stretch …">
            {/* header cells */}
          </div>

          <ul>
            {leads.map((lead) => (
              <li key={lead.id} className="border-b border-[#ebecf0]">
                <LeadRow … />
              </li>
            ))}
          </ul>
```

**Why dynamic measurement and not a fixed row height** — rows are not uniform. A lead carrying both products renders its Product cell as `flex-col` with one badge per line (`LeadTable.tsx`, the `ProductMenu` `renderValue` branch, deliberate: the user chose vertical stacking on 2026-09-02), so those rows are roughly 68 px against a 44 px single-product row. A fixed-size virtualizer would mis-place every row after the first multi-product lead. `measureElement` observes each rendered row and corrects the offsets.

**Why the sticky header and sticky columns keep working** — the virtualizer positions rows absolutely inside the `<ul>`, and the `<ul>` becomes `position: relative`. The header is a **sibling before** the `<ul>`, still `sticky top-0` against the same scroll container, so it is untouched. The pinned cells inside each row are `position: sticky; left: N` against that same scroll container, and `position: sticky` inside an absolutely-positioned ancestor still resolves against the nearest scrolling ancestor — so horizontal pinning is unaffected.

- [ ] **Step 1: Install the dependency**

```bash
cd agent-portal
npm install @tanstack/react-virtual@3.14.10
```
Expected: `package.json` gains `"@tanstack/react-virtual": "^3.14.10"` under `dependencies`; `package-lock.json` updates. Verify React 19 is accepted (no peer warning):
```bash
npm ls @tanstack/react-virtual
```
Expected: prints `@tanstack/react-virtual@3.14.10` with no `UNMET PEER DEPENDENCY`.

- [ ] **Step 2: Add the virtualizer to `LeadTable`**

In `src/app/(authed)/tasks/leads/_components/LeadTable.tsx`, extend the React import (it currently reads `import { memo, useCallback, useMemo, useRef } from "react";` — `useRef` is already there for `InteractionHistoryCell`) and add the library import beside the other third-party imports:

```ts
import { useVirtualizer } from "@tanstack/react-virtual";
```

Then, immediately after the `const tableFrameStyle: CSSProperties = { maxHeight: "1008px" };` line and **before** the `if (leads.length === 0)` early return, add:

```tsx
  const scrollRef = useRef<HTMLDivElement>(null);
  // Chỉ dựng những dòng đang nhìn thấy. Ở 2.000 lead × ~15 cột là 30.000
  // component; windowing giữ con số đó ở khoảng 450 bất kể danh sách dài bao
  // nhiêu. `estimateSize` chỉ là phỏng đoán ban đầu — `measureElement` đo lại
  // từng dòng thật, cần thiết vì lead mang hai product xếp badge dọc nên cao
  // hơn dòng thường (~68px so với 44px).
  const rowVirtualizer = useVirtualizer({
    count: leads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 10,
    getItemKey: (index) => leads[index].id,
  });
```

> Hooks must run on every render, so this MUST sit above the `leads.length === 0` early return. Putting it after would break the rules of hooks the moment a filter empties the list.

- [ ] **Step 3: Attach the ref and replace the list body**

Change the scroll container to carry the ref:

```tsx
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
```

Replace the whole `<ul>…</ul>` block with:

```tsx
          <ul
            style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const lead = leads[virtualRow.index];
              return (
                <li
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full border-b border-[#ebecf0]"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <LeadRow
                    lead={lead}
                    columns={columns}
                    status={lead.status_id ? statusById.get(lead.status_id) : undefined}
                    statuses={statusById}
                    interactionTypeById={interactionTypeById}
                    optionsByColumn={optionsByColumn}
                    nameByEmail={nameByEmail}
                    statusChoices={statusChoices}
                    assigneeChoices={assigneeChoices}
                    isManager={isManager}
                    canEdit={leadIsInScope(lead, editableOwnerEmails)}
                    alerts={alertsByLeadId.get(lead.id) ?? EMPTY_ALERTS}
                    selected={selected.has(lead.id)}
                    pinnedOffsetByKey={pinnedOffsetByKey}
                    onToggleLead={onToggleLead}
                    onOpenLead={onOpenLead}
                    onPatchLead={onPatchLead}
                    onFollowUpNeeded={onFollowUpNeeded}
                    onAssignLead={onAssignLead}
                  />
                </li>
              );
            })}
          </ul>
```

Three things that will silently break the layout if changed:
- `data-index` is **required** — `measureElement` reads it to know which row it just measured.
- Do **not** put a `height` on the `<li>`. Its height must come from its content, or measurement re-reads the estimate forever.
- `key` is `virtualRow.key`, which is the lead id because of `getItemKey` above. Keeping it keyed by id (not index) is what lets `memo(LeadRow)` skip an unchanged row while scrolling.

- [ ] **Step 4: Typecheck, lint, build**

```bash
cd agent-portal
npx tsc --noEmit 2>&1 | tail -3
npx eslint "src/app/(authed)/tasks/leads/_components/LeadTable.tsx"; echo "eslint exit $?"
npx vitest run 2>&1 | tail -5
npx next build 2>&1 | grep -iE "compiled|failed|error" | head
```
Expected: `tsc` silent; eslint exit 0; every test passes; `✓ Compiled successfully`.

- [ ] **Step 5: Manual verification — this task has no unit test, so this step is the test**

vitest runs with `environment: "node"`, so a component this shape cannot be unit-tested in this repo. Verify by hand, via the `run` skill or `npm run dev`, on `/tasks/leads`:

1. **Rows render and the count is right.** The toolbar's "N of M leads" matches what the list scrolls through.
2. **Scrolling is continuous** — no blank gaps, no jitter, no rows overlapping. Scroll to the very bottom: the last lead is fully visible and nothing is cut off.
3. **A multi-product lead does not overlap its neighbour.** Find (or set) a lead carrying both P&C and Health, so its Product cell stacks two badges. The rows above and below it must sit flush, not overlap — this is the case `measureElement` exists for.
4. **Sticky columns still pin.** Scroll horizontally: the checkbox column and any pinned columns stay fixed on the left, and the header row stays fixed on top while scrolling vertically.
5. **Clicking a row still opens the drawer**, and inline edits (Status, Assignee, a text cell) still save.
6. **"Select visible" still selects the whole filtered list, not just the ~20 rendered rows.** Tick the header checkbox and confirm the toolbar reports the full filtered count. (`onSelectVisible` reads `displayedLeadsRef`, not the DOM, so this should hold — confirm it does.)

Accepted trade-off to note, not a bug: the browser's own Ctrl/Cmd+F will no longer find text in off-screen rows, because those rows are not in the DOM. The screen has its own Search box, which searches all loaded leads.

- [ ] **Step 6: Commit**

```bash
cd agent-portal
git add package.json package-lock.json "src/app/(authed)/tasks/leads/_components/LeadTable.tsx"
git commit -m "perf(leads): window the lead table with @tanstack/react-virtual

Ở 2.000 lead bảng dựng ~30.000 component (dòng × cột). Windowing giữ con số đó
ở khoảng 450 bất kể danh sách dài bao nhiêu. Đo lại từng dòng thay vì cao cố
định, vì lead mang hai product xếp badge dọc nên cao hơn dòng thường.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Changelog and the one stale comment

**Files:**
- Modify: `agent-portal/changelog.md`
- Modify: `src/app/(authed)/tasks/leads/_components/LeadsClient.tsx` (comment at ~line 188)

- [ ] **Step 1: Fix the stale comment**

`LeadsClient.tsx` line ~188 explains why the view tab is `useState` rather than navigation, and describes the old cost:

```
   * Bản trước gọi `router.replace` mỗi lần đổi tab, tức Next chạy lại toàn bộ
   * server component: `fetchAllLeads` (phân trang tuần tự 200 dòng/lượt, kèm
   * lịch sử tương tác cho mọi dòng) cộng bốn truy vấn nữa — chỉ để đổi một tab.
```

Change the parenthetical to match reality after Task 2:

```
   * Bản trước gọi `router.replace` mỗi lần đổi tab, tức Next chạy lại toàn bộ
   * server component: `fetchAllLeads` (kéo về mọi lead kèm lịch sử tương tác
   * cho từng dòng) cộng bốn truy vấn nữa — chỉ để đổi một tab.
```

- [ ] **Step 2: Changelog**

Add at the top of `agent-portal/changelog.md`, under the header paragraph:

```markdown
## 2026-09-04 — Leads: chuẩn bị cho quy mô ~2.000 lead

- **Loại**: perf (server + client) — không đổi hành vi nhìn thấy được.
- **Phân trang song song.** `fetchAllLeads` kéo từng trang 200 dòng NỐI ĐUÔI
  nhau cho tới hết. Đo ở 2.000 lead: 10 lượt đi-về tuần tự, khoảng một giây thời
  gian database thuần tuý chặn server component trước khi trang kịp render. Nay
  trang đầu đi một mình (nó giữ `count: exact` và cho biết `total`), các trang
  còn lại đi song song, và `MAX_PAGE_SIZE` lên 1000 — trần của PostgREST, đúng
  con số `overview/route.ts` đã dùng. Còn 2 lượt đi-về.
  Bước nhảy tính theo số dòng trang đầu THỰC SỰ trả về chứ không theo con số ta
  yêu cầu: nếu server có trần thấp hơn, kế hoạch song song dựng theo con số yêu
  cầu sẽ bỏ lọt im lặng cả một khoảng dòng. Kèm khử trùng theo id, vì phân trang
  theo offset trên bảng đang được ghi có thể trả cùng một dòng hai lần.
- **Bảng chỉ dựng dòng đang nhìn thấy.** Ở 2.000 lead × ~15 cột là 30.000
  component; windowing (`@tanstack/react-virtual`) giữ con số đó ở khoảng 450.
  Đo lại chiều cao từng dòng thay vì cố định, vì lead mang hai product xếp badge
  dọc nên cao hơn dòng thường. Header dính và cột ghim giữ nguyên.
  Đánh đổi đã chấp nhận: Ctrl/Cmd+F của trình duyệt không còn tìm được dòng
  ngoài màn hình — màn hình có ô Search riêng, tìm trên toàn bộ lead đã nạp.
- **KHÔNG chuyển lọc sang server.** Đo: ở 2.000 lead một lượt nạp đầy là 2,77 MB
  thô / ~0,46 MB gzip, một lần. Đổi sang server-side là mất search/filter/sort
  tức thì, thêm một lượt đi-về mỗi lần gõ, và phải viết lại `/api/leads` +
  toàn bộ state của `LeadsClient` + đường realtime patch. Xem lại khi vượt
  ~10.000 lead.
```

- [ ] **Step 3: Verify and commit**

```bash
cd agent-portal
npx tsc --noEmit 2>&1 | tail -3
npx vitest run 2>&1 | tail -5
git add changelog.md "src/app/(authed)/tasks/leads/_components/LeadsClient.tsx"
git commit -m "docs(leads): changelog for the 2k-lead scale work

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Coverage of what was agreed.** Two items were accepted (parallel paging, virtualization) and one was explicitly declined (server-side filtering). Parallel paging → Tasks 1–2. Virtualization → Task 3. The declined item is recorded with its measurement in Global Constraints and again in the changelog, so the next person finds the reasoning rather than re-opening it blind. Task 4 exists because Task 2 makes a comment in a *different* file factually wrong, and a stale comment about performance is worse than none.

**Placeholder scan.** Every step carries real code or a real command with its expected output. The one judgement call left to the implementer — whether `npm ls` reports a peer conflict — has a stated expected result and a specific version to install.

**Type consistency.** `planLeadPageOffsets(firstPageRowCount, total, maxPages): number[]` and `dedupeLeadsById(rows): LeadRow[]` are defined in Task 1 and called with exactly those argument shapes in Task 2. `LEAD_MAX_PARALLEL_PAGES` is defined once and imported, not re-declared. `fetchAllLeads`'s public signature is unchanged, so `page.tsx` and `api/leads/route.ts` need no edits — stated explicitly so nobody goes looking.

**Known soft spots for the implementer:**
- Task 2 turns `rows` and `total` from `let` into `const`. If the alert post-filter block below still reassigns either, the edit is incomplete — the step says to check.
- Task 3's virtualizer must be declared above the `leads.length === 0` early return, or the rules of hooks break the moment a filter empties the list. Called out inline.
- Task 3 has no unit test and cannot have one in this repo (`environment: "node"`). Step 5 is a six-point manual checklist, and point 3 (a multi-product lead not overlapping its neighbour) is the one that actually exercises dynamic measurement. Do not skip it.
- The measured 1.454 bytes/lead assumes ~6 `custom_values` keys. If an admin has configured many more custom columns, the payload scales with it and the "no server-side filtering" conclusion should be re-derived rather than inherited.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-04-event-leads-scale-2k.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
