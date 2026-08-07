# Fix Table-Column Config Hardcoding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every place that shows a column's LABEL for a system column (title/priority/category/agent/stage on CS; client/stage/carrier/etc. on Enrollment) actually read `table_column.label` live from already-fetched config, instead of hardcoding the string — so an admin renaming a column in `/config` → Table Columns takes effect everywhere, not just in the List view (which already does this correctly today).

**Architecture:** Two reviewer agents debated this plan against the actual source and a written audit (`2026-08-07-column-config-hardcoding-audit.md`). Consensus: do NOT add a new shared helper module or exported lookup function — that reintroduces the exact "shared translation table that drifts" shape this session already rejected once for the Required-field system. Instead, each parent component (`TaskBoardClient.tsx` for CS, `EnrollmentClient.tsx` for Enrollment) already computes a fully-resolved, label/position-correct column array for its List view (`taskListColumnConfig` in CS, `columns` in Enrollment — both already merge live config over defaults, including Medicare's label overrides). Build ONE `columnByKey: Map<string, TableColumn-like>` from that SAME already-resolved array (not a second, independently-derived one — verified this is safe: both arrays are computed before any *per-user* List-view hide state is folded in, so they're the correct label source for Create/Detail/Kanban/filters too), thread it down as a new prop, and replace each hardcoded literal string with `columnByKey.get("key")?.label ?? "today's hardcoded string"` (fallback keeps behavior identical for any key that isn't in config yet, and matches the pattern already proven correct at `EnrollmentClient.tsx`'s `client`/`pcp2025` list-cell lines).

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Supabase.

## Global Constraints

- No new shared column-label helper function/module — inline `columnByKey.get(key)?.label ?? fallback` at each call site (see Architecture above for why).
- `columnByKey` must be built from the already-resolved List-config array (`taskListColumnConfig` / `columns`), never rebuilt from raw `taskLayoutColumns`/`layoutTableColumns` a second time — that would silently drop Medicare's label overrides and re-implement fallback-merge logic in a second place.
- Never run `next build` while the dev server may be running; confirm with the user before deleting `.next`.
- Only push to `origin` automatically; push to `vercel` only when explicitly asked.
- Log this in `agent-portal/changelog.md` (this is a real logic/behavior change: Config's rename feature currently silently fails on these surfaces).
- After every task: `npx tsc --noEmit`, `npx vitest run`, `rtk proxy npx eslint <touched files>` must all be clean.
- Reply to the user in Vietnamese, concise, once executed.

## Scope decisions made during the debate (read before executing)

- **Phase 4 (Kanban): visibility-gating only, not custom-field rendering.** One reviewer argued Kanban should also grow the ability to show custom columns on cards. Rejected for this plan — that's a new feature (card layout design for arbitrary custom fields), not a hardcoding fix. Only the 3 *existing* unconditional badges (Priority/Category/QC) get gated on `hidden_default`, matching what Create/Detail already do.
- **Phase 5 (field order following `table_column.position`) is written up below but NOT auto-executed.** The audit rated this "medium confidence — may be an accepted tradeoff," and it's a structurally bigger change (JSX sequence → data-driven render loop) than the label fixes. It's fully spec'd as Task 8 so it's ready to run, but confirm with the user before starting it.
- **E2's missing custom-field support in `NewEnrollmentDialog`** (an admin-defined custom column literally cannot be filled in at Enrollment creation time, only after via the Detail drawer) is a related but DISTINCT gap — it's a missing capability, not a wrong hardcoded value. Not part of this plan; flag it to the user separately.

---

### Task 1: Enrollment List-cell labels (E3) — trivial, do first

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

**Interfaces:** none new — this task only touches 2 existing call sites to match a pattern already used 2 lines away in the same function.

- [ ] **Step 1: Find the two hardcoded cells**

Run: `rtk proxy grep -n 'label: "PCP 2026"\|label: "Due Date"' "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"`

Expected: two matches inside the list-row `EditableCustomCell` calls for `pcp2026` and `due`.

- [ ] **Step 2: Match the already-correct neighboring pattern**

The `client`/`pcp2025` cells nearby already do this correctly:
```ts
label: columnByKey.get("client")?.label ?? "Client Name",
```
and
```ts
label: columnByKey.get("pcp2025")?.label ?? "PCP 2025",
```
Change the `pcp2026` cell's `label: "PCP 2026"` to:
```ts
label: columnByKey.get("pcp2026")?.label ?? "PCP 2026",
```
Change the `due` cell's `label: "Due Date"` to:
```ts
label: columnByKey.get("due")?.label ?? "Due Date",
```
(`columnByKey` already exists in this exact function scope — confirm with `rtk proxy grep -n "columnByKey" "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"` before editing; it's built once near the top of the row-rendering function from the `columns` prop.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → expect `TypeScript: No errors found`.
Run: `npx vitest run` → expect `PASS (424) FAIL (0)`.
Run: `rtk proxy npx eslint "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"` → expect clean.

---

### Task 2: Add `columnByKey` to `TaskBoardClient.tsx` (CS) and thread it to `NewTaskDialog`/`TaskDetailDrawer`

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`
- Modify: `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`

**Interfaces:**
- Produces: `columnByKey: ReadonlyMap<string, TaskListColumn>` — new memo in `TaskBoardClient.tsx`, new prop on `NewTaskDialog` and `TaskDetailDrawer`.
- Consumes: `TaskListColumn` type already exported from `./task-list-columns`; `taskListColumnConfig` (already exists at `TaskBoardClient.tsx:182`).

- [ ] **Step 1: Add the memo in `TaskBoardClient.tsx`**

Right after the existing `requiredColumnKeys` memo (around line 732-740), add:

```ts
  // Label source for surfaces that don't get the per-user-filtered list —
  // same rule as configuredColumnKeys/adminVisibleColumnKeys above: built
  // from taskListColumnConfig (already resolves live label/position/pinned
  // over defaults), never from a second independent derivation, and never
  // from anything that folds in this user's personal List-view hide state.
  const columnByKey = useMemo(
    () => new Map(taskListColumnConfig.map((column) => [column.key, column])),
    [taskListColumnConfig]
  );
```

- [ ] **Step 2: Pass it into both dialogs**

Find the `<NewTaskDialog>` render block (around line 1417) and add `columnByKey={columnByKey}` alongside the existing `configuredColumnKeys={configuredColumnKeys}` line. Do the same for `<TaskDetailDrawer>` (around line 1451).

- [ ] **Step 3: Accept the new prop in `NewTaskDialog.tsx`**

Add to the destructured props and its type:
```ts
  columnByKey,
```
```ts
  columnByKey: ReadonlyMap<string, { label: string }>,
```
(placed next to the existing `requiredColumnKeys: ReadonlySet<string>;` line, both in the destructure and the type block).

- [ ] **Step 4: Accept the new prop in `TaskDetailDrawer.tsx`**

Same shape, next to its existing `requiredColumnKeys` prop.

- [ ] **Step 5: Verify (compile-only check — call sites updated in Task 3)**

Run: `npx tsc --noEmit` → new unused-variable warnings for `columnByKey` in both dialogs are EXPECTED at this point (Task 3 uses it) — confirm no OTHER new errors.

---

### Task 3: Replace hardcoded labels in `NewTaskDialog.tsx` and `TaskDetailDrawer.tsx` (C1)

**Files:**
- Modify: `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`

**Interfaces:** none new — uses `columnByKey` added in Task 2.

- [ ] **Step 1: `NewTaskDialog.tsx` — replace each hardcoded label**

| Current literal | Column key | Replace with |
|---|---|---|
| `Client Name` (Title field span) | `summary` | `{columnByKey.get("summary")?.label ?? "Client Name"}` |
| `FUB Link` | `fub` | `{columnByKey.get("fub")?.label ?? "FUB Link"}` |
| `Description` | `description` | `{columnByKey.get("description")?.label ?? "Description"}` |
| `label="Priority"` (MetaField) | `priority` | `label={columnByKey.get("priority")?.label ?? "Priority"}` |
| `label="Category"` | `category` | `label={columnByKey.get("category")?.label ?? "Category"}` |
| `label="Agent"` | `agent` | `label={columnByKey.get("agent")?.label ?? "Agent"}` |
| `label="Assignee"` | `assignee` | `label={columnByKey.get("assignee")?.label ?? "Assignee"}` |
| `label="Stage"` (MetaField, `showStage` block) | `status` | `label={columnByKey.get("status")?.label ?? "Stage"}` |

Note the `summary` key mapping to the Title field specifically — do not accidentally use `"client"` (that's Enrollment's key for the analogous field, a real regression risk flagged in the debate: CS and Enrollment use different key names for their "name" field).

- [ ] **Step 2: `TaskDetailDrawer.tsx` — same table, plus 3 more that only exist here**

Apply the same 8 replacements as Step 1 (this file has its own copies of the same literals), plus:

| Current literal | Column key | Replace with |
|---|---|---|
| `Created by` | `reporter` | `{columnByKey.get("reporter")?.label ?? "Created by"}` |
| `Assignees` | `assignee` | `{columnByKey.get("assignee")?.label ?? "Assignees"}` (note: plural "Assignees" is the existing fallback text here, singular "Assignee" is `NewTaskDialog`'s fallback — this is intentional, matches each file's current copy, both fall back to today's exact wording) |
| `QC Review` | `review` | `{columnByKey.get("review")?.label ?? "QC Review"}` |

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → expect clean.
Run: `npx vitest run` → expect `PASS (424) FAIL (0)`.
Run: `rtk proxy npx eslint "src/app/(authed)/tasks/_components/NewTaskDialog.tsx" "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx"` → expect clean.

- [ ] **Step 4: Manual check**

With the dev server running (confirm it's already up, don't start a second one): rename "Priority" to something else in `/config` → Table Columns (CS scope), open New Task and an existing task's Detail — confirm the new label shows in both. Rename it back to "Priority" afterward so the seed data isn't left permanently changed by a manual test.

---

### Task 4: Add `columnByKey` to `EnrollmentClient.tsx` and thread it to `EnrollmentDrawer`/`NewEnrollmentDialog`

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

**Interfaces:**
- Produces: `columnByKey` prop on `EnrollmentDrawer` and `NewEnrollmentDialog`, built from `columns` (the existing resolved, Medicare-aware array — NOT `layoutTableColumns`).

- [ ] **Step 1: Find where `EnrollmentDrawer`/`NewEnrollmentDialog` are rendered from the top-level `EnrollmentClient` component**

Both are rendered from the same parent function that already has `columns` in scope (the `useMemo` at line 473). Add one line building the Map right before their render blocks, or reuse the SAME `columnByKey` construction already used inside `EnrollmentRowItem` (`new Map(columns.map((c) => [c.key, c]))`) — build it once in the parent via `useMemo`, not per-row:

```ts
  const columnByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column])),
    [columns]
  );
```

- [ ] **Step 2: Pass it into both**

Add `columnByKey={columnByKey}` to the `<EnrollmentDrawer>` and `<NewEnrollmentDialog>` render calls.

- [ ] **Step 3: Accept the new prop in both component signatures**

`EnrollmentDrawer` and `NewEnrollmentDialog` each get a new prop, same shape as CS's Task 2 Step 3:
```ts
  columnByKey: ReadonlyMap<string, { label: string }>,
```

- [ ] **Step 4: Verify (compile-only)**

Run: `npx tsc --noEmit` → unused-variable warnings for `columnByKey` in both are expected (Task 5 uses it).

---

### Task 5: Replace hardcoded labels in `EnrollmentDrawer` and `NewEnrollmentDialog` (E1, E2)

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

**Interfaces:** none new — uses `columnByKey` from Task 4.

- [ ] **Step 1: Replace every hardcoded label in `EnrollmentDrawer` with the fallback pattern**

| Current literal | Column key | Note |
|---|---|---|
| `Client Name` | `client` | |
| `FUB Link` | `fub` | |
| `Description` | `description` | |
| `label="Stage"` | `stage` | |
| `"Due date"` | `due` | |
| `"Payment"` | `payment` | |
| `"Carrier"` | `carrier` | |
| `"AC"` | `aca` | audit found this already disagrees with Create's `"ACA"` — after this fix both read the SAME live `columnByKey.get("aca")?.label`, so they can no longer drift, but pick ONE fallback string for both (`"AC"`, matching the List view's existing default) |
| `"Consent"` | `consent` | |
| `"Platform"` | `platform` | |
| `"Agent"` | `agent` | |
| `"Caller"` | `caller` | |
| `label={isMedicare ? "Assignee" : "Responsible enroll"}` | `responsible` | replace the whole ternary with `columnByKey.get("responsible")?.label ?? (isMedicare ? "Assignee" : "Responsible enroll")` — keeps the Medicare-aware fallback for the pre-config-load/missing-key case, but live config now wins when present, closing the E5 drift (config's own Medicare relabel, `MEDICARE_COLUMN_LABELS`, already produces exactly `"Assignee"` for this key on Medicare — so once fixed this ternary fallback and the live value agree by construction) |
| `"Created by"` | `reporter`... | **check exact key** — Enrollment's "Created by" field key: confirm via `rtk proxy grep -n '"createdBy"' "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"` (Enrollment's key is likely `createdBy`, not `reporter` like CS — do not assume, verify before writing the lookup) |
| `label={isMedicare ? "PCP" : "PCP 2025"}` | `pcp2025` | same ternary-fallback pattern as `responsible` above |
| `"PCP 2026"` | `pcp2026` | |
| `"QC Review"` | `qc` | |

- [ ] **Step 2: Replace every hardcoded label in `NewEnrollmentDialog` with the same fallback pattern**

Same table as Step 1 applies (identical field set, same keys) — this dialog has its own separate copies of the same literals (`"ACA"` here specifically, not `"AC"` — after the fix both dialogs read the same live value, so pick `"ACA"` or `"AC"` as ONE shared fallback across both files, matching whichever the audit noted as already the more common convention — Step 1's table already picked `"AC"`, use that same fallback string here too for consistency).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → expect clean.
Run: `npx vitest run` → expect `PASS (424) FAIL (0)`.
Run: `rtk proxy npx eslint "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"` → expect clean.

- [ ] **Step 4: Manual check**

Rename "Carrier" in `/config` → Table Columns (aca scope) → confirm New Enrollment dialog and an existing record's Detail drawer both show the new name. Revert the rename after testing.

---

### Task 6: CS filter toolbar labels (C2)

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskToolbar.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` (pass the new prop)

**Interfaces:**
- Produces: `columnByKey` prop threaded into `TaskToolbar` (it currently only receives `listColumns: TaskListColumn[]`, a different shape — needs the new prop, same as Task 2).

- [ ] **Step 1: Pass `columnByKey` into `<TaskToolbar>`**

In `TaskBoardClient.tsx`, find the `<TaskToolbar>` render call and add `columnByKey={columnByKey}` (reusing the SAME memo from Task 2 — do not build a second one).

- [ ] **Step 2: Accept the prop in `TaskToolbar.tsx`**

Add `columnByKey: ReadonlyMap<string, { label: string }>,` to its props.

- [ ] **Step 3: Replace the 4 hardcoded filter-option labels (around lines 154-172)**

```ts
const agentOptions = [{ value: ALL_AGENTS, label: columnByKey.get("agent")?.label ?? "Agent" }, ...]
const categoryOptions = [{ value: "", label: columnByKey.get("category")?.label ?? "Category" }, ...]
const statusOptions = [{ value: "", label: columnByKey.get("status")?.label ?? "Status" }, ...]
const priorityOptions = [{ value: "", label: columnByKey.get("priority")?.label ?? "Priority" }, ...]
```

Note: this ALSO fixes the pre-existing, no-admin-action-needed bug the audit found — the seeded default DB label for `status` is "Stage", not "Status", so after this change the filter will correctly show "Stage" out of the box (matching every other surface), not "Status".

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`, `npx vitest run`, `rtk proxy npx eslint "src/app/(authed)/tasks/_components/TaskToolbar.tsx" "src/app/(authed)/tasks/_components/TaskBoardClient.tsx"` → all clean.

---

### Task 7: Enrollment filter toolbar labels (E4)

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` (`EnrollmentToolbar`)

**Interfaces:** `EnrollmentToolbar` already receives `columns: EnrollmentColumn[]` — build a local `columnByKey` from it (do not add a new prop; the data is already there, per the minimal-risk reviewer's finding).

- [ ] **Step 1: Build a local `columnByKey` inside `EnrollmentToolbar`**

Near the top of the function body:
```ts
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
```

- [ ] **Step 2: Replace the hardcoded `label`/placeholder strings on the Stage/Agent/Caller/Responsible/Carrier/Payment filter `TaskSelect` calls**

Same fallback pattern as prior tasks — e.g. `label="Stage"` becomes `label={columnByKey.get("stage")?.label ?? "Stage"}`, and similarly for `agent`/`caller`/`responsible`/`carrier`/`payment`. Keep the existing `isMedicare ? "Assignee" : "Responsible"`-style ternaries as the FALLBACK half of the expression (same pattern as Task 5's `responsible`/`pcp2025` handling), not deleted outright.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`, `npx vitest run`, `rtk proxy npx eslint "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"` → all clean.

---

### Task 8: CS Kanban visibility gating (C4) — badges only, no custom-field rendering

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`
- Modify: `src/app/(authed)/tasks/_components/KanbanBoard.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskCard.tsx`

**Interfaces:**
- Produces: `visibleColumnKeys: ReadonlySet<string>` prop threaded `TaskBoardClient → KanbanBoard → TaskCard` (reuse `adminVisibleColumnKeys`, the SAME Set already used to gate Create/Detail — per the debate, this must be the admin-level Set, never the per-user List-hide one, matching the existing documented rule at `TaskBoardClient.tsx:709-713`).

- [ ] **Step 1: Find `KanbanBoard`'s render call in `TaskBoardClient.tsx` and add the prop**

```tsx
visibleColumnKeys={adminVisibleColumnKeys}
```

- [ ] **Step 2: Thread it through `KanbanBoard.tsx` to wherever it renders `<TaskCard>`**

Add `visibleColumnKeys: ReadonlySet<string>` to `KanbanBoard`'s own props type, and pass it straight through to each `<TaskCard visibleColumnKeys={visibleColumnKeys} .../>` call (there are 2 call sites per the audit — find both with `rtk proxy grep -n "<TaskCard" "src/app/(authed)/tasks/_components/KanbanBoard.tsx"`).

- [ ] **Step 3: Gate the 3 badges in `TaskCard.tsx`**

Accept `visibleColumnKeys: ReadonlySet<string>` as a new prop. Wrap the existing Priority marker (around line 107) in `{visibleColumnKeys.has("priority") ? (...) : null}`, the Category badge (around lines 124-131) in `{visibleColumnKeys.has("category") ? (...) : null}`, and the QC badge (around lines 132-136) in `{visibleColumnKeys.has("review") ? (...) : null}`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`, `npx vitest run`, `rtk proxy npx eslint "src/app/(authed)/tasks/_components/TaskBoardClient.tsx" "src/app/(authed)/tasks/_components/KanbanBoard.tsx" "src/app/(authed)/tasks/_components/TaskCard.tsx"` → all clean.

- [ ] **Step 5: Manual check**

Hide "Priority" in `/config` → Table Columns (cs scope) → confirm it disappears from Kanban cards too, not just Create/Detail/List. Unhide it after testing.

---

### Task 9 (NOT auto-executed — confirm with user before starting): field order following `position` (C3, E6)

This task is fully spec'd but should NOT be started without the user explicitly confirming they want it in this pass — it's a bigger structural change than Tasks 1-8, and the audit itself rated it medium-confidence.

**Scoped compromise from the debate:** make the "commodity" fields (no cross-field side effects) position-sorted and data-driven; carve out fields with real cross-field coupling as documented, still-fixed-position exceptions:
- CS: `status` (Stage) is excluded — its render depends on `isAssigned`/Backlog-lock logic (`NewTaskDialog.tsx:142-148`), not a simple swap.
- Enrollment: none identified with equivalent coupling in the audit — revisit during implementation; if any field's render function reads component state beyond its own value (the way CS's Stage does), carve it out the same way.

**Files:** `NewTaskDialog.tsx`, `TaskDetailDrawer.tsx`, `EnrollmentClient.tsx` (`EnrollmentDrawer`, `NewEnrollmentDialog`).

**Approach:** replace the fixed JSX sequence of `{showX ? <MetaField.../> : null}` blocks with a `key → () => ReactNode` renderer lookup plus a position-sorted list built from `columnByKey`'s underlying array (already available from Tasks 2/4), e.g.:

```ts
const SYSTEM_FIELD_RENDERERS: Record<string, () => ReactNode> = {
  priority: () => <MetaField label={...}><TaskPrioritySelect .../></MetaField>,
  category: () => <MetaField label={...}><TaskSelect .../></MetaField>,
  agent: () => <MetaField label={...}><TaskSelect .../></MetaField>,
  // ...
};
const orderedSystemFields = taskListColumnConfig
  .filter((c) => SYSTEM_FIELD_RENDERERS[c.key] && visibleColumnKeys.has(c.key))
  .sort((a, b) => (a.configColumn?.position ?? 0) - (b.configColumn?.position ?? 0));
```

Do not write further implementation detail here until the user confirms scope — this section exists so the follow-up conversation starts from a concrete design instead of "let's figure it out."

---

## Self-Review Notes

- **Spec coverage:** every audit finding (C1-C4, E1-E5) has a corresponding task except E6/C3 (explicitly deferred, Task 9) and E7 (explicitly out of scope, informational only per the audit).
- **Regression risks flagged by the debate, addressed in the plan:** CS's `summary` vs Enrollment's `client` key naming (Task 3 Step 1 note); Medicare label regression risk from building `columnByKey` off the wrong source (Architecture section, resolved by using `columns`/`taskListColumnConfig`, never raw config); which visibility Set gates Kanban (Task 8, explicitly `adminVisibleColumnKeys`, not the per-user one).
- **E2's missing custom-field-at-creation gap** is called out in "Scope decisions" as explicitly NOT part of this plan — flag to the user as a separate, distinct finding requiring its own decision.
