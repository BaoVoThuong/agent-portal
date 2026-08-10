# List & Detail Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make editing feel immediate and keep rows still. Two confirmed symptoms with distinct
causes, plus one defect found while investigating. A fourth reported symptom was investigated and
closed without a fix.

**Architecture:** Two of the three are already solved correctly on one side of the product and not
the other, so the fix is to lift the working pattern rather than invent one. The third — rows
jumping while you work — needs a new concept: the list order is frozen for the session and only
recomputed on an explicit boundary.

**Tech Stack:** React 19, TypeScript, Next.js 16.2.4, Vitest (node environment).

---

## 1. Evidence

Read against `HEAD 67c803b`. **Proven** means I traced the code path end to end.

### R1 — Enrollment QC toggle has no optimistic feedback · PROVEN

`qc_checked` is a **request-only** key. The API translates it
(`src/app/api/enrollment/[id]/route.ts:234-235`):

```ts
patch.qc_checked_by_email = qcChecked ? actorResult.actor.email : null;
patch.qc_checked_at       = qcChecked ? nowIso : null;
```

The client's optimistic merge is a blind spread
(`EnrollmentClient.tsx:1020`):

```ts
const optimistic = { ...before, ...optimisticPatch } as EnrollmentRecordWithStats;
```

So it writes `qc_checked`, which **nothing renders**, and leaves `qc_checked_at` — which
*everything* renders — untouched:

```text
2592  list      Boolean(record.qc_checked_at)
3974  detail    Boolean(record.qc_checked_at)
4207  filter    record.qc_checked_at
4316  sort      record.qc_checked_at
```

**Health CS does not have this bug.** `TaskBoardClient.tsx:1930-1935` already translates its
equivalent request-only key:

```ts
  if (typeof optimistic.done_reviewed === "boolean") {
    const reviewed = optimistic.done_reviewed;
    delete optimistic.done_reviewed;
    optimistic.done_reviewed_by_email = reviewed ? currentEmail : null;
    optimistic.done_reviewed_at = reviewed ? new Date().toISOString() : null;
  }
```

**Explains both symptoms.** "Very slow": no optimistic feedback at all, so you wait for
PATCH → `patch_enrollment_atomic` → response → merge. "Sometimes doesn't register": two quick clicks
both compute `!record.qc_checked_at` from the same unchanged value, so both send `qc_checked: true`
and the second is a no-op — one click appears swallowed.

The same blind spread is replayed in `rebasePendingEnrollmentPatches:976-983`, so fixing only the
first merge would be undone whenever another mutation settles. Both paths must change.

### R2 — Rows reorder on every edit · PROVEN, worst of the three

**Health CS** (`TaskListView.tsx:104-108`): with no explicit column sort, order is
`rankTasks(tasks, rules, now)`, recomputed on every render from live task data. `rankTuple` band 2 is
"recently active", ordered by `-lastActivityMs`. Every patch bumps `last_activity_at`, so the row you
just touched jumps to the top of that band, under your cursor.

**Enrollment** (`EnrollmentClient.tsx:4252`) is worse — the tiebreak is:

```ts
    if (av === bv) return b.updated_at.localeCompare(a.updated_at);
```

`updated_at` changes on **every** patch, so editing any field reorders every row that ties on the
sorted column — even when the sorted column itself did not change.

This is the one the user called "cực kì tệ", and they stated the desired behaviour precisely: order
should only change on navigation or refresh, not while they are working.

### R3 — Enrollment text inputs remount on every value change · PROVEN, but not user-reported

`EnrollmentClient.tsx:3833` and `:3875` key uncontrolled inputs by their own value:

```tsx
      key={`${value}-${revertNonce}`}   // EditableText
      key={value}                        // EditableTextarea
```

Changing the key **destroys and recreates the DOM node**: focus is lost, cursor position resets, and
the field visibly flashes. Health CS's drawer does not do this.

**Nobody has complained about this.** It is a real defect I found while tracing R4, not a reported
symptom — the reporter's detail-drawer complaint turned out to be R1. Ship it after R1 and R2, and
drop it entirely if the effort is better spent elsewhere.

**Be careful here.** The pattern is deliberate — it resyncs an uncontrolled input when the prop
changes from outside. Removing the key without replacing that behaviour reintroduces stale text.
Task 3 handles it properly rather than just deleting the key.

### R4 — "Detail is slower than list for ordinary fields" · CLOSED, no action

The drawer receives `record={openRecord}` (`:1252`) and `openRecord` is
`records.find(...)` (`:807`) — the *same* optimistically-updated object the list renders. Select
controls in the drawer should therefore update in the same tick as the list.

I checked and ruled out: `beginPending` (a ref counter that only defers refetches, it disables
nothing), and any memo boundary between `openRecord` and the field controls.

**I could not find a code path that makes the drawer lag behind the list for ordinary fields.**

**Closed by the reporter on 2026-08-11:** dropdown changes in the detail drawer are confirmed fine,
and the QC toggle is confirmed smooth on Health CS but bad on Enrollment. That matches R1 exactly —
the perceived "detail is slow" was the QC control, not a detail-wide problem. No fix needed, and no
measurement task remains.

---

## 2. Global Constraints

- **Every fix lands on both products.** R1 and R3 are Enrollment-only *today* only because CS already
  solved them; R2 affects both and must be fixed in both.
- **Vitest collects `src/**/*.test.ts` only, in `environment: "node"`.** `.tsx` is not collected and
  there is no DOM harness, so every behaviour worth testing goes in a pure `.ts` helper.
- Tests import explicitly: `import { describe, expect, it } from "vitest";` (`globals: false`).
- **Do not change what the server stores or returns.** All three fixes are client-side rendering and
  ordering concerns. No API change, no schema change.
- **Do not weaken the concurrency model.** `patchRecord` / `patchTask` serialize per record and send
  `expected_updated_at`; the rebase replay exists to keep pending edits correct across conflicts.
  Fixes must preserve all of it.
- Every logic change gets a `changelog.md` entry in the same commit. Commit per task.

---

## 3. File Structure

| Path | Change | Task |
|---|---|---|
| `src/lib/enrollment/optimistic-patch.ts` (+ test) | Create | 1 |
| `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Modify | 1, 2, 3 |
| `src/lib/tasks/frozen-order.ts` (+ test) | Create | 2 |
| `src/app/(authed)/tasks/_components/TaskListView.tsx` | Modify | 2 |

---

## Task 1: Give the Enrollment QC toggle optimistic feedback (R1)

Lift the translation CS already performs. A pure module because the mapping is exactly the kind of
thing that silently drifts from the server.

**Files:**
- Create: `src/lib/enrollment/optimistic-patch.ts` + `.test.ts`
- Modify: `EnrollmentClient.tsx:1013-1020` (first merge) and `:976-983` (rebase replay)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/enrollment/optimistic-patch.test.ts
import { describe, expect, it } from "vitest";
import { toOptimisticEnrollmentPatch } from "@/lib/enrollment/optimistic-patch";

const ACTOR = "me@example.test";
const NOW = "2026-08-11T00:00:00.000Z";

describe("toOptimisticEnrollmentPatch", () => {
  it("translates qc_checked into the columns the UI actually renders", () => {
    expect(toOptimisticEnrollmentPatch({ qc_checked: true }, ACTOR, NOW)).toEqual({
      qc_checked_at: NOW,
      qc_checked_by_email: ACTOR,
      qc_stale_notified_at: null,
    });
  });

  it("clears both columns when qc_checked is false", () => {
    expect(toOptimisticEnrollmentPatch({ qc_checked: false }, ACTOR, NOW)).toEqual({
      qc_checked_at: null,
      qc_checked_by_email: null,
      qc_stale_notified_at: null,
    });
  });

  it("never leaks the request-only key into the row", () => {
    expect("qc_checked" in toOptimisticEnrollmentPatch({ qc_checked: true }, ACTOR, NOW)).toBe(false);
  });

  it("passes ordinary column patches through untouched", () => {
    expect(
      toOptimisticEnrollmentPatch({ client_name: "A", stage_id: "s1" }, ACTOR, NOW)
    ).toEqual({ client_name: "A", stage_id: "s1" });
  });

  it("keeps other keys when qc_checked travels alongside them", () => {
    expect(
      toOptimisticEnrollmentPatch({ qc_checked: true, client_name: "A" }, ACTOR, NOW)
    ).toEqual({
      client_name: "A",
      qc_checked_at: NOW,
      qc_checked_by_email: ACTOR,
      qc_stale_notified_at: null,
    });
  });

  it("ignores a non-boolean qc_checked, matching the server guard", () => {
    // route.ts only acts when typeof body.qc_checked === "boolean".
    expect(toOptimisticEnrollmentPatch({ qc_checked: "yes" }, ACTOR, NOW)).toEqual({
      qc_checked: "yes",
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/enrollment/optimistic-patch.test.ts`
Expected: FAIL with "Cannot find module '@/lib/enrollment/optimistic-patch'".

- [ ] **Step 3: Implement**

```ts
// src/lib/enrollment/optimistic-patch.ts
// Most enrollment patch keys are column names, so an optimistic row is just a
// spread of the request over the previous row. `qc_checked` is the exception:
// it is request-only, and the API translates it into qc_checked_at /
// qc_checked_by_email (src/app/api/enrollment/[id]/route.ts:234-235).
//
// Spreading the raw request wrote a key nothing renders and left the columns
// the UI reads untouched, so the QC toggle was the one control in the module
// with no optimistic feedback -- it appeared to lag for a full round trip, and
// two quick clicks both computed their next value from the same unchanged
// qc_checked_at and sent the identical patch twice, making one click look
// swallowed. Health CS already does this translation for its own request-only
// key (TaskBoardClient.tsx:1930).

export function toOptimisticEnrollmentPatch(
  patch: Record<string, unknown>,
  actorEmail: string,
  nowIso: string
): Record<string, unknown> {
  // The server acts only on a real boolean; anything else falls through so the
  // two sides agree on what counts as a QC change.
  if (typeof patch.qc_checked !== "boolean") return patch;

  const { qc_checked: qcChecked, ...rest } = patch;
  return {
    ...rest,
    qc_checked_at: qcChecked ? nowIso : null,
    qc_checked_by_email: qcChecked ? actorEmail : null,
    qc_stale_notified_at: null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/enrollment/optimistic-patch.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire it into both merge paths**

Extend `PendingEnrollmentPatch` to carry the translated shape, computed **once** at enqueue so the
first merge and every rebase replay agree:

```ts
type PendingEnrollmentPatch = {
  sequence: number;
  /** What goes on the wire. May contain request-only keys such as qc_checked. */
  patch: Record<string, unknown>;
  /**
   * The same change in real column names. Replaying `patch` in the rebase would
   * reintroduce the bug where qc_checked never reached the row.
   */
  columnPatch: Record<string, unknown>;
};
```

In `patchRecord`, compute `columnPatch` before `state.pending.push({ sequence, patch, columnPatch })`
and merge from it. In `rebasePendingEnrollmentPatches`, replay `pending.columnPatch` instead of
`pending.patch`. The fetch body keeps using `patch` — the wire format is unchanged.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run typecheck && npm run lint`

Browser, ACA and Medicare: click QC → the checkbox flips **immediately**. Click twice quickly → it
ends in the state matching the number of clicks, with no swallowed click. Toggle QC, then edit
another field on the same record before the first settles → the QC state survives the rebase.

- [ ] **Step 7: Commit**

```bash
git add src/lib/enrollment/optimistic-patch.ts src/lib/enrollment/optimistic-patch.test.ts \
  "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" changelog.md
git commit -m "fix(enrollment): give the QC toggle optimistic feedback"
```

---

## Task 2: Freeze list order while the user is working (R2)

The rule the user asked for: **order is decided when the list is loaded, and stays put until they
navigate away or refresh.** Editing a record updates its contents in place; it does not move.

New rows appearing (realtime, or a record created by this user) must still be placed somewhere
sensible rather than silently hidden.

**Files:**
- Create: `src/lib/tasks/frozen-order.ts` + `.test.ts`
- Modify: `TaskListView.tsx:104-108` (CS) and `EnrollmentClient.tsx:778-787` (Enrollment)

**Interfaces:**
- Produces: `applyFrozenOrder<T extends { id: string }>(rows, frozenIds): { rows: T[]; nextFrozenIds: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/frozen-order.test.ts
import { describe, expect, it } from "vitest";
import { applyFrozenOrder } from "@/lib/tasks/frozen-order";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("applyFrozenOrder", () => {
  it("adopts the incoming order on the first pass", () => {
    const out = applyFrozenOrder(rows("a", "b", "c"), []);
    expect(out.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(out.nextFrozenIds).toEqual(["a", "b", "c"]);
  });

  it("keeps the frozen order even when the incoming order changes", () => {
    // This is the whole point: an edit re-ranks the source list, and the row
    // the user just touched must NOT jump under their cursor.
    const out = applyFrozenOrder(rows("c", "a", "b"), ["a", "b", "c"]);
    expect(out.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("appends rows that were not in the frozen order", () => {
    // A record created or revealed while the list is open still has to appear.
    const out = applyFrozenOrder(rows("a", "new", "b"), ["a", "b"]);
    expect(out.rows.map((r) => r.id)).toEqual(["a", "b", "new"]);
    expect(out.nextFrozenIds).toEqual(["a", "b", "new"]);
  });

  it("drops frozen ids that are no longer present", () => {
    const out = applyFrozenOrder(rows("a"), ["a", "gone"]);
    expect(out.rows.map((r) => r.id)).toEqual(["a"]);
    expect(out.nextFrozenIds).toEqual(["a"]);
  });

  it("returns a stable frozen list when nothing changed", () => {
    const first = applyFrozenOrder(rows("a", "b"), []);
    const second = applyFrozenOrder(rows("b", "a"), first.nextFrozenIds);
    expect(second.nextFrozenIds).toEqual(first.nextFrozenIds);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then implement**

```ts
// src/lib/tasks/frozen-order.ts
/**
 * Holds a list in the order it had when the user arrived.
 *
 * Both lists rank from live data -- CS from last_activity_at, Enrollment from
 * an updated_at tiebreak -- and every edit changes those fields, so the row the
 * user just touched jumped out from under their cursor. Freezing the order for
 * the session is what the product wants: contents update in place, position
 * only changes on navigation or refresh.
 *
 * Rows absent from the frozen order are appended in their incoming order, so a
 * record created or revealed while the list is open still shows up.
 */
export function applyFrozenOrder<T extends { id: string }>(
  rows: readonly T[],
  frozenIds: readonly string[]
): { rows: T[]; nextFrozenIds: string[] } {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered: T[] = [];
  const seen = new Set<string>();

  for (const id of frozenIds) {
    const row = byId.get(id);
    if (row) {
      ordered.push(row);
      seen.add(id);
    }
  }
  for (const row of rows) {
    if (!seen.has(row.id)) ordered.push(row);
  }

  return { rows: ordered, nextFrozenIds: ordered.map((row) => row.id) };
}
```

- [ ] **Step 3: Apply it in CS**

In `TaskListView`, keep `frozenIds` in a ref, feed the ranked rows through `applyFrozenOrder`, and
store `nextFrozenIds` back. **Reset the ref when the user changes the sort, changes a filter, or
switches view** — those are explicit reorder requests and must take effect immediately.

- [ ] **Step 4: Apply it in Enrollment**

Same treatment for `visibleRecords`, applied **after** `sortRecords`. Reset on sort change, filter
change, and program switch (ACA ↔ Medicare).

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run typecheck`

Browser, both products:
- Edit a field on a row in the middle of the list → **the row stays exactly where it is**.
- Toggle QC, change stage, change priority → still no movement.
- Click a column header → order changes immediately (an explicit request).
- Change a filter → order recomputes.
- Refresh → the new ranking is adopted.
- Have someone else create a record → it appears at the bottom rather than reshuffling everything.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tasks/frozen-order.ts src/lib/tasks/frozen-order.test.ts \
  "src/app/(authed)/tasks/_components/TaskListView.tsx" \
  "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" changelog.md
git commit -m "fix(lists): hold row order steady while the user is editing"
```

---

## Task 3: Stop Enrollment text inputs remounting (R3)

`key={value}` on an uncontrolled input destroys and recreates the DOM node whenever the value
changes, losing focus and flashing.

**The key is doing a real job** — resyncing the input when the value changes from outside — so it
cannot simply be deleted. Replace it with a controlled input that syncs deliberately.

**Files:**
- Modify: `EnrollmentClient.tsx:3824-3886` (`EditableText`, `EditableTextarea`)

- [ ] **Step 1: Convert `EditableText` to controlled with an explicit external sync**

Hold the text in state, seeded from `value`. Sync from the prop **only when the field is not
focused** — that is what the key was approximating, without destroying the node:

```tsx
  const [text, setText] = useState(value);
  const focusedRef = useRef(false);

  // An external update (another user, a rebase, a rejected save) must reach the
  // field -- but never while the user is typing in it. The old code achieved
  // this by keying on `value`, which remounted the input and stole focus.
  useEffect(() => {
    if (!focusedRef.current) setText(value);
  }, [value]);
```

`onFocus` sets the ref and calls `onEditStart`; `onBlur` clears it and runs the existing
required-empty and save logic. `revertNonce` disappears: rejecting an empty required value is now
`setText(value)`.

- [ ] **Step 2: Same treatment for `EditableTextarea`**

Identical pattern. Keep the existing `autosizeTextarea` call on input and on external value change.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint`

Browser: type in a detail text field → no flash, cursor stays put. Blur to save → value persists, no
remount. Clear a required field and blur → it reverts and keeps focus behaviour sane. Have the record
change from another tab while the field is **not** focused → the field updates. While it **is**
focused → your typing is not clobbered.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" changelog.md
git commit -m "fix(enrollment): stop detail text fields remounting on every change"
```

---

## Task 4: (removed)

R4 was closed by the reporter before any work started: dropdown changes in the detail drawer behave
correctly, and the QC symptom is fully explained by R1. Recorded here rather than deleted so the
investigation is not repeated from memory.

## Acceptance criteria

- Enrollment QC flips instantly on click, in list and detail, on ACA and Medicare; two fast clicks
  land on the correct final state.
- QC state survives a rebase triggered by another edit on the same record.
- Editing any field leaves the row exactly where it is, in **both** products.
- Clicking a column header, changing a filter, or refreshing reorders immediately.
- A record created while the list is open appears without reshuffling the rest.
- Typing in a detail text field never loses focus or flashes; external updates still reach the field
  when it is not focused.
- Health CS QC behaviour is unchanged — it was already correct.
- No API, schema, or concurrency change: `expected_updated_at`, per-record serialization, and the
  rebase replay all still work.
- `npx vitest run && npm run typecheck && npm run lint && npm run build` all pass.

## Execution Log

| Task | Symptom | Status | Commit | Verification | Notes |
|---|---|---|---|---|---|
| 1. Enrollment QC optimistic | R1 | Pending | — | — | CS already correct; lift its pattern |
| 2. Freeze list order | R2 | Pending | — | — | Both products. The one the user called "cực kì tệ" |
| 3. Stop input remounts | R3 | Pending | — | — | Key is load-bearing — replace, do not delete |
| 4. ~~Measure R4~~ | R4 | **Closed** | — | Reporter confirmed dropdowns are fine | Symptom was R1 |
