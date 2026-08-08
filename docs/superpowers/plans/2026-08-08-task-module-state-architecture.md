# Task Module — State Architecture Review & Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Status: PLAN ONLY — no code has been written.** Produced by two independent Senior-Staff-level reviews (correctness lens + architecture lens) followed by an adversarial debate round in which **both reviewers retracted their original headline recommendation**. Every claim below was independently verified against source by the orchestrator before inclusion; claims that survived only one reviewer are marked.

**Goal:** Eliminate the `A → B → A → B` UI revert across CS, Enrollment and Config, fix the data-integrity cascade it causes, and replace three divergent hand-rolled mutation disciplines with one shared primitive.

**Scope:** `src/app/(authed)/tasks/`, `src/app/(authed)/enrollment/`, `src/app/(authed)/config/`, plus `src/lib/tasks/`, `src/lib/enrollment/`, `src/lib/table-config/`, `src/app/(authed)/_shared/`.

---

## 0. HEADLINE FINDING — read this first

**The symptom is one. The causes are three.** The request assumed a single shared root cause. That assumption is false, and acting on it would have left one third of the bug unfixed:

| Module | Is it a race? | Actual cause | Reproducible? |
|---|---|---|---|
| **Enrollment** | **Yes** | A GET issued *before* the write commits resolves *after* it, and the staleness guard is evaluated after the `await` instead of at issue time. | Needs concurrency (another user's broadcast, or a pre-armed debounce timer) |
| **CS** | **Partially** | Same class, but already hardened with 4 guard refs. Residual holes remain (dropped updates, undebounced reconnect refetch). | Rare |
| **Config** | **No — not a race at all** | Deterministic. The optimistic update preserves array order; the server echo re-sorts and **sinks the toggled row to the bottom of the table**. The user tracks a screen position, and the switch now at that position belongs to a different column. | **100%, single toggle, single user** |

Both reviewers independently converged on the Config verdict after initially getting it wrong in opposite directions. **A pure "fix the race" solution does not fix Config.** Config needs a two-line ordering fix, not the concurrency primitive.

---

## 1. Architecture overview — how it actually works today

Identical shape in all three modules:

```
Server Component (page.tsx)
  └─ loads whole collection ─→ initialX prop
       └─ Client Component copies it into useState          ← copy #1 (server state now lives in UI state)
            ├─ mutation: optimistic setState                ← write #1 (destructive, in-place)
            ├─ PATCH /api/… (sends expected_updated_at)
            ├─ server commits → broadcast ping (no payload)
            ├─ mutation response → setState(server row)      ← write #2
            └─ broadcast → 300 ms debounce → refetch WHOLE collection → setState  ← write #3
```

**There is no single source of truth for any entity.** For one CS task, three independent copies exist:
- `tasks` (`TaskBoardClient.tsx:110`)
- `overviewSnapshot` (`:112`) — separately mutated by `optimisticallyAssignOverviewTask` (`:1103`)
- `TaskDetailDrawer`'s own `reload()` result (`TaskDetailDrawer.tsx:139`)

`tasks` alone has **eight** writers: `patchTask` (`:945`), `replaceTask` (`:887`), `changeAssignee` (`:1061`), `createTask` (`:1155`), `deleteTask` (`:1161`), `refetchTasks` (`:374`), `submitOverdueUnlock` (`:1001`), `submitReopen` (`:1030`).

**Realtime is a content-free ping,** not a payload. Every listener answers by refetching the entire collection. `lib/table-config/realtime.ts` broadcasts a config change to **both** `tasks-stream` and `enrollment-stream`, so one admin toggling a column forces every CS *and* every Enrollment client to refetch everything.

**Three modules, three different correctness levels for the identical problem** — this divergence, not any single race, is the core maintainability defect:

| Module | Coordination machinery |
|---|---|
| CS | `tasksWriteVersionRef`, `tasksRefetchRequestRef`, `pendingTaskMutationsRef`, `recentTaskWritesRef` + `mergeRefetchedTasks` + a 3-second magic cooldown (`TaskBoardClient.tsx:169-180`, `:1634`) |
| Enrollment | one `pendingRef` (`EnrollmentClient.tsx:468`) |
| Config | **none** |

**Config subscribes to no realtime channel at all** (verified: zero `getBrowserSupabase` / `.channel(` in `ConfigClient.tsx`), so the admin screen never self-heals from another admin's change.

---

## 2. Root cause of `A → B → A → B`

### 2.1 Enrollment — the genuine race (Critical)

The defect is one line, `EnrollmentClient.tsx:687`:

```ts
const data = await response.json();
if (pendingRef.current.size === 0) setRecords(data.records);   // ← guard evaluated AFTER the round-trip
```

The guard asks *"is a write pending right now?"* instead of *"was a write pending when this request was issued?"*. There is also **no request-sequence counter**, so two overlapping refetches can resolve out of order and the older one wins permanently.

| t | Event |
|---|---|
| −250 ms | Any `ENROLLMENT_TOPIC` broadcast (teammate edit, comment, or a **config change fanned in from `table-config/realtime.ts`**) arms the 300 ms debounce (`:739-745`). |
| 0 | User picks **B**. `pendingRef.add(id)` (`:761`), optimistic `setRecords` (`:771`). **UI = B.** PATCH sent. |
| +50 ms | Debounce fires → `GET /api/enrollment` **issued while the PATCH is still in flight** → server will return **A**. |
| +300 ms | PATCH resolves → `setRecords(server B)` (`:791`); `finally` clears `pendingRef` (`:800`). |
| **+520 ms** | The +50 ms GET resolves. `pendingRef.size === 0` → **true** → `setRecords(A)`. **← revert to A** |
| **+1000 ms** | The user's own broadcast triggers a second, post-commit GET → **B**. **← back to B, stays** |

The ~0.5 s spacing is one GET round-trip (NextAuth session load + `fetchEnrollmentRecords`, ≈300-500 ms) offset by the hard-coded 300 ms debounce at `:744`.

### 2.2 The cascade this causes — worse than the visual bug (Critical)

After a stale snapshot lands, `records[id].updated_at` holds the **old** value. The next edit therefore sends a stale `expected_updated_at` → server returns **409** (`api/enrollment/[id]/route.ts:121-126`) → `patchRecord`'s catch (`:795`) restores the already-stale `before` and shows *"updated by someone else."*

**The record is now permanently un-editable until a clean refetch.** This is happening in production today. Same shape exists in CS (`api/tasks/[id]/route.ts:195-200`).

> This is the direct explanation for the "Task was updated by someone else. Refresh and try again." report earlier in this project. That was **not** a phantom or a stale browser tab — it is this cascade.

### 2.3 Config — deterministic, not a race (High)

`patchColumn` (`ConfigClient.tsx:484-488`) applies the optimistic patch with `current.map(...)` — **array order preserved**, the row stays put showing Hidden = on. ~1 s later `refreshScope` lands, `sortedColumns` (`:435-449`) re-sorts using `Number(a.hidden_default) - Number(b.hidden_default)` as the **primary sort key**, sinking the just-hidden column to the bottom; the effect at `:456-459` writes that order into `localColumns`. Every `index + 1` badge (`:729`) renumbers and dnd-kit animates the move.

One toggle. One user. No concurrency. 100 % reproducible.

A second, additive effect: the server forces fields the optimistic patch never applied — `hidden_default: false` when pinned/required, and `show_in_detail: true` for a required custom column (`api/config/columns/[id]/route.ts:88-94`) — so the "In detail" switch flips on ~1 s later with no user action. That is a one-way surprise, not a revert.

**Config's true race** (two toggles within ~450 ms) is real but secondary — and it is easy to hit because **none of the four `ToggleSwitch`es is disabled while a save is in flight** (`:745-790`).

### 2.4 CS — guards narrow the hole, do not close it (High)

- `pendingTaskMutationsRef.current.size > 0` (`:372`) is a **global** check: one slow mutation on task X silently discards the refetch carrying every *other* task's updates, with no retry.
- The `SUBSCRIBED` reconnect refetch (`:481-486`) is **undebounced** and fires on every Phoenix rejoin (network blip, heartbeat timeout).
- `mergeRefetchedTasks` keeps the entire local row for 3 s (`:1652-1655`), so a legitimate concurrent remote edit to that task is discarded forever.

---

## 3. Issue inventory

Severity: **C**ritical (data integrity / daily user impact) · **H**igh · **M**edium · **L**ow

### Correctness

| # | File:line | Function | Root cause | Sev |
|---|---|---|---|---|
| 1 | `EnrollmentClient.tsx:687` | `refetch` | Staleness guard evaluated after `await`; stale snapshot overwrites fresh state | **C** |
| 2 | `EnrollmentClient.tsx:680-691` | `refetch` | No request-sequence counter → out-of-order responses, older wins permanently | **C** |
| 3 | `EnrollmentClient.tsx:783,795` + `api/enrollment/[id]/route.ts:121-126` | `patchRecord` | Stale `updated_at` → 409 → rollback to stale row → **record permanently un-editable** | **C** |
| 4 | `ConfigClient.tsx:484-488` vs `:435-449` | `patchColumn` / `sortedColumns` | Optimistic update preserves order; server echo re-sorts → row jumps (the Config symptom) | **H** |
| 5 | `ConfigClient.tsx:456-459` + `:450` | resync effect | Server state duplicated into `localColumns`, resynced unconditionally — no way to know local is newer | **H** |
| 6 | `ConfigClient.tsx:483` · `EnrollmentClient.tsx:821-832` · `TaskBoardClient.tsx:1168,1174` | rollback paths | Whole-**array** rollback snapshots wipe every concurrent optimistic edit | **H** |
| 7 | `TaskDetailDrawer.tsx:111-113` | component body | `title`/`description`/`fubLink` mirrored into local state with **no sync effect**; `key={openTask.id}` only remounts on id change → a rejected/rolled-back edit displays indefinitely | **H** |
| 8 | `TaskBoardClient.tsx:370-372` | `refetchTasks` | Dropped refetch never retried; guard is global → other tasks' updates lost | **H** |
| 9 | `TaskBoardClient.tsx:481-486` | `SUBSCRIBED` handler | Undebounced refetch on every socket rejoin | **M** |
| 10 | `TaskBoardClient.tsx:1652-1655` | `mergeRefetchedTasks` | 3 s wall-clock cooldown discards legitimate remote edits; over- and under-blocks | **M** |
| 11 | `EnrollmentClient.tsx:759` · `TaskBoardClient.tsx:935` | `patchRecord` / `patchTask` | `before` captured from the render closure → two edits from the same render both roll back to the original, undoing the first | **M** |
| 12 | `EnrollmentClient.tsx:323-342` | layout hydration | StrictMode double-invoke: ref marked before the timer, cleanup only clears the timer → **saved column visibility never hydrates in dev** | **M** (dev only) |
| 13 | `api/tasks/[id]/comments/route.ts:180` → `lib/tasks/last-activity.ts:8-11` | `touchLastActivity` | Writes `last_activity_at` + `stale_reminded_at` but **not `updated_at`**, while both are rendered List columns. **Verified: schema has zero `create trigger` for `updated_at`** — it is entirely application-maintained | **M** |
| 14 | `EnrollmentClient.tsx:3378` | `EditableInput` | `key={`${value}-${revertNonce}`}` remounts the input on every value change → focus/caret loss during A→B→A→B. (`EditableCustomCell` is **not** affected — verified: no `key`, uncontrolled, only mounted while `editing`) | **M** |
| 15 | `EnrollmentClient.tsx:528-602` + `:323-342` | layout hydration | Three-stage hydrate (defaults → localStorage → server) with a PUT at +250 ms; visible column flicker, and the PUT can persist the intermediate state if the fetch loses the race | **M** |
| 16 | `TaskBoardClient.tsx:112,1103` | `overviewSnapshot` | A second, independently-mutated copy of task rows — must be covered by any fix or CS keeps a racy second source of truth | **M** |
| 17 | `EnrollmentClient.tsx:794-798` + `EditableCustomCell.tsx:51-60` | `patchRecord` | `patchRecord` swallows its own error, so `onSave` never rejects → the cell's red-ring error state is dead code on the Enrollment path | **L** |

### Performance

| # | File:line | Issue | Sev |
|---|---|---|---|
| P1 | `EnrollmentClient.tsx:1523-1549`, `TaskRowItem.tsx:233-275` | Per-row Map rebuilding: `customOptionLabelById`, `customOptionsByColumnId`, `customPeople`, `columnByKey` rebuilt **per row per render**; `has()` is O(cols) called per column → O(cols²); `stickyOffset` O(cols) per cell. At ~430 rows × ~30 cols → >500 k ops per render | **C** |
| P2 | `TaskListView.tsx:103-108` + `lib/tasks/sorting.ts:326-350` | Sort runs every render, un-memoized, and the comparator recomputes `managerRankTuple` for **both** operands per comparison → ~6,900 tuple builds at n=400, every render. Also un-memoized in the same function: `categoryById` (`:94`), `labelByEmail` (`:96-102`), `visibleColumnKeys` (`:120`), `pinnedOffsetByKey` (`:123`) | **C** |
| P3 | Module-wide | **Zero `React.memo`** anywhere in `tasks/`, `enrollment/`, `config/`, `_shared/` — every parent state change re-renders every row | **C** |
| P4 | `EnrollmentClient.tsx:741-744` + `lib/enrollment/queries.ts:106-116` | One cell edit → broadcast → **every** client refetches records *and* options. At 50 users ≈ 100 API calls / ~150 DB queries per edit. Each refetch runs `select("record_id,body")` pulling **every comment body** of all ~430 records. *Correction to reviewer's framing: the bodies are not waste — they feed client-side comment search (`filters.query`). The fix is to move search server-side, not to drop the column* | **C** |
| P5 | `lib/table-config/realtime.ts` | One config change fans out to **both** `tasks-stream` and `enrollment-stream`. Also a correctness contributor: it arms Enrollment's 300 ms debounce with no user action, which is what makes §2.1's pre-armed-timer precondition routine rather than rare | **H** |
| P6 | `TaskBoardClient.tsx:524-531` | 30 s `now` tick is a dep of `overdueIds` (`:632`), `agentStats` (`:586`), `visibleTasks` (`:762`) → the whole board pays P1+P2 twice a minute for a countdown label | **H** |
| P7 | `TaskListView.tsx:124-126`, `EnrollmentClient.tsx:1427-1429` | No virtualization: ~430 rows × ~30 cells ≈ 13 k DOM nodes all rendered. `ag-grid-react` is already a project dependency | **M** |
| P8 | `EnrollmentClient.tsx:3972-3995` | `RelativeTime` used twice per row, each with its own `setInterval(60_000)` → ~860 intervals in one frame | **M** |

### Explicitly fine — do NOT spend effort here

- `visibleTasks` (`TaskBoardClient.tsx:762-794`), `visibleRecords` (`EnrollmentClient.tsx:628-637`) — correctly memoized with honest deps.
- `TaskSearchBox.tsx:38-43` owns its query state; typing does not re-render the board.
- `supabase-browser.ts` module-level client cache — correct, one socket per tab.
- `EditableCustomCell` uncontrolled inputs — deliberate and correct.
- The 300 ms broadcast debounce and `expected_updated_at` optimistic concurrency — both good instincts, keep.
- `TaskBoardClient.tsx:365` missing `cache: "no-store"` — the route is `dynamic = "force-dynamic"`; dynamic Next routes are served no-store. A consistency nit, **not** a contributor. Keep it out of the plan.

---

## 4. The unified solution

### 4.1 The invariant (both reviewers converged here)

> **Optimistic state must live in a different container from the container the fetcher overwrites.**

With separation, a stale snapshot landing in `serverRows` is *harmless* — the pending patch is re-applied on top at read time. Without it, no amount of cancellation, cooldown or version-comparison is sufficient, because every write is destructive and in-place.

```ts
// The shape. Server writes only ever touch serverRows.
const view = useMemo(() => merge(serverRows, pending), [serverRows, pending]);

type Pending<T> = Map<string, { base: T; patch: Partial<T>; seq: number }>;
```

Rules:
1. **Optimistic edits write only to `pending`.** Never to `serverRows`.
2. **Refetch responses write only to `serverRows`**, and only if their issue-time sequence is still current.
3. **A pending entry is cleared only by its own mutation settling** — success (server row lands in `serverRows`, entry dropped) or failure (entry dropped, remaining pending patches re-applied over the current server row).
4. **Rollback is per-entity, never a whole-array snapshot** (fixes #6, #11).
5. **A dropped refetch sets a dirty flag and re-runs on settle** — never silently discarded (fixes #8).
6. **409 self-heals:** refetch that single row, rebase the patch, retry once, then surface an error (fixes #3).
7. The merge must handle **"absent from snapshot, present in pending"** (inserts) and deletions.

### 4.2 Two mechanisms explicitly rejected, with reasons

**Rejected — `updated_at` as a version/merge key.** This was the correctness reviewer's original proposal; they retracted it, and the orchestrator independently verified why:
- `touchLastActivity` (`lib/tasks/last-activity.ts:8-11`) changes rendered content **without** bumping `updated_at`. A `>` rule silently drops those updates.
- `>=` doesn't save it either: optimistic rows never bump `updated_at` at all, so an equal-version stale snapshot still clobbers the optimistic value. **The rule fails in both directions.**
- Timestamps are application-generated `new Date().toISOString()` across **serverless instances** — clock agreement is not guaranteed. Unacceptable as an ordering key.
- **Verified: the schema contains zero `create trigger` / `moddatetime` for `updated_at`.**

Keep `expected_updated_at` exactly where it is — a **server-side** 409 concurrency check. It is correct there. Use a **client-owned monotonic sequence** for ordering instead.

**Rejected — generalizing CS's guard refs to the other two modules.** Both reviewers agree. It codifies "guess whether this response is stale from a wall clock", keeps the 3 s magic number, and preserves the dropped-update bug. Those refs get **deleted**, not spread.

### 4.3 On TanStack Query — the debate's most important reversal

The architecture reviewer opened by recommending TanStack Query with `await queryClient.cancelQueries()` in `onMutate` as *the* structural fix. **They retracted it.** The reason is decisive:

`cancelQueries` cancels what is in flight **at that instant**. In the proven Enrollment timeline, `onMutate` runs at t=0 and the offending GET is **born at t=+50 ms** — there is nothing to cancel. TanStack has no built-in mutation/query mutual exclusion, and **four** of its defaults will start that GET mid-mutation: the realtime handler's `invalidateQueries`, `refetchOnWindowFocus` (default `true` — an agent alt-tabs while saving), `refetchOnReconnect` (default `true` — fires on the same socket blips that already trigger `SUBSCRIBED`), and `refetchOnMount`.

Notably, TanStack's own no-cache-write pattern — `useMutationState({ filters: { status: 'pending' }, select: m => m.variables })` then `merge(data, pending)` — **is exactly the `serverRows` + `pending` design above.** The library is therefore an *optional substrate* for the primitive, not a substitute for it.

**Verdict: build the primitive first. Decide TanStack afterwards, on evidence.** Revised cost if adopted: **~6-8 engineer-days**, not the ~3 originally estimated — because the 409 rebase-and-retry, per-field rollback, drawer mirror sync, and list-identity/focus work are all still hand-written on top of it.

---

## 5. Phased plan

### Phase 0 — Stop the bleeding (~half a day, ~4 edits, no new dependency)

Both reviewers independently converged on this exact set, and on **Enrollment first** (both revised away from "Config first / easiest first" — wrong axis for a live tool; the correct axis is where users are losing data).

- [ ] **0.1 — `EnrollmentClient.tsx:680-691` (`refetch`)** — capture `const seq = ++refetchSeqRef.current` and `const hadPending = pendingRef.current.size > 0` **before** the fetch; after the await, apply only if `seq === refetchSeqRef.current && !hadPending && pendingRef.current.size === 0`. Kills §2.1 outright. *(~10 lines)*
- [ ] **0.2 — `ConfigClient.tsx:484-488` (`patchColumn`)** — re-sort the optimistic array with the same comparator as `:435-449`, and include the server's forced fields (`show_in_detail: true` when setting `required` on a custom column; `hidden_default: false` when pinned/required) so the optimistic row matches the echo. Kills the Config symptom outright.
- [ ] **0.3 — `lib/tasks/last-activity.ts:8-11`** — add `updated_at: nowIso`. Makes the 409 check consistent with what actually changed the row (#13).
- [ ] **0.4 — `EnrollmentClient.tsx:687` + `TaskBoardClient.tsx:370-372`** — when a refetch is dropped, set a dirty flag and re-run on settle instead of discarding, so we do not trade "revert" for "silently stale" (#8).
- [ ] **0.5 — disable the four Config `ToggleSwitch`es while a save is in flight** (`ConfigClient.tsx:745-790`) — removes the two-write Config race and is a one-word change per toggle.

**Verify:** `npx tsc --noEmit`, `npx vitest run`, `rtk proxy npx eslint .` all clean; then manually re-run the §6 matrix rows marked *P0*.

> ~20 lines of Phase 0 are later superseded by Phase 2. That is intentional: 0.1 and 0.4 are exactly the sequencing and deferred-invalidation semantics the shared primitive needs, so writing them inline first is a de-risking spike, not waste. **Do not add any new CS-style guard refs** — those are what we delete.

### Phase 1 — Build the shared primitive (~1 day + tests, no adoption yet)

- [ ] **1.1** — `src/lib/data/useOptimisticCollection.ts`: `serverRows` + `pending: Map`, `merge()`, issue-time sequencing, per-entity rollback, dirty-flag deferred refetch, 409 rebase-and-retry hook. Pure and unit-testable in isolation.
- [ ] **1.2** — Unit tests covering every §6 concurrency row against the primitive directly, no UI. This is where slow-network / out-of-order / double-click cases get proven, because they are unreliable to test by hand.

### Phase 2 — Adopt, one module per PR, in risk order

- [ ] **2.1 — Enrollment** (worst; has the §2.2 data-integrity cascade). Delete `pendingRef`.
- [ ] **2.2 — CS.** Delete `tasksWriteVersionRef`, `tasksRefetchRequestRef`, `pendingTaskMutationsRef`, `recentTaskWritesRef`, `mergeRefetchedTasks`, the 3 s constant. **Must also cover `overviewSnapshot` (#16)** or CS keeps a racy second source of truth. Debounce the `SUBSCRIBED` handler (#9).
- [ ] **2.3 — Config.** Delete the `localColumns` mirror + resync effect (#5); render from the prop. *(Config gains little from the concurrency primitive — no realtime subscriber, no second fetcher — but the mirror deletion is worth it on its own.)*
- [ ] **2.4 — `TaskDetailDrawer` mirrors** (#7): sync-on-prop-change or derive; a rejected edit must not display indefinitely.

### Phase 3 — Performance (independent of Phases 0-2; can run in parallel)

Ordering constraint flagged by the correctness reviewer:

- [ ] **3.1 — `React.memo` on `TaskRowItem` / `EnrollmentRowItem` — safe NOW.** Rows are pure prop-driven (zero `useState` in `TaskRowItem.tsx`) and orthogonal to state ownership.
- [ ] **3.2 — Hoist the per-row Maps (P1)** from row scope to table scope.
- [ ] **3.3 — Precompute rank tuples + memoize the sort (P2).** `sorting.test.ts` already exists.
- [ ] **3.4 — `useCallback` on `patchTask` / `patchRecord` — MUST come after #11 is fixed.** Both close over the render's `tasks`/`records` to compute `before`; memoizing them with an incomplete dep array turns the occasional stale-`before` bug into a permanent one. Order: memo rows → move `before` to a ref/functional updater → then `useCallback`.
- [ ] **3.5 — Split the config broadcast (P5)** so a config change stops fanning into both streams. **Do not "fix" P4 by dropping `reloadOptions`** — options genuinely change; split the topic instead, or a perf bug is traded for a staleness bug.
- [ ] **3.6 — Move Enrollment comment search server-side (P4)** so refetches stop shipping every comment body.
- [ ] **Defer:** virtualization (P7) — 3.1-3.3 removes most of the pain at 430 rows; `RelativeTime` timer swarm (P8) — shared clock context, low impact.

### Phase 4 — Optional substrate, decided on evidence

- [ ] Re-evaluate TanStack Query **after** Phase 2 ships. If adopted, it must set `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, and gate invalidation on `isMutating()`. Revised cost ~6-8 engineer-days.
- [ ] Payload-carrying realtime (broadcast the changed row, not a ping) — the real fix for P4's ~100 fetches/edit. Do it **after** the primitive exists, when it becomes a simple `setQueryData`-shaped write with `invalidate` as fallback. Note it leaks row content onto the channel, which `lib/tasks/realtime.ts` currently avoids deliberately.

### Phase 5 — Structural refactors (deferred, not now)

- [ ] Split `EnrollmentClient.tsx` (~4,000 lines) along existing seams: `EnrollmentTable`, `EnrollmentRowItem`, `EnrollmentDrawer`, `NewEnrollmentDialog`, `enrollment-format.ts`. Mechanical, and a precondition for effective memoization.
- [ ] Extract the duplicated layout hydrate/persist effect — `TaskBoardClient.tsx:201-268` ≈ `EnrollmentClient.tsx:528-602` (the comment is copied verbatim) — into one `useTableLayout(scope, tableColumns)` hook. ~200 duplicated lines.
- [ ] Split `TaskBoardClient.tsx` (~1,870 lines) **after** Phase 2 removes ~150 lines of guard machinery, or it will split along the wrong seams.

---

## 6. Validation matrix

Every row must show **Old → New** and never a revert. Rows marked *P0* are the Phase 0 acceptance gate.

| # | Case | Expected | Phase |
|---|---|---|---|
| 1 | Enrollment inline cell edit, idle network | B, stays | *P0* |
| 2 | Enrollment edit **while another user edits a different record** | B, stays; the other user's change also appears | *P0* |
| 3 | Enrollment edit, then immediately edit the **same** field again | Final value wins; no 409 | *P0* |
| 4 | Enrollment edit → wait → edit again (the §2.2 cascade) | **No "updated by someone else"; record stays editable** | *P0* |
| 5 | Config toggle Hidden | Switch stays on; **row must not silently relocate under the cursor** | *P0* |
| 6 | Config toggle Required on a custom column | Required on; "In detail" reflects the forced value **immediately**, not 1 s later | *P0* |
| 7 | Config: two toggles within 500 ms | Both persist; neither reverts | *P0* |
| 8 | CS status change from List, Board, and Detail drawer | B in all three views simultaneously | 2 |
| 9 | CS: edit while a teammate edits another task | Both changes visible; neither dropped | 2 |
| 10 | Double-click a toggle | Final state = last click; exactly one net request | 1 |
| 11 | Rapid 5 edits to 5 different rows | All 5 persist | 1 |
| 12 | Throttled 3G / 2 s latency | No revert; spinner or disabled state, then B | 1 |
| 13 | Response arrives out of order (forced in unit test) | Newer wins | 1 |
| 14 | Mutation fails (500) | Rollback affects **only** that entity; other pending edits survive | 1 |
| 15 | 409 conflict | Auto-rebase + retry once; record remains editable | 2 |
| 16 | Offline → reconnect mid-edit | Edit persists or reports failure; never silently reverts | 2 |
| 17 | Detail drawer open while the row changes remotely | Drawer reflects it; no stale value stuck | 2 |
| 18 | Type in an Enrollment drawer text field while a broadcast lands | **Focus and caret preserved** (#14) | 2 |
| 19 | Column visibility toggle, two tabs same user | Both converge | 2 |
| 20 | 430 rows, sort + filter + 30 s tick | No dropped frames; verify with React Profiler before/after | 3 |

---

## 7. Code-quality standards for this work

- **Single source of truth** — one container per entity per module. `overviewSnapshot` (#16) must be reconciled or removed.
- **Server state and UI state must not share a variable.** `useState` is for filters, `openId`, `view` — not for rows.
- **No new guard refs.** If a fix needs another `Ref` to decide whether a response is stale, it is the wrong fix.
- **No wall-clock heuristics** for ordering. Sequence numbers only.
- **Rollback is per-entity.** Whole-array snapshots are banned (#6).
- **Never silently discard a server update.** Defer and re-run (#8).
- **DRY across modules**, not just within one — the three modules must end up using the *same* primitive, or the divergence problem returns.
- Log every logic change in `changelog.md`.

---

## Appendix — how this document was produced, and its confidence level

Two independent Senior-Staff reviews (correctness lens, architecture lens) were run in parallel, then forced into an adversarial debate on five specific conflicts. **Both reviewers retracted their headline recommendation.** The orchestrator independently verified every load-bearing claim against source before it entered this plan; three reviewer claims were corrected in the process:

| Claim | Verdict |
|---|---|
| `updated_at` is a safe version token | **False** — verified: no DB trigger, `touchLastActivity` doesn't bump it, timestamps are app-generated across serverless instances |
| `EditableCustomCell` remounts on value change, killing focus | **False** — verified: no `key`, uncontrolled, only mounted while `editing`. The real culprit is `EditableInput` at `EnrollmentClient.tsx:3378`, which *does* key on value |
| Enrollment refetch pulls comment bodies wastefully | **Half true** — the bodies feed client-side comment search; the fix is server-side search, not dropping the column |
| `TaskBoardClient.tsx:365` missing `cache:"no-store"` causes staleness | **False** — the route is `force-dynamic`; excluded from the plan |

**Open item requiring one user confirmation:** the Config diagnosis (§2.3) is derived from source and is deterministic, but should be confirmed against what the user actually observed — *does the switch itself flip back, or does the row jump position in the table?* If the switch itself genuinely flips back on a **single** toggle with no second click, §2.3 is incomplete and Config needs re-investigation before Phase 0.2 is written.
