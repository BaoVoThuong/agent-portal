# Table-Column Config Hardcoding — Audit Findings

Scope: every place in `agent-portal` (CS task board + ACA/Medicare enrollment) where code hardcodes something about a `table_column` (label, order, visibility, type) instead of reading it live from the fetched config, checked against what an admin can actually change at `/config` → Table Columns.

Confirmed premise before auditing: admins CAN rename a system column's `label` through the Config UI for every scope (`cs`/`aca`/`medicare`) — the label `<input>` in `ConfigClient.tsx` (`SortableColumnRow`/`StaticColumnRow`) has no `is_system` gate, and `canEditColumnField()` explicitly allows `label` even when `is_system=true`. So every finding below is a real, reachable gap: an admin's rename/reorder/hide action silently fails to propagate to the listed surface.

Already fixed this session and explicitly OUT of scope here (do not re-litigate): the Required-field system (`lib/table-config/required.ts`, `REQUIRED_CAPABLE_SYSTEM_KEYS`), Hidden/Detail visibility gating on Create+Detail dialogs (both CS and Enrollment), `custom_values` rendering (already fully generic via `TableColumn` objects).

---

## CS (`src/app/(authed)/tasks/`)

### C1. Create/Detail dialog field labels are hardcoded literal strings
**Files:** `NewTaskDialog.tsx` (Title/Client Name, FUB Link, Description, Priority, Category, Agent, Assignee, Stage), `TaskDetailDrawer.tsx` (same set + Created by, Assignees, QC Review)
Neither component ever receives a `TableColumn[]` for SYSTEM columns — only `configuredColumnKeys`/`visibleColumnKeys`/`requiredColumnKeys` (bare `Set<string>`, no `.label`). Every field label is JSX literal text. Renaming any system column via Config has zero effect on these two dialogs.
Confidence: **high**. Directly reachable, no fallback involved.

### C2. Filter dropdown placeholders hardcoded, already visibly wrong
**File:** `TaskToolbar.tsx:154-172`
`agentOptions`/`categoryOptions`/`statusOptions`/`priorityOptions` hardcode `label: "Agent"`/`"Category"`/`"Status"`/`"Priority"`. The same component already receives `listColumns: TaskListColumn[]` and uses it correctly elsewhere (column-visibility popover, line ~504, `{column.label}`) — just not here.
**Concrete drift that exists right now, no admin action needed:** the seeded default DB label for column key `status` is **"Stage"** (`lib/table-config/queries.ts`), but this filter hardcodes **"Status"**.
Confidence: **high**.

### C3. Properties/aside field order is a fixed JSX sequence, ignores `position`
**Files:** `NewTaskDialog.tsx` (Priority→Category→Agent→Assignee→Stage), `TaskDetailDrawer.tsx` (same + Created by/Assignees/QC)
Reordering system columns via Config's drag handle changes List order but has no effect here. Custom fields always render in a separate trailing block, never interleaved with system fields by position.
Confidence: **high** that relative order among system fields never changes; **medium** on whether system/custom interleaving is a real requirement vs. an accepted two-column-layout constraint.

### C4. Kanban board is not config-aware at all
**Files:** `KanbanBoard.tsx`, `TaskCard.tsx`, wired from `TaskBoardClient.tsx`
`<KanbanBoard>` is invoked without `configuredColumnKeys`/`visibleColumnKeys`/any `TableColumn` data — unlike `<NewTaskDialog>` and `<TaskDetailDrawer>` in the exact same parent file, which both get `configuredColumnKeys`/`visibleColumnKeys`. `TaskCard.tsx` unconditionally renders the Priority marker, Category badge, and QC badge regardless of `hidden_default` on those columns, and never renders custom columns at all. Hiding Priority/Category/QC via Config removes them everywhere except Kanban.
Confidence: **high** — verified via both call site and component signature; only 2 call sites for `TaskCard`, neither config-aware.

---

## Enrollment (`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`)

### E1. Detail drawer (`EnrollmentDrawer`) field labels are hardcoded literal strings
All of: Client Name, FUB Link, Description, Stage, Due date, Payment, Carrier, AC, Consent, Platform, Agent, Caller, Responsible enroll/Assignee, Created by, PCP 2025/PCP, PCP 2026, QC Review. `detailColumns` prop is pre-filtered to `!is_system` only — system columns' live `label` never reaches this component. The custom-column loop 2 lines below correctly does `label={column.label}`.
Confidence: **high**. Identical bug class to C1.

### E2. Create dialog (`NewEnrollmentDialog`) — same hardcoding, plus no custom fields at all
Same full set of labels hardcoded as E1. `NewEnrollmentDialog` never receives column data and never renders a custom-field loop — meaning an admin-defined custom column literally cannot be filled in at creation time, only after, via Detail.
Confidence: **high**.

### E3. List-row cells: internal inconsistency, `pcp2026`/`due` hardcoded while neighbors aren't
**File:** `EnrollmentClient.tsx` (`EnrollmentRowItem`, list cell rendering)
`pcp2026`/`due` cells hardcode `label: "PCP 2026"` / `"Due Date"`. Two lines earlier, `client`/`pcp2025` correctly do `label: columnByKey.get("client")?.label ?? "Client Name"` using a `columnByKey` map already built in the same function. This is the cheapest fix in the whole list — the correct pattern already exists inches away.
Confidence: **high**.

### E4. Toolbar filter dropdowns hardcode label/placeholder text
**File:** `EnrollmentClient.tsx` (`EnrollmentToolbar`)
Stage/Agent/Caller/Responsible/Carrier/Payment filter `TaskSelect` calls pass hardcoded `label`/placeholder strings, shown as the visible heading inside the open dropdown (`TaskSelect.tsx` renders `label` as `dashboard-filter-title`) and as `aria-label`. `EnrollmentToolbar` already has `columns: EnrollmentColumn[]` in scope (used correctly for `ColumnVisibilityButton`) but doesn't build a lookup for the filters.
Confidence: **medium-high** — real gap, smaller blast radius (dropdown heading, not primary field label).

### E5. Confirmed live drift from E1-E4 — proof this already produces wrong output today
- "AC/ACA" column: labeled **"AC"** in List, **"AC"** in Drawer, **"ACA"** in Create — three independently hardcoded copies already disagree with each other.
- "Responsible Enroll" (List) vs "Responsible enroll" (Drawer/Create) vs "Responsible" (Toolbar filter) — capitalization/wording drift across 4 copies.
- `isMedicare ? "Assignee" : ...` / `isMedicare ? "PCP" : ...` in Drawer/Create are hand-rewritten copies of `MEDICARE_COLUMN_LABELS = { responsible: "Assignee", pcp2025: "PCP" }`, which already exists elsewhere in the same file and is correctly overridable by live config in the List view — but not reused in Drawer/Create, so those two stay stuck even if Config data changes.

### E6. System field order in Detail/Create asides ignores `position`
Same shape as C3 — fixed JSX sequence, custom fields correctly position-sorted (inherited from server-sorted `layoutTableColumns`), but system fields never reorder relative to each other regardless of Config.
Confidence: **medium** — mirrors CS's identical, seemingly load-bearing structural limitation of hand-built two-column Create/Detail forms; may be an accepted tradeoff rather than an oversight (see plan discussion below).

### E7. Other key↔field translation tables beyond the 3 already-accepted ones (informational, not urgent)
- `src/app/api/enrollment/export/route.ts` (`enrollmentExportValue()`, `formatEnrollmentExportValue()`) — same key→DB-field mapping shape as the accepted `ENROLLMENT_FORM_FIELD_BY_KEY`, in a 4th, previously-unlisted file.
- `EnrollmentClient.tsx`'s `sortValue()` — same shape again, for client-side sort.
Confidence: **low as bugs** — these mirror real Postgres/TS field names (legitimately hardcoded per the same reasoning already accepted for `NewTaskPayload` et al.), flagged only for completeness since the user asked specifically whether more such tables exist.

### Checked and confirmed clean (no action needed)
CS: `task-list-columns.ts`, `TaskListView.tsx`/`TaskRowItem.tsx`, XLSX/CSV export (`api/tasks/export/route.ts`, `lib/table-config/export.ts`).
Enrollment: `ColumnVisibilityButton`, CSV/XLSX export (`api/enrollment/export/route.ts` header generation, `lib/table-config/export.ts`), `EnrollmentOverview.tsx` (no column-label surface at all), `HealthTableImportDialog.tsx`'s header auto-mapping guess (heuristic default, not a rendered label).

---

## Summary table

| ID | Surface | Kind | Confidence | Cheapest to fix? |
|----|---------|------|-----------|-------------------|
| C1 | CS Create+Detail | labels | high | no — needs new data plumbed in |
| C2 | CS filter toolbar | labels | high | medium — data already in scope |
| C3 | CS Create+Detail | order | high/medium | no |
| C4 | CS Kanban | visibility | high | no — needs new props end to end |
| E1 | Enrollment Detail | labels | high | no — needs new data plumbed in |
| E2 | Enrollment Create | labels | high | no — also missing custom-field support entirely |
| E3 | Enrollment List cells | labels | high | **yes — pattern already exists 2 lines away** |
| E4 | Enrollment filter toolbar | labels | medium-high | medium — data already in scope |
| E5 | (evidence, not separate work) | — | — | — |
| E6 | Enrollment Create+Detail | order | medium | no |
| E7 | export/sort key↔field maps | informational | low | not planned |
