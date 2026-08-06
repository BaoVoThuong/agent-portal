# Fix Admin "Hidden" Field Visibility (CS + Enrollment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the admin-level "Hidden" checkbox (`table_column.hidden_default`, set via `/config` → Table Columns) as the real, working control over whether a field appears in the Create dialog and Detail drawer — for both CS Tasks and Enrollment (ACA/Medicare) — without reintroducing the bug where a user's own personal List/Board column visibility leaks into those same forms.

**Architecture:** Three independently-meaningful controls, one unified rule per control across every surface — this is the full mental model, covering `hidden_default`, `show_in_detail`, and `archived_at` (Hidden / Detail / Archive, the three admin controls in `/config` → Table Columns), not just the one bug reported:

1. **`hidden_default`** ("Hidden" checkbox, admin, company-wide) → the kill switch. Controls List/Board default visibility (already correct, untouched) **and** Create/Detail form visibility (currently broken — this plan restores it) — for **both system and custom columns, identically**. If a column is Hidden, it is gone from all three surfaces for everyone, full stop.
2. **`show_in_detail`** ("Detail" checkbox, admin, company-wide) → an **opt-in that only means something for custom columns**: "in addition to appearing in the List table (if not Hidden), should this custom field also be settable on the Create/Edit form?" System columns are always form-eligible by design (that's what makes them "system" — Priority, Category, Agent, etc. are core to the record) — they don't need an opt-in, only the Hidden kill switch. So the real visibility rule is:
   - **System column shows on Create/Detail** ⟺ `!hidden_default` (plus the "not configured at all" escape hatch for CS's unseeded `description`/`fub`).
   - **Custom column shows on Create/Detail** ⟺ `!hidden_default && show_in_detail`.
   - Neither ever depends on this specific user's personal List-view column hide.
3. **`archived_at`** ("Archive" action, admin, custom columns only — the API rejects archiving a system column) → already works perfectly and needs no code change: `fetchActiveTableColumnRows()` in `src/lib/table-config/queries.ts:150-156` filters `.is("archived_at", null)` at the database query itself, so an archived column never reaches the client at all — structurally impossible for it to leak into List, Create, or Detail. Verified, not touched by this plan.
4. **Per-user List column hide** (`user_table_layout`, the show/hide toggle on the List/Board table itself, not in Config) → controls **only** that user's List/Board table. Must never reach Create/Detail. (Already fixed correctly earlier today — this plan must not regress it.)

Hard-required Create fields (CS: Agent, Category; Enrollment: Agent) get a fallback default when admin-hidden, so hiding them never bricks record creation — mirroring the pattern this codebase already used before the regression.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (service-role key, no RLS), Vitest, ESLint.

## Global Constraints

- Never let `hiddenTaskListColumnKeys` (CS) / `hiddenColumnKeys` (Enrollment) — the per-user List-view state — reach any Create dialog or Detail drawer. Only `visibleTaskListColumnConfig` (CS List/Board + CSV export) and `visibleColumns` (Enrollment List/Board) may read it.
- `hidden_default` must gate Create/Detail visibility for **both system and custom columns identically** — this is a deliberate change from the bug's original (pre-regression) behavior, where custom columns' `hidden_default` only ever affected the List table. Doing it only for system columns (as an earlier draft of this plan proposed) would leave the exact same class of surprise the user reported, just for custom fields instead of system ones — an admin ticking Hidden on a custom column would still see it vanish from List but stay on Create/Detail. Task 2/3 now add a `!column.hidden_default` term to `taskDetailColumns`/`detailCustomColumns` (previously gated only by `show_in_detail && !is_system && !archived_at`) to close this.
- `show_in_detail` ("Detail" checkbox) has no effect on system columns anywhere in the codebase (verified: `taskDetailColumns` / `detailCustomColumns` both filter `!column.is_system`) and this plan keeps it that way — for system columns, Hidden alone is the complete answer, Detail would be a redundant second switch for the same on/off state. Make the Config UI stop lying about it: disable that checkbox for system rows (Task 4).
- A column can never end up `pinned: true` **and** `hidden_default: true` at once — this must be enforced server-side, not just by a disabled UI checkbox.
- Do not touch RBAC/permissions, do not touch the DB schema except the optional Task 5 (which the user must run manually — never run `schema.sql` yourself).
- After every task: `npx tsc --noEmit`, `npx vitest run`, and `rtk proxy npx eslint <changed files in this task>` must all be clean before moving to the next task.
- None of the four UI files touched here (`NewTaskDialog.tsx`, `TaskDetailDrawer.tsx`, `NewEnrollmentDialog`/`EnrollmentDrawer` in `EnrollmentClient.tsx`) have existing component tests, and this plan does not add any — verification for those tasks is the manual QA checklist in Task 6, plus the three static checks above. Task 1 (API route) and Task 5 (schema) are the only tasks touching code with real test coverage nearby; Task 1 has no existing route test either (confirmed: no `*.test.ts` exists under `src/app/api/config`), so it also relies on the manual check in its own task rather than inventing a new test pattern for this codebase.

---

### Task 1: Server-side guard against `pinned + hidden_default` both true

**Files:**
- Modify: `src/app/api/config/columns/[id]/route.ts:84-86`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — pure hardening of existing behavior other tasks will lean on more heavily (Task 2/3's Create/Detail gate now trusts `hidden_default` as an admin-intent signal; it must never be true on a pinned/locked column).

**Context:** The PATCH handler already forces `hidden_default: false` whenever *this same request* sets `pinned: true`. It does **not** check the case where a request sets only `hidden_default: true` against a column that is **already** `pinned: true` (e.g. CS's `key`/`summary`, Enrollment's `key`/`client`). The Config UI's Hidden checkbox is `disabled={column.pinned}` so a human can't trigger this from the normal screen, but the API itself doesn't stop it, and Task 2/3 will make `hidden_default` responsible for whether a field can even be created/edited — a pinned column silently going `hidden_default: true` would hide a locked, always-supposed-to-be-visible field from Create/Detail.

- [ ] **Step 1: Replace the one-sided guard with one that also covers the already-pinned case**

In `src/app/api/config/columns/[id]/route.ts`, replace:

```ts
  if (patch.pinned === true) {
    patch.hidden_default = false;
  }
```

with:

```ts
  const willBePinned = "pinned" in patch ? patch.pinned === true : column.pinned;
  if (willBePinned) {
    patch.hidden_default = false;
  }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 3: Manual verification (no existing test file for this route)**

With the dev server running and logged in as an admin, open browser devtools → Network, find (or replay) the PATCH request Config's Hidden checkbox sends when toggling a **non-pinned** column, and confirm the body/response still work as before (regression check). Then, using the same devtools "Copy as fetch"/replay on a **pinned** column's id (e.g. CS's `key` column — get its id via `GET /api/config/columns?scope=cs`) with body `{"hidden_default": true}` (omit `pinned`), confirm the response comes back with `"pinned": true, "hidden_default": false` — i.e. the server refused to let it go hidden while pinned, instead of trusting the client.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/config/columns/[id]/route.ts"
git commit -m "fix(config): reject hidden_default=true on an already-pinned column"
```

---

### Task 2: Restore admin-controlled Create/Detail visibility for CS system fields

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:705-717` (the block right after `visibleTaskListColumnConfig`, currently just that one `useMemo`, and the two `<NewTaskDialog>`/`<TaskDetailDrawer>` JSX call sites further down)
- Modify: `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`

**Interfaces:**
- Consumes: `taskLayoutColumns: TableColumn[]` (already in scope in `TaskBoardClient.tsx`, holds every `table_column` row for `scope=cs`, each with `.key`, `.hidden_default`, `.archived_at`).
- Produces: two new props on `NewTaskDialog` and `TaskDetailDrawer` — `configuredColumnKeys: ReadonlySet<string>` and `visibleColumnKeys: ReadonlySet<string>` — read by both components via a local `isFieldVisible(key) = !configuredColumnKeys.has(key) || visibleColumnKeys.has(key)`.

**Design note (custom fields get the same Hidden kill switch, on top of their existing Detail opt-in):** Custom (non-system) columns already have their own opt-in for Create/Detail visibility: `show_in_detail`, baked into the `taskDetailColumns` memo. That memo currently reads `taskLayoutColumns.filter(c => c.show_in_detail && !c.is_system && !c.archived_at)` — it does **not** check `hidden_default` at all, which means a custom column ticked Hidden today vanishes from the List table but **stays** on Create/Detail if `show_in_detail` is on — the identical class of surprise this whole plan exists to fix, just for custom columns instead of system ones. Step 1 below adds `!c.hidden_default` to that filter so Hidden means "gone everywhere" uniformly for every column, system or custom. `show_in_detail` keeps its existing, narrower job — deciding whether a *non-hidden* custom column additionally shows on the form — nothing about that opt-in changes.

- [ ] **Step 1: Reinstate the two admin-visibility sets in `TaskBoardClient.tsx`**

Find (around line 705-717):

```tsx
  const visibleTaskListColumnConfig = useMemo(
    () => visibleTaskListColumns(hiddenTaskListColumnKeys, taskListColumnConfig),
    [hiddenTaskListColumnKeys, taskListColumnConfig]
  );
```

Add immediately after it:

```tsx
  // Admin-level visibility for the Create dialog + Detail drawer — computed
  // straight from the raw column config, deliberately NOT from
  // visibleTaskListColumnConfig above (that one also folds in this specific
  // user's personal List/Board column-hide state via hiddenTaskListColumnKeys,
  // which must never affect whether a field can be created/edited).
  const configuredColumnKeys = useMemo(
    () =>
      new Set(
        taskLayoutColumns
          .filter((column) => !column.archived_at)
          .map((column) => column.key)
      ),
    [taskLayoutColumns]
  );
  const adminVisibleColumnKeys = useMemo(
    () =>
      new Set(
        taskLayoutColumns
          .filter((column) => !column.archived_at && !column.hidden_default)
          .map((column) => column.key)
      ),
    [taskLayoutColumns]
  );
```

- [ ] **Step 1b: Close the same Hidden gap for CS custom columns**

Find (this is right below the block Step 1 just added, further down in the same file, around what was originally line 709-717):

```tsx
  const taskDetailColumns = useMemo(
    () =>
      taskLayoutColumns.filter(
        (column) =>
          column.show_in_detail && !column.is_system && !column.archived_at
      ),
    [taskLayoutColumns]
  );
```

Replace with:

```tsx
  const taskDetailColumns = useMemo(
    () =>
      taskLayoutColumns.filter(
        (column) =>
          column.show_in_detail &&
          !column.is_system &&
          !column.archived_at &&
          !column.hidden_default
      ),
    [taskLayoutColumns]
  );
```

This is the only change custom columns need — `taskDetailColumns` already feeds `detailColumns`/`visibleDetailColumns` in both `NewTaskDialog.tsx` and `TaskDetailDrawer.tsx` unfiltered (no further gate needed there; do not add one — see the design note above for why a second filter on `visibleDetailColumns` would be wrong).

- [ ] **Step 2: Pass the two sets into both dialogs**

Find the `<NewTaskDialog` JSX block and add two props right after `tableColumnOptions={tableColumnOptions}`:

```tsx
          tableColumnOptions={tableColumnOptions}
          configuredColumnKeys={configuredColumnKeys}
          visibleColumnKeys={adminVisibleColumnKeys}
          onClose={() => setCreating(false)}
```

Find the `<TaskDetailDrawer` JSX block and add the same two props right after `tableColumnOptions={tableColumnOptions}`:

```tsx
          tableColumnOptions={tableColumnOptions}
          configuredColumnKeys={configuredColumnKeys}
          visibleColumnKeys={adminVisibleColumnKeys}
          currentEmail={currentEmail}
```

- [ ] **Step 3: Restore the gate in `NewTaskDialog.tsx` (no fallback needed — see Task 1b below, Agent/Category become un-hideable by construction)**

Add the two props to the destructure and type:

```tsx
export function NewTaskDialog({
  open,
  isManager,
  currentEmail,
  myAssistantAgents,
  assignees,
  agents,
  agentCandidates,
  myAgents,
  categories,
  detailColumns,
  tableColumnOptions,
  configuredColumnKeys,
  visibleColumnKeys,
  onClose,
  onCreate,
}: {
  open: boolean;
  isManager: boolean;
  currentEmail: string;
  myAssistantAgents: string[];
  assignees: TaskAssignee[];
  agents: TaskAgent[];
  agentCandidates: TaskAgent[];
  myAgents: string[];
  agentMembersByAgent: Record<string, string[]>;
  categories: TaskCategory[];
  detailColumns: TableColumn[];
  tableColumnOptions: TableColumnOption[];
  configuredColumnKeys: ReadonlySet<string>;
  visibleColumnKeys: ReadonlySet<string>;
  onClose: () => void;
  onCreate: (payload: NewTaskPayload) => Promise<void>;
}) {
```

Replace:

```tsx
  const visibleDetailColumns = detailColumns;
  const optionsByColumnId = new Map<string, TableColumnOption[]>();
  for (const option of tableColumnOptions) {
    const current = optionsByColumnId.get(option.column_id) ?? [];
    current.push(option);
    optionsByColumnId.set(option.column_id, current);
  }
  const hasAgentScope = Boolean(
    agentEmail &&
      (agentEmail === currentEmail || myAssistantAgents.includes(agentEmail))
  );
  const canPickAssignee = isManager || hasAgentScope;
  const canSubmit = Boolean(
    title.trim() && categoryId && agentEmail && !saving
  );
```

with:

```tsx
  const isFieldVisible = (key: string) =>
    !configuredColumnKeys.has(key) || visibleColumnKeys.has(key);
  const showFubLink = isFieldVisible("fub");
  const showDescription = isFieldVisible("description");
  const showPriority = isFieldVisible("priority");
  const showCategory = isFieldVisible("category");
  const showAgent = isFieldVisible("agent");
  const showAssignee = isFieldVisible("assignee");
  const visibleDetailColumns = detailColumns;
  const optionsByColumnId = new Map<string, TableColumnOption[]>();
  for (const option of tableColumnOptions) {
    const current = optionsByColumnId.get(option.column_id) ?? [];
    current.push(option);
    optionsByColumnId.set(option.column_id, current);
  }
  // Agent/Category are hard-required to submit (see canSubmit below). If an
  // admin hides either column, the picker disappears — fall back to a sane
  // default instead of leaving Create permanently disabled.
  const fallbackAgentEmail =
    agentOptions.find((option) => option.value === currentEmail)?.value ??
    agentOptions[0]?.value ??
    "";
  const effectiveAgentEmail =
    agentEmail || (!showAgent ? fallbackAgentEmail : "");
  const effectiveCategoryId =
    categoryId || (!showCategory ? categoryOptions[0]?.value ?? "" : "");
  const hasAgentScope = Boolean(
    effectiveAgentEmail &&
      (effectiveAgentEmail === currentEmail ||
        myAssistantAgents.includes(effectiveAgentEmail))
  );
  const canPickAssignee = isManager || hasAgentScope;
  const canSubmit = Boolean(
    title.trim() && effectiveCategoryId && effectiveAgentEmail && !saving
  );
```

Replace the `submit()` payload:

```tsx
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        fub_link: fubLink.trim() || undefined,
        priority,
        agent_email: agentEmail,
        assignees: canPickAssignee ? selectedAssignees : undefined,
        category_id: categoryId,
```

with:

```tsx
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        fub_link: fubLink.trim() || undefined,
        priority,
        agent_email: effectiveAgentEmail,
        assignees: canPickAssignee ? selectedAssignees : undefined,
        category_id: effectiveCategoryId,
```

Wrap the four gated JSX fields back in their conditionals. Replace:

```tsx
              <label className={PRIMARY_FIELD_CLASS}>
                <span className={PRIMARY_LABEL_CLASS}>FUB Link</span>
                <input
                  value={fubLink}
                  onChange={(e) => setFubLink(e.target.value)}
                  placeholder="https://..."
                  className={PRIMARY_INPUT_CLASS}
                />
              </label>

              <label className={PRIMARY_FIELD_CLASS}>
                <span className={PRIMARY_LABEL_CLASS}>Description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add context, acceptance notes, links, or customer details..."
                  rows={13}
                  className={PRIMARY_TEXTAREA_CLASS}
                />
              </label>
            </section>
```

with:

```tsx
              {showFubLink ? (
                <label className={PRIMARY_FIELD_CLASS}>
                  <span className={PRIMARY_LABEL_CLASS}>FUB Link</span>
                  <input
                    value={fubLink}
                    onChange={(e) => setFubLink(e.target.value)}
                    placeholder="https://..."
                    className={PRIMARY_INPUT_CLASS}
                  />
                </label>
              ) : null}

              {showDescription ? (
                <label className={PRIMARY_FIELD_CLASS}>
                  <span className={PRIMARY_LABEL_CLASS}>Description</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Add context, acceptance notes, links, or customer details..."
                    rows={13}
                    className={PRIMARY_TEXTAREA_CLASS}
                  />
                </label>
              ) : null}
            </section>
```

Replace:

```tsx
              <MetaField label="Priority">
                <TaskPrioritySelect
                  value={priority}
                  onChange={setPriority}
                  menuClassName="min-w-full"
                />
              </MetaField>

              <MetaField label="Category">
                <TaskSelect
                  label="Category"
                  value={categoryId}
                  options={categoryOptions}
                  placeholder="Select category"
                  onChange={setCategoryId}
                  buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                  menuClassName="min-w-full"
                />
              </MetaField>

              <MetaField label="Agent">
                <TaskSelect
                  label="Agent"
                  value={agentEmail}
                  options={agentOptions}
                  placeholder="Select agent"
                  onChange={changeAgent}
                  buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                  menuClassName="min-w-full"
                />
              </MetaField>

              <MetaField label="Assignee">
                {canPickAssignee ? (
                  <TaskAssigneeDropdown
                    assignees={assignees}
                    selectedEmails={selectedAssignees}
                    agentEmail={agentEmail || null}
                    onToggle={toggleAssignee}
                  />
                ) : (
                  <div className="flex h-10 items-center rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm font-medium text-[#172b4d]">
                    Assigned to you
                  </div>
                )}
              </MetaField>
```

with:

```tsx
              {showPriority ? (
                <MetaField label="Priority">
                  <TaskPrioritySelect
                    value={priority}
                    onChange={setPriority}
                    menuClassName="min-w-full"
                  />
                </MetaField>
              ) : null}

              {showCategory ? (
                <MetaField label="Category">
                  <TaskSelect
                    label="Category"
                    value={categoryId}
                    options={categoryOptions}
                    placeholder="Select category"
                    onChange={setCategoryId}
                    buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                    menuClassName="min-w-full"
                  />
                </MetaField>
              ) : null}

              {showAgent ? (
                <MetaField label="Agent">
                  <TaskSelect
                    label="Agent"
                    value={agentEmail}
                    options={agentOptions}
                    placeholder="Select agent"
                    onChange={changeAgent}
                    buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                    menuClassName="min-w-full"
                  />
                </MetaField>
              ) : null}

              {showAssignee ? (
                <MetaField label="Assignee">
                  {canPickAssignee ? (
                    <TaskAssigneeDropdown
                      assignees={assignees}
                      selectedEmails={selectedAssignees}
                      agentEmail={effectiveAgentEmail || null}
                      onToggle={toggleAssignee}
                    />
                  ) : (
                    <div className="flex h-10 items-center rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm font-medium text-[#172b4d]">
                      Assigned to you
                    </div>
                  )}
                </MetaField>
              ) : null}
```

- [ ] **Step 4: Restore the gate in `TaskDetailDrawer.tsx` (view/edit of an existing task — no fallback needed, the task already has real values)**

Add the two props to the destructure and type (same shape as Task 2 Step 3):

```tsx
export function TaskDetailDrawer({
  task,
  canEdit,
  canAssign,
  canDelete,
  canChangeStatus,
  assignees,
  agentMembersByAgent,
  agents,
  mentionMembers,
  categories,
  detailColumns,
  configuredColumnKeys,
  visibleColumnKeys,
  tableColumnOptions,
  currentEmail,
  canReviewDone,
  canViewNonCommentDetail,
  highlightCommentId,
  onClose,
  onPatch,
  onReviewDone,
  onAssigneeChange,
  onDelete,
  onReopenRequest,
}: {
  task: TaskRow;
  canEdit: boolean;
  canAssign: boolean;
  canDelete: boolean;
  canChangeStatus: boolean;
  assignees: TaskAssignee[];
  agentMembersByAgent: Record<string, string[]>;
  agents: TaskAgent[];
  mentionMembers: TaskAssignee[];
  categories: TaskCategory[];
  detailColumns: TableColumn[];
  configuredColumnKeys: ReadonlySet<string>;
  visibleColumnKeys: ReadonlySet<string>;
  tableColumnOptions: TableColumnOption[];
  currentEmail: string;
  canReviewDone: boolean;
  canViewNonCommentDetail: boolean;
  highlightCommentId?: string | null;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onReviewDone: (reviewed: boolean) => void;
  onAssigneeChange: (email: string, assigned: boolean) => void;
  onDelete: () => Promise<void>;
  onReopenRequest: () => void;
}) {
```

Replace:

```tsx
  const canReopen = canChangeStatus && (task.status === "done" || task.status === "cancel");
  const visibleDetailColumns = detailColumns;
```

with:

```tsx
  const canReopen = canChangeStatus && (task.status === "done" || task.status === "cancel");
  const showField = (key: string) =>
    !configuredColumnKeys.has(key) || visibleColumnKeys.has(key);
  const showTitle = showField("summary");
  const showFub = showField("fub");
  const showDescription = showField("description");
  const showStageTime = (["todoTime", "progressTime", "waitingTime"] as const).some(
    showField
  );
  const showPriority = showField("priority");
  const showCategory = showField("category");
  const showAgent = showField("agent");
  const showCreatedBy = showField("reporter");
  const showAssignees = showField("assignee");
  const showQcReview = showField("review");
  const visibleDetailColumns = detailColumns;
```

Wrap the main-column fields back in their conditionals. Replace:

```tsx
              <label className={COMPACT_DETAIL_FIELD_CLASS}>
                <span className={LABEL_CLASS}>Client Name</span>
                <input
                  value={title}
                  disabled={!canEdit}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() =>
                    canEdit &&
                    title.trim() &&
                    title !== task.title &&
                    onPatch({ title: title.trim() })
                  }
                  className={COMPACT_DETAIL_INPUT_CLASS}
                />
              </label>

              <label className={COMPACT_DETAIL_FIELD_CLASS}>
                <span className={LABEL_CLASS}>FUB Link</span>
                <div className="flex gap-1.5">
                  <input
                    value={fubLink}
                    disabled={!canEdit}
                    onChange={(e) => setFubLink(e.target.value)}
                    onBlur={() => {
                      const next = fubLink.trim();
                      if (canEdit && next !== (task.fub_link ?? "")) {
                        onPatch({ fub_link: next || null });
                      }
                    }}
                    placeholder="No FUB link"
                    className={COMPACT_DETAIL_INPUT_CLASS}
                  />
                  {fubHref ? (
                    <a
                      href={fubHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open FUB link"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-[#dfe1e6] bg-white text-[#44546f] transition hover:border-[#85b8ff] hover:bg-[#e9f2ff] hover:text-[#0c66e4]"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </label>

              <label className={COMPACT_DETAIL_FIELD_CLASS}>
                <span className={LABEL_CLASS}>Description</span>
                <textarea
                  ref={descriptionRef}
                  value={description}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    autosizeTextarea(e.currentTarget);
                  }}
                  onBlur={() =>
                    canEdit &&
                    description !== (task.description ?? "") &&
                    onPatch({ description })
                  }
                  rows={2}
                  placeholder="Add a description…"
                  className={COMPACT_DESCRIPTION_CLASS}
                />
              </label>
```

with:

```tsx
              {showTitle ? (
                <label className={COMPACT_DETAIL_FIELD_CLASS}>
                  <span className={LABEL_CLASS}>Client Name</span>
                  <input
                    value={title}
                    disabled={!canEdit}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() =>
                      canEdit &&
                      title.trim() &&
                      title !== task.title &&
                      onPatch({ title: title.trim() })
                    }
                    className={COMPACT_DETAIL_INPUT_CLASS}
                  />
                </label>
              ) : null}

              {showFub ? (
                <label className={COMPACT_DETAIL_FIELD_CLASS}>
                  <span className={LABEL_CLASS}>FUB Link</span>
                  <div className="flex gap-1.5">
                    <input
                      value={fubLink}
                      disabled={!canEdit}
                      onChange={(e) => setFubLink(e.target.value)}
                      onBlur={() => {
                        const next = fubLink.trim();
                        if (canEdit && next !== (task.fub_link ?? "")) {
                          onPatch({ fub_link: next || null });
                        }
                      }}
                      placeholder="No FUB link"
                      className={COMPACT_DETAIL_INPUT_CLASS}
                    />
                    {fubHref ? (
                      <a
                        href={fubHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open FUB link"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-[#dfe1e6] bg-white text-[#44546f] transition hover:border-[#85b8ff] hover:bg-[#e9f2ff] hover:text-[#0c66e4]"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                </label>
              ) : null}

              {showDescription ? (
                <label className={COMPACT_DETAIL_FIELD_CLASS}>
                  <span className={LABEL_CLASS}>Description</span>
                  <textarea
                    ref={descriptionRef}
                    value={description}
                    disabled={!canEdit}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      autosizeTextarea(e.currentTarget);
                    }}
                    onBlur={() =>
                      canEdit &&
                      description !== (task.description ?? "") &&
                      onPatch({ description })
                    }
                    rows={2}
                    placeholder="Add a description…"
                    className={COMPACT_DESCRIPTION_CLASS}
                  />
                </label>
              ) : null}
```

Wrap the aside-column fields back in their conditionals. Replace:

```tsx
              <StageTimeBreakdown task={task} />
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Priority</span>
                  <TaskPrioritySelect
                    value={task.priority}
                    disabled={!canEdit}
                    buttonClassName="!h-9 !rounded-lg !px-2 !text-sm !font-semibold !shadow-none"
                    onChange={(nextPriority) =>
                      onPatch({ priority: nextPriority as TaskPriority })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Category</span>
                  <TaskSelect
                    label="Category"
                    value={task.category_id ?? ""}
                    disabled={!canEdit}
                    options={categoryOptions}
                    placeholder="Select category"
                    buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                    onChange={(nextCategoryId) => onPatch({ category_id: nextCategoryId })}
                  />
                </div>

                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Agent</span>
                  <TaskSelect
                    label="Agent"
                    value={task.agent_email ?? ""}
                    disabled={!canEdit}
                    options={agentOptions}
                    placeholder="Select agent"
                    buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                    onChange={(nextAgent) => onPatch({ agent_email: nextAgent })}
                  />
                </div>

                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Created by</span>
                  <div className="min-h-9 rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] px-3 py-2 text-sm font-medium text-[#172b4d]">
                    {task.reporter_email
                      ? personLabelByEmail.get(task.reporter_email) ??
                        formatEmailAsName(task.reporter_email)
                      : "—"}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Assignees</span>
                  {canAssign ? (
                    <TaskAssigneeDropdown
                      assignees={assignees}
                      selectedEmails={task.assignees}
                      agentEmail={task.agent_email}
                      agentMembersByAgent={agentMembersByAgent}
                      onToggle={onAssigneeChange}
                    />
                  ) : (
                    <div className="flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-sm font-medium text-[#172b4d]">
                      <AvatarStack emails={task.assignees} labelByEmail={personLabelByEmail} />
                      <span className="min-w-0 truncate">
                        {task.assignees.length > 0
                          ? task.assignees
                              .map(
                                (email) =>
                                  personLabelByEmail.get(email) ??
                                  formatEmailAsName(email)
                              )
                              .join(", ")
                          : "Unassigned"}
                      </span>
                    </div>
                  )}
                </div>

                {visibleDetailColumns.map((column) => (
```

with:

```tsx
              {showStageTime ? <StageTimeBreakdown task={task} /> : null}
              <div className="space-y-3">
                {showPriority ? (
                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Priority</span>
                  <TaskPrioritySelect
                    value={task.priority}
                    disabled={!canEdit}
                    buttonClassName="!h-9 !rounded-lg !px-2 !text-sm !font-semibold !shadow-none"
                    onChange={(nextPriority) =>
                      onPatch({ priority: nextPriority as TaskPriority })
                    }
                  />
                </div>
                ) : null}

                {showCategory ? (
                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Category</span>
                  <TaskSelect
                    label="Category"
                    value={task.category_id ?? ""}
                    disabled={!canEdit}
                    options={categoryOptions}
                    placeholder="Select category"
                    buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                    onChange={(nextCategoryId) => onPatch({ category_id: nextCategoryId })}
                  />
                </div>
                ) : null}

                {showAgent ? (
                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Agent</span>
                  <TaskSelect
                    label="Agent"
                    value={task.agent_email ?? ""}
                    disabled={!canEdit}
                    options={agentOptions}
                    placeholder="Select agent"
                    buttonClassName={SIDE_SELECT_BUTTON_CLASS}
                    onChange={(nextAgent) => onPatch({ agent_email: nextAgent })}
                  />
                </div>
                ) : null}

                {showCreatedBy ? (
                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Created by</span>
                  <div className="min-h-9 rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] px-3 py-2 text-sm font-medium text-[#172b4d]">
                    {task.reporter_email
                      ? personLabelByEmail.get(task.reporter_email) ??
                        formatEmailAsName(task.reporter_email)
                      : "—"}
                  </div>
                </div>
                ) : null}

                {showAssignees ? (
                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>Assignees</span>
                  {canAssign ? (
                    <TaskAssigneeDropdown
                      assignees={assignees}
                      selectedEmails={task.assignees}
                      agentEmail={task.agent_email}
                      agentMembersByAgent={agentMembersByAgent}
                      onToggle={onAssigneeChange}
                    />
                  ) : (
                    <div className="flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-sm font-medium text-[#172b4d]">
                      <AvatarStack emails={task.assignees} labelByEmail={personLabelByEmail} />
                      <span className="min-w-0 truncate">
                        {task.assignees.length > 0
                          ? task.assignees
                              .map(
                                (email) =>
                                  personLabelByEmail.get(email) ??
                                  formatEmailAsName(email)
                              )
                              .join(", ")
                          : "Unassigned"}
                      </span>
                    </div>
                  )}
                </div>
                ) : null}

                {visibleDetailColumns.map((column) => (
```

Replace the closing QC block:

```tsx
                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>QC Review</span>
                  <DoneReviewPanel
                    task={task}
                    canReviewDone={canReviewDone}
                    onReviewDone={onReviewDone}
                  />
                </div>
              </div>
```

with:

```tsx
                {showQcReview ? (
                <div className="space-y-1.5">
                  <span className={LABEL_CLASS}>QC Review</span>
                  <DoneReviewPanel
                    task={task}
                    canReviewDone={canReviewDone}
                    onReviewDone={onReviewDone}
                  />
                </div>
                ) : null}
              </div>
```

- [ ] **Step 5: Typecheck, test, lint**

Run: `npx tsc --noEmit && npx vitest run && rtk proxy npx eslint "src/app/(authed)/tasks/_components/TaskBoardClient.tsx" "src/app/(authed)/tasks/_components/NewTaskDialog.tsx" "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx"`
Expected: `TypeScript: No errors found`, `PASS (419) FAIL (0)`, no eslint output.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(authed)/tasks/_components/TaskBoardClient.tsx" "src/app/(authed)/tasks/_components/NewTaskDialog.tsx" "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx"
git commit -m "fix(tasks): restore admin Hidden control over Create/Detail without per-user leak"
```

---

### Task 3: Restore admin-controlled Create/Detail visibility for Enrollment system fields

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

**Interfaces:**
- Consumes: `layoutTableColumns: TableColumn[]` (already in scope, holds `table_column` rows for `scope=aca|medicare`).
- Produces: `adminVisibleColumnKeys: ReadonlySet<EnrollmentColumnKey>` passed as the `visibleColumnKeys` prop into both `EnrollmentDrawer` and `NewEnrollmentDialog`.

**Design note:** Unlike CS, Enrollment's `showField` never had a `configuredColumnKeys` escape hatch — every field it gates (`client`, `stage`, `fub`, `due`, `payment`, `carrier`, `aca`, `consent`, `platform`, `agent`, `caller`, `responsible`, `createdBy`, `pcp2025`, `pcp2026`, `qc`) is a genuinely seeded system column for `aca`/`medicare` (confirmed live in the database — `agent` specifically is seeded by `ensureTableColumns()`'s `DEFAULT_TABLE_COLUMNS` in `src/lib/table-config/queries.ts`, not by `schema.sql`'s static seed; see Task 5). So no escape hatch is needed here — keep `showField(key) = adminVisibleColumnKeys.has(key)`, unchanged shape from before this bug.

- [ ] **Step 1: Add the admin-visibility set, and close the same Hidden gap for Enrollment custom columns**

Find (around line 471-478):

```tsx
  const detailCustomColumns = useMemo(
    () =>
      layoutTableColumns.filter(
        (column) =>
          column.show_in_detail && !column.is_system && !column.archived_at
      ),
    [layoutTableColumns]
  );
```

Replace with:

```tsx
  // Admin-level visibility for the Create dialog + Detail drawer — computed
  // straight from the raw column config, deliberately NOT from
  // visibleColumns above (that one also folds in this specific user's
  // personal List/Board column-hide state via hiddenColumnKeys, which must
  // never affect whether a field can be created/edited).
  const adminVisibleColumnKeys = useMemo(
    () =>
      new Set(
        layoutTableColumns
          .filter((column) => !column.archived_at && !column.hidden_default)
          .map((column) => column.key)
      ) as ReadonlySet<EnrollmentColumnKey>,
    [layoutTableColumns]
  );
  const detailCustomColumns = useMemo(
    () =>
      layoutTableColumns.filter(
        (column) =>
          column.show_in_detail &&
          !column.is_system &&
          !column.archived_at &&
          !column.hidden_default
      ),
    [layoutTableColumns]
  );
```

This adds `!column.hidden_default` to `detailCustomColumns`'s existing filter (previously `show_in_detail && !is_system && !archived_at`) — a custom Enrollment column ticked Hidden now disappears from Create/Detail the same way a system column does, closing the asymmetry described in the Architecture section above. `detailCustomColumns` still feeds `detailColumns`/`visibleDetailColumns` in both `EnrollmentDrawer` and `NewEnrollmentDialog` unfiltered — no second gate needed there.

- [ ] **Step 2: Pass it into both call sites**

Find the `<EnrollmentDrawer` JSX block and add the prop back after `tableColumnOptions={tableColumnOptions}`:

```tsx
          detailColumns={detailCustomColumns}
          visibleColumnKeys={adminVisibleColumnKeys}
          tableColumnOptions={tableColumnOptions}
          currentEmail={currentEmail}
          isManager={canManageOptions}
```

Find the `<NewEnrollmentDialog` JSX block and add the prop back after `optionsBySet={optionsBySet}`:

```tsx
          optionsBySet={optionsBySet}
          visibleColumnKeys={adminVisibleColumnKeys}
          currentEmail={currentEmail}
          onClose={() => setCreating(false)}
```

- [ ] **Step 3: Restore the gate in `EnrollmentDrawer`**

Add the prop to the destructure and type:

```tsx
function EnrollmentDrawer({
  record,
  peopleByEmail,
  agentsByEmail,
  mentionMembers,
  optionsById,
  optionsBySet,
  detailColumns,
  visibleColumnKeys,
  tableColumnOptions,
  currentEmail,
  isManager,
  onClose,
  onPatch,
  onArchive,
}: {
  record: EnrollmentRecordWithStats;
  peopleByEmail: Map<string, string>;
  agentsByEmail: Map<string, string>;
  mentionMembers: TaskAssignee[];
  optionsById: Map<string, EnrollmentOption>;
  optionsBySet: EnrollmentOptionsBySet;
  detailColumns: TableColumn[];
  visibleColumnKeys: ReadonlySet<EnrollmentColumnKey>;
  tableColumnOptions: TableColumnOption[];
  currentEmail: string;
  isManager: boolean;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onArchive: () => Promise<void>;
}) {
```

Replace:

```tsx
  const isMedicare = record.program === "medicare";
  const showPayment = !isMedicare;
  const showAca = !isMedicare;
  const showConsent = !isMedicare;
  const showPlatform = !isMedicare;
  const showCaller = !isMedicare;
  const showPcp2026 = !isMedicare;
  const visibleDetailColumns = detailColumns;
```

with:

```tsx
  const isMedicare = record.program === "medicare";
  const showField = (key: string) =>
    visibleColumnKeys.has(key as EnrollmentColumnKey);
  const showClient = showField("client");
  const showStage = showField("stage");
  const showFub = showField("fub");
  const showDue = showField("due");
  const showPayment = !isMedicare && showField("payment");
  const showCarrier = showField("carrier");
  const showAca = !isMedicare && showField("aca");
  const showConsent = !isMedicare && showField("consent");
  const showPlatform = !isMedicare && showField("platform");
  const showAgent = showField("agent");
  const showCaller = !isMedicare && showField("caller");
  const showResponsible = showField("responsible");
  const showCreatedBy = showField("createdBy");
  const showPcp2025 = showField("pcp2025");
  const showPcp2026 = !isMedicare && showField("pcp2026");
  const showQc = showField("qc");
  const visibleDetailColumns = detailColumns;
```

Replace the header stage pill condition:

```tsx
            {stage ? (
```

with:

```tsx
            {stage && showStage ? (
```

Wrap the main-column fields. Replace:

```tsx
              <label className={COMPACT_DETAIL_FIELD_CLASS}>
                <span className={LABEL_CLASS}>Client Name</span>
                <EditableInput
                  value={record.client_name ?? ""}
                  placeholder="Client name"
                  className={COMPACT_DETAIL_INPUT_CLASS}
                  onSave={(value) => onPatch({ client_name: value })}
                />
              </label>

              <label className={COMPACT_DETAIL_FIELD_CLASS}>
                <span className={LABEL_CLASS}>FUB Link</span>
                <div className="flex gap-1.5">
                  <EditableInput
                    value={record.fub_link ?? ""}
                    placeholder="No FUB link"
                    className={COMPACT_DETAIL_INPUT_CLASS}
                    onSave={(value) => onPatch({ fub_link: value })}
                  />
                  {fubHref ? (
                    <a
                      href={fubHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open FUB link"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-[#dfe1e6] bg-white text-[#44546f] transition hover:border-[#85b8ff] hover:bg-[#e9f2ff] hover:text-[#0c66e4]"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </label>
```

with:

```tsx
              {showClient ? (
                <label className={COMPACT_DETAIL_FIELD_CLASS}>
                  <span className={LABEL_CLASS}>Client Name</span>
                  <EditableInput
                    value={record.client_name ?? ""}
                    placeholder="Client name"
                    className={COMPACT_DETAIL_INPUT_CLASS}
                    onSave={(value) => onPatch({ client_name: value })}
                  />
                </label>
              ) : null}

              {showFub ? (
                <label className={COMPACT_DETAIL_FIELD_CLASS}>
                  <span className={LABEL_CLASS}>FUB Link</span>
                  <div className="flex gap-1.5">
                    <EditableInput
                      value={record.fub_link ?? ""}
                      placeholder="No FUB link"
                      className={COMPACT_DETAIL_INPUT_CLASS}
                      onSave={(value) => onPatch({ fub_link: value })}
                    />
                    {fubHref ? (
                      <a
                        href={fubHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open FUB link"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-[#dfe1e6] bg-white text-[#44546f] transition hover:border-[#85b8ff] hover:bg-[#e9f2ff] hover:text-[#0c66e4]"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                </label>
              ) : null}
```

Wrap the aside fields. Replace:

```tsx
              <FieldBlock label="Stage">
                <EnrollmentStagePill
                  stageId={record.stage_id}
                  stages={optionsBySet.stage}
                  field
                  onChange={(value) => onPatch({ stage_id: value })}
                />
              </FieldBlock>

              <FieldBlock label="Due date">
                <input
                  type="date"
                  value={formatDateInput(record.due_date)}
                  onChange={(event) =>
                    void onPatch({ due_date: event.target.value || null })
                  }
                  className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`}
                />
              </FieldBlock>

              {showPayment ? (
```

with:

```tsx
              {showStage ? (
                <FieldBlock label="Stage">
                  <EnrollmentStagePill
                    stageId={record.stage_id}
                    stages={optionsBySet.stage}
                    field
                    onChange={(value) => onPatch({ stage_id: value })}
                  />
                </FieldBlock>
              ) : null}

              {showDue ? (
                <FieldBlock label="Due date">
                  <input
                    type="date"
                    value={formatDateInput(record.due_date)}
                    onChange={(event) =>
                      void onPatch({ due_date: event.target.value || null })
                    }
                    className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`}
                  />
                </FieldBlock>
              ) : null}

              {showPayment ? (
```

Replace:

```tsx
              <FieldBlock label="Carrier">
                <EnrollmentOptionMenu
                  optionId={record.carrier_id}
                  options={optionsBySet.carrier}
                  emptyLabel="No carrier"
                  field
                  onChange={(value) => void onPatch({ carrier_id: value })}
                />
              </FieldBlock>

              {showAca ? (
```

with:

```tsx
              {showCarrier ? (
                <FieldBlock label="Carrier">
                  <EnrollmentOptionMenu
                    optionId={record.carrier_id}
                    options={optionsBySet.carrier}
                    emptyLabel="No carrier"
                    field
                    onChange={(value) => void onPatch({ carrier_id: value })}
                  />
                </FieldBlock>
              ) : null}

              {showAca ? (
```

Replace:

```tsx
              <FieldBlock label="Agent">
                <EnrollmentPersonMenu
                  value={record.agent_email}
                  peopleByEmail={agentsByEmail}
                  emptyLabel="No agent"
                  field
                  onChange={(value) => void onPatch({ agent_email: value })}
                />
              </FieldBlock>

              {showCaller ? (
                <FieldBlock label="Caller">
                  <EnrollmentPersonMenu
                    value={record.caller_email}
                    peopleByEmail={peopleByEmail}
                    emptyLabel="No caller"
                    field
                    onChange={(value) => void onPatch({ caller_email: value })}
                  />
                </FieldBlock>
              ) : null}

              <FieldBlock label={isMedicare ? "Assignee" : "Responsible enroll"}>
                <EnrollmentPersonMenu
                  value={record.responsible_enroll_email}
                  peopleByEmail={peopleByEmail}
                  emptyLabel="Unassigned"
                  field
                  onChange={(value) =>
                    void onPatch({ responsible_enroll_email: value })
                  }
                />
              </FieldBlock>

              <FieldBlock label="Created by">
                <div className="min-h-9 rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] px-3 py-2 text-sm font-medium text-[#172b4d]">
                  {personLabel(record.created_by_email, peopleByEmail)}
                </div>
              </FieldBlock>

              <FieldBlock label={isMedicare ? "PCP" : "PCP 2025"}>
                <EditableInput
                  value={record.pcp_2025 ?? ""}
                  placeholder={isMedicare ? "No PCP" : "No PCP 2025"}
                  className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`}
                  onSave={(value) => onPatch({ pcp_2025: value })}
                />
              </FieldBlock>

              {showPcp2026 ? (
```

with:

```tsx
              {showAgent ? (
                <FieldBlock label="Agent">
                  <EnrollmentPersonMenu
                    value={record.agent_email}
                    peopleByEmail={agentsByEmail}
                    emptyLabel="No agent"
                    field
                    onChange={(value) => void onPatch({ agent_email: value })}
                  />
                </FieldBlock>
              ) : null}

              {showCaller ? (
                <FieldBlock label="Caller">
                  <EnrollmentPersonMenu
                    value={record.caller_email}
                    peopleByEmail={peopleByEmail}
                    emptyLabel="No caller"
                    field
                    onChange={(value) => void onPatch({ caller_email: value })}
                  />
                </FieldBlock>
              ) : null}

              {showResponsible ? (
                <FieldBlock label={isMedicare ? "Assignee" : "Responsible enroll"}>
                  <EnrollmentPersonMenu
                    value={record.responsible_enroll_email}
                    peopleByEmail={peopleByEmail}
                    emptyLabel="Unassigned"
                    field
                    onChange={(value) =>
                      void onPatch({ responsible_enroll_email: value })
                    }
                  />
                </FieldBlock>
              ) : null}

              {showCreatedBy ? (
                <FieldBlock label="Created by">
                  <div className="min-h-9 rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] px-3 py-2 text-sm font-medium text-[#172b4d]">
                    {personLabel(record.created_by_email, peopleByEmail)}
                  </div>
                </FieldBlock>
              ) : null}

              {showPcp2025 ? (
                <FieldBlock label={isMedicare ? "PCP" : "PCP 2025"}>
                  <EditableInput
                    value={record.pcp_2025 ?? ""}
                    placeholder={isMedicare ? "No PCP" : "No PCP 2025"}
                    className={`${INPUT_CLASS} h-9 px-2 py-1.5 font-semibold`}
                    onSave={(value) => onPatch({ pcp_2025: value })}
                  />
                </FieldBlock>
              ) : null}

              {showPcp2026 ? (
```

Replace the closing QC block:

```tsx
              <FieldBlock label="QC Review">
                <EnrollmentQCPanel
                  record={record}
                  stage={stage}
                  onToggle={() => onPatch({ qc_checked: !record.qc_checked_at })}
                />
              </FieldBlock>
            </div>
```

with:

```tsx
              {showQc ? (
                <FieldBlock label="QC Review">
                  <EnrollmentQCPanel
                    record={record}
                    stage={stage}
                    onToggle={() => onPatch({ qc_checked: !record.qc_checked_at })}
                  />
                </FieldBlock>
              ) : null}
            </div>
```

- [ ] **Step 4: Restore the gate + Agent fallback in `NewEnrollmentDialog`**

Add the prop to the destructure and type:

```tsx
function NewEnrollmentDialog({
  program,
  peopleByEmail,
  agentsByEmail,
  optionsBySet,
  visibleColumnKeys,
  currentEmail,
  onClose,
  onCreate,
}: {
  program: EnrollmentProgram;
  peopleByEmail: Map<string, string>;
  agentsByEmail: Map<string, string>;
  optionsBySet: EnrollmentOptionsBySet;
  visibleColumnKeys: ReadonlySet<EnrollmentColumnKey>;
  currentEmail: string;
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
}) {
```

Replace:

```tsx
  const showPayment = !isMedicare;
  const showAca = !isMedicare;
  const showConsent = !isMedicare;
  const showPlatform = !isMedicare;
  const showCaller = !isMedicare;
  const showPcp2026 = !isMedicare;
```

with:

```tsx
  const showField = (key: EnrollmentColumnKey) => visibleColumnKeys.has(key);
  const showFub = showField("fub");
  const showStage = showField("stage");
  const showDue = showField("due");
  const showPayment = !isMedicare && showField("payment");
  const showCarrier = showField("carrier");
  const showAca = !isMedicare && showField("aca");
  const showConsent = !isMedicare && showField("consent");
  const showPlatform = !isMedicare && showField("platform");
  const showAgent = showField("agent");
  const showCaller = !isMedicare && showField("caller");
  const showResponsible = showField("responsible");
  const showPcp2025 = showField("pcp2025");
  const showPcp2026 = !isMedicare && showField("pcp2026");
  const showPipelineSection = showStage || showDue;
  const showPlanSection =
    showPayment || showCarrier || showAca || showConsent || showPlatform;
  const showOwnershipSection = showAgent || showCaller || showResponsible;
  const showPcpSection = showPcp2025 || showPcp2026;
  // Agent is hard-required to submit (see the Create button's disabled= check
  // below). If an admin hides the column, the picker disappears — fall back
  // to a sane default instead of leaving Create permanently disabled.
  const fallbackAgentEmail = agentsByEmail.has(currentEmail)
    ? currentEmail
    : [...agentsByEmail.keys()][0] ?? "";
  const effectiveAgentEmail =
    form.agent_email || (!showAgent ? fallbackAgentEmail : "");
```

(This block goes right after the `useEffect(() => { ticketInputRef.current?.focus(); }, []);` and before `function update(...)`, i.e. where the old five-flag block was — it references `form`, which is declared above it, so placement is unchanged.)

Replace the `submit()` payload construction:

```tsx
      const payload = isMedicare
        ? {
            ...form,
            caller_email: "",
            payment_status_id: "",
            aca_status_id: "",
            consent_id: "",
            platform_id: "",
            pcp_2026: "",
          }
        : form;
      await onCreate(payload);
```

with:

```tsx
      const payload = isMedicare
        ? {
            ...form,
            agent_email: effectiveAgentEmail,
            caller_email: "",
            payment_status_id: "",
            aca_status_id: "",
            consent_id: "",
            platform_id: "",
            pcp_2026: "",
          }
        : { ...form, agent_email: effectiveAgentEmail };
      await onCreate(payload);
```

Wrap the main-column FUB field. Replace:

```tsx
              <label className={COMPACT_DETAIL_FIELD_CLASS}>
                <span className={LABEL_CLASS}>FUB Link</span>
                <input
                  value={form.fub_link}
                  onChange={(event) => update("fub_link", event.target.value)}
                  placeholder="https://app.followupboss.com/..."
                  className={COMPACT_DETAIL_INPUT_CLASS}
                />
              </label>
```

with:

```tsx
              {showFub ? (
                <label className={COMPACT_DETAIL_FIELD_CLASS}>
                  <span className={LABEL_CLASS}>FUB Link</span>
                  <input
                    value={form.fub_link}
                    onChange={(event) => update("fub_link", event.target.value)}
                    placeholder="https://app.followupboss.com/..."
                    className={COMPACT_DETAIL_INPUT_CLASS}
                  />
                </label>
              ) : null}
```

Wrap the four `CreatePropertySection` blocks. Replace:

```tsx
              <CreatePropertySection>
                <CreatePropertyField label="Stage">
                  <EnrollmentStagePill
                    stageId={form.stage_id || null}
                    stages={optionsBySet.stage}
                    onChange={async (value) => update("stage_id", value)}
                  />
                </CreatePropertyField>

                <CreatePropertyInput
                  label="Due date"
                  type="date"
                  value={form.due_date}
                  onChange={(value) => update("due_date", value)}
                />
              </CreatePropertySection>

              <CreatePropertySection>
                {showPayment ? (
```

with:

```tsx
              {showPipelineSection ? (
                <CreatePropertySection>
                  {showStage ? (
                    <CreatePropertyField label="Stage">
                      <EnrollmentStagePill
                        stageId={form.stage_id || null}
                        stages={optionsBySet.stage}
                        onChange={async (value) => update("stage_id", value)}
                      />
                    </CreatePropertyField>
                  ) : null}

                  {showDue ? (
                    <CreatePropertyInput
                      label="Due date"
                      type="date"
                      value={form.due_date}
                      onChange={(value) => update("due_date", value)}
                    />
                  ) : null}
                </CreatePropertySection>
              ) : null}

              {showPlanSection ? (
                <CreatePropertySection>
                {showPayment ? (
```

Replace:

```tsx
                <CreatePropertyField label="Carrier">
                  <EnrollmentOptionMenu
                    optionId={form.carrier_id || null}
                    options={optionsBySet.carrier}
                    emptyLabel="No carrier"
                    onChange={(value) => update("carrier_id", value)}
                  />
                </CreatePropertyField>

                {showAca ? (
```

with:

```tsx
                {showCarrier ? (
                  <CreatePropertyField label="Carrier">
                    <EnrollmentOptionMenu
                      optionId={form.carrier_id || null}
                      options={optionsBySet.carrier}
                      emptyLabel="No carrier"
                      onChange={(value) => update("carrier_id", value)}
                    />
                  </CreatePropertyField>
                ) : null}

                {showAca ? (
```

Replace:

```tsx
              </CreatePropertySection>

              <CreatePropertySection>
                <CreatePropertyField label="Agent">
                  <EnrollmentPersonMenu
                    value={form.agent_email || null}
                    peopleByEmail={agentsByEmail}
                    emptyLabel="No agent"
                    onChange={(value) => update("agent_email", value)}
                  />
                </CreatePropertyField>

                {showCaller ? (
                  <CreatePropertyField label="Caller">
                    <EnrollmentPersonMenu
                      value={form.caller_email || null}
                      peopleByEmail={peopleByEmail}
                      emptyLabel="No caller"
                      onChange={(value) => update("caller_email", value)}
                    />
                  </CreatePropertyField>
                ) : null}

                <CreatePropertyField label={isMedicare ? "Assignee" : "Responsible enroll"}>
                  <EnrollmentPersonMenu
                    value={form.responsible_enroll_email || null}
                    peopleByEmail={peopleByEmail}
                    emptyLabel="Unassigned"
                    onChange={(value) => update("responsible_enroll_email", value)}
                  />
                </CreatePropertyField>
              </CreatePropertySection>

              <CreatePropertySection>
                <CreatePropertyInput
                  label={isMedicare ? "PCP" : "PCP 2025"}
                  value={form.pcp_2025}
                  placeholder={isMedicare ? "No PCP" : "No PCP 2025"}
                  onChange={(value) => update("pcp_2025", value)}
                />

                {showPcp2026 ? (
                  <CreatePropertyInput
                    label="PCP 2026"
                    value={form.pcp_2026}
                    placeholder="No PCP 2026"
                    onChange={(value) => update("pcp_2026", value)}
                  />
                ) : null}
              </CreatePropertySection>
            </aside>
```

with:

```tsx
                </CreatePropertySection>
              ) : null}

              {showOwnershipSection ? (
                <CreatePropertySection>
                  {showAgent ? (
                    <CreatePropertyField label="Agent">
                      <EnrollmentPersonMenu
                        value={form.agent_email || null}
                        peopleByEmail={agentsByEmail}
                        emptyLabel="No agent"
                        onChange={(value) => update("agent_email", value)}
                      />
                    </CreatePropertyField>
                  ) : null}

                  {showCaller ? (
                    <CreatePropertyField label="Caller">
                      <EnrollmentPersonMenu
                        value={form.caller_email || null}
                        peopleByEmail={peopleByEmail}
                        emptyLabel="No caller"
                        onChange={(value) => update("caller_email", value)}
                      />
                    </CreatePropertyField>
                  ) : null}

                  {showResponsible ? (
                    <CreatePropertyField label={isMedicare ? "Assignee" : "Responsible enroll"}>
                      <EnrollmentPersonMenu
                        value={form.responsible_enroll_email || null}
                        peopleByEmail={peopleByEmail}
                        emptyLabel="Unassigned"
                        onChange={(value) => update("responsible_enroll_email", value)}
                      />
                    </CreatePropertyField>
                  ) : null}
                </CreatePropertySection>
              ) : null}

              {showPcpSection ? (
                <CreatePropertySection>
                  {showPcp2025 ? (
                    <CreatePropertyInput
                      label={isMedicare ? "PCP" : "PCP 2025"}
                      value={form.pcp_2025}
                      placeholder={isMedicare ? "No PCP" : "No PCP 2025"}
                      onChange={(value) => update("pcp_2025", value)}
                    />
                  ) : null}

                  {showPcp2026 ? (
                    <CreatePropertyInput
                      label="PCP 2026"
                      value={form.pcp_2026}
                      placeholder="No PCP 2026"
                      onChange={(value) => update("pcp_2026", value)}
                    />
                  ) : null}
                </CreatePropertySection>
              ) : null}
            </aside>
```

Replace the Create button's `disabled` check:

```tsx
            disabled={
              saving ||
              (!form.client_name.trim() && !form.fub_link.trim()) ||
              !form.agent_email.trim()
            }
```

with:

```tsx
            disabled={
              saving ||
              (!form.client_name.trim() && !form.fub_link.trim()) ||
              !effectiveAgentEmail.trim()
            }
```

- [ ] **Step 5: Typecheck, test, lint**

Run: `npx tsc --noEmit && npx vitest run && rtk proxy npx eslint "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"`
Expected: `TypeScript: No errors found`, `PASS (419) FAIL (0)`, no eslint output.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "fix(enrollment): restore admin Hidden control over Create/Detail without per-user leak"
```

---

### Task 4: Disable the "Detail" checkbox for system columns in Config

**Files:**
- Modify: `src/app/(authed)/config/_components/ConfigClient.tsx:713-733` (`SortableColumnRow`) and `:802-822` (`StaticColumnRow`) — two near-duplicate row renderers, same change in both.

**Interfaces:**
- Consumes: `column.is_system: boolean` (already available in both components).
- Produces: no new interface — pure UI change.

**Context:** `show_in_detail` is only ever read for `!is_system` columns (`taskDetailColumns` in `TaskBoardClient.tsx`, `detailCustomColumns` in `EnrollmentClient.tsx`, both unchanged by this plan). Toggling "Detail" on a system row currently does nothing, silently. Disable it there so the control stops implying a capability that doesn't exist.

- [ ] **Step 1: `SortableColumnRow`**

Replace:

```tsx
      <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#44546f]">
        <input
          type="checkbox"
          checked={column.show_in_detail}
          onChange={(event) =>
            void onPatch({ show_in_detail: event.target.checked })
          }
        />
        Detail
      </label>
      {column.is_system ? (
        <span className="text-xs font-bold uppercase text-[#97a0af]">System</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onArchive()}
          className="inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-sm font-bold text-[#bf2600] hover:bg-[#ffebe6]"
        >
          <Trash2 className="h-4 w-4" /> Archive
        </button>
      )}
    </div>
  );
}

function StaticColumnRow({
```

with:

```tsx
      <label
        className="inline-flex items-center gap-2 text-sm font-semibold text-[#44546f] disabled:cursor-not-allowed disabled:opacity-50"
        title={
          column.is_system
            ? "Built-in fields always appear on the form unless Hidden — Detail only applies to custom columns."
            : undefined
        }
      >
        <input
          type="checkbox"
          checked={column.show_in_detail}
          disabled={column.is_system}
          onChange={(event) =>
            void onPatch({ show_in_detail: event.target.checked })
          }
        />
        Detail
      </label>
      {column.is_system ? (
        <span className="text-xs font-bold uppercase text-[#97a0af]">System</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onArchive()}
          className="inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-sm font-bold text-[#bf2600] hover:bg-[#ffebe6]"
        >
          <Trash2 className="h-4 w-4" /> Archive
        </button>
      )}
    </div>
  );
}

function StaticColumnRow({
```

- [ ] **Step 2: `StaticColumnRow`**

Replace:

```tsx
      <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#44546f]">
        <input
          type="checkbox"
          checked={column.show_in_detail}
          onChange={(event) =>
            void onPatch({ show_in_detail: event.target.checked })
          }
        />
        Detail
      </label>
      {column.is_system ? (
        <span className="text-xs font-bold uppercase text-[#97a0af]">System</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onArchive()}
          className="inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-sm font-bold text-[#bf2600] hover:bg-[#ffebe6]"
        >
          <Trash2 className="h-4 w-4" /> Archive
        </button>
      )}
    </div>
  );
}
```

with:

```tsx
      <label
        className="inline-flex items-center gap-2 text-sm font-semibold text-[#44546f] disabled:cursor-not-allowed disabled:opacity-50"
        title={
          column.is_system
            ? "Built-in fields always appear on the form unless Hidden — Detail only applies to custom columns."
            : undefined
        }
      >
        <input
          type="checkbox"
          checked={column.show_in_detail}
          disabled={column.is_system}
          onChange={(event) =>
            void onPatch({ show_in_detail: event.target.checked })
          }
        />
        Detail
      </label>
      {column.is_system ? (
        <span className="text-xs font-bold uppercase text-[#97a0af]">System</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onArchive()}
          className="inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-sm font-bold text-[#bf2600] hover:bg-[#ffebe6]"
        >
          <Trash2 className="h-4 w-4" /> Archive
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck, test, lint**

Run: `npx tsc --noEmit && npx vitest run && rtk proxy npx eslint "src/app/(authed)/config/_components/ConfigClient.tsx"`
Expected: `TypeScript: No errors found`, `PASS (419) FAIL (0)`, no eslint output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/config/_components/ConfigClient.tsx"
git commit -m "fix(config): disable the Detail checkbox for system columns, it has no effect there"
```

---

### Task 5 (optional, low-priority): Reconcile `schema.sql` with `queries.ts`'s default column list

**Files:**
- Modify: `supabase/schema.sql:2599-2630` (`system_column_seed` CTE)

**Interfaces:** none — data seed only.

**Context:** `src/lib/table-config/queries.ts`'s `DEFAULT_TABLE_COLUMNS` already includes an `agent` column (position 25) for both `aca` and `medicare`, and `ensureTableColumns()` self-heals it into the live database on first read of that scope — this is why production already has it and nothing is functionally broken. `schema.sql`'s static `system_column_seed` CTE, used to set up a **brand-new** environment, does not have this row. Since the seed uses `on conflict (scope, key) do nothing`, adding it is a no-op on the current database and only matters for a fresh install. **Not required for the bug fix — skip if short on time.**

- [ ] **Step 1: Add the missing rows**

In `supabase/schema.sql`, inside the `system_column_seed` CTE, replace:

```sql
    ('aca', 'key', 'Key', 'text', 10, false),
    ('aca', 'client', 'Client Name', 'text', 20, false),
    ('aca', 'stage', 'Stage', 'dropdown', 30, false),
```

with:

```sql
    ('aca', 'key', 'Key', 'text', 10, false),
    ('aca', 'client', 'Client Name', 'text', 20, false),
    ('aca', 'agent', 'Agent', 'person', 25, false),
    ('aca', 'stage', 'Stage', 'dropdown', 30, false),
```

Replace:

```sql
    ('medicare', 'key', 'Key', 'text', 10, false),
    ('medicare', 'client', 'Client Name', 'text', 20, false),
    ('medicare', 'stage', 'Stage', 'dropdown', 30, false),
```

with:

```sql
    ('medicare', 'key', 'Key', 'text', 10, false),
    ('medicare', 'client', 'Client Name', 'text', 20, false),
    ('medicare', 'agent', 'Agent', 'person', 25, false),
    ('medicare', 'stage', 'Stage', 'dropdown', 30, false),
```

- [ ] **Step 2: Tell the user to run it manually**

Per project rule, do **not** run `schema.sql` yourself — tell the user the file changed and ask them to re-run it against Supabase whenever convenient (safe to re-run: `on conflict do nothing`, and the row already exists live so this is genuinely a no-op today).

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "chore(schema): seed aca/medicare 'agent' system column, already self-healed in prod"
```

---

### Task 6: Full verification pass + changelog

**Files:**
- Modify: `changelog.md`

- [ ] **Step 1: Static checks across everything touched**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `TypeScript: No errors found`, `PASS (419) FAIL (0)`.

Run: `rtk proxy npx eslint "src/app/(authed)/tasks/_components/TaskBoardClient.tsx" "src/app/(authed)/tasks/_components/NewTaskDialog.tsx" "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx" "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" "src/app/(authed)/config/_components/ConfigClient.tsx" "src/app/api/config/columns/[id]/route.ts"`
Expected: no output.

- [ ] **Step 2: Manual QA — the exact bug from the screenshot**

In `/config` → Table Columns (scope ACA), turn ON "Hidden" for `PCP 2025`. Open Health ACA Enrollment → New enrollment: confirm the PCP 2025 field is gone. Open an existing ACA record's detail drawer: confirm PCP 2025 is gone there too (existing stored value untouched). Turn "Hidden" back OFF: confirm it reappears in both places immediately (may need a refresh if realtime broadcast doesn't reach the open dialog).

- [ ] **Step 3: Manual QA — hard-required-field fallback (the two blockers the review agent caught)**

CS: in `/config` → Table Columns (scope CS), turn ON "Hidden" for `Agent`. Open Tasks → New task: confirm the Agent picker is gone but the Create button is still clickable, and the created task ends up with a real `agent_email` (your own, if you're a valid agent option, else the first agent in the list) — not empty. Repeat for `Category`. Turn both back OFF.

Enrollment: in `/config` → Table Columns (scope ACA), turn ON "Hidden" for `Agent`. Open Health ACA Enrollment → New enrollment: confirm the Agent picker is gone but Create is still clickable once Client Name or FUB Link is filled, and the created record has a real `agent_email`. Turn "Hidden" back OFF.

- [ ] **Step 4: Manual QA — regression check for the original bug (personal List-view hide must NOT reach Create/Detail)**

As a non-admin CS user, open the List view, hide a couple of columns via the List's own column picker (not `/config`). Open New Task and an existing task's Detail drawer: confirm every admin-visible field still shows, regardless of what you just hid in your personal List view. Repeat for Enrollment.

- [ ] **Step 5: Manual QA — Config UI honesty**

In `/config` → Table Columns, confirm every row labeled "System" has its "Detail" checkbox greyed out/disabled, and every custom (non-system) row's "Detail" checkbox still works exactly as before.

- [ ] **Step 6: Write the changelog entry**

In `changelog.md`, add a new entry above the `## 2026-08-04` entry already there today (the one titled "Fix: field hệ thống biến mất khỏi form Tạo/Sửa..."), using this exact text:

```markdown
## 2026-08-04 — Fix (v2): khôi phục đúng quyền admin "Hidden" cho Create/Detail, không làm rò rỉ lại per-user
- **Loại**: fix
- **Cái gì**: Bản fix cùng ngày phía trên (mục ngay dưới) đã đi quá xa — gỡ **toàn bộ** cơ chế ẩn field khỏi Create/Detail, kể cả phần hợp lệ: admin tick "Hidden" ở `/config` → Table Columns cho 1 cột hệ thống (vd `aca/pcp2025`) không còn tác dụng gì trên form Tạo/Sửa nữa (user phát hiện qua ảnh chụp màn hình: PCP 2025 vẫn hiện dù đã tick Hidden). Fix lại đúng: khôi phục `isFieldVisible`/`showField` ở cả 4 component (`NewTaskDialog`, `TaskDetailDrawer`, `NewEnrollmentDialog`, `EnrollmentDrawer`) nhưng nguồn dữ liệu lần này là **`adminVisibleColumnKeys`** — tính thẳng từ `hidden_default` trên `table_column`, hoàn toàn tách khỏi state List View cá nhân (`hiddenTaskListColumnKeys`/`hiddenColumnKeys`) đã gây bug ở bản fix đầu ngày hôm nay. Đồng thời khôi phục logic fallback cho 2 field bắt buộc khi tạo mới — CS: Agent/Category (agent mặc định về chính mình hoặc agent đầu danh sách, category mặc định option đầu, nếu bị admin ẩn) — và bổ sung fallback tương tự cho Enrollment Agent (trước giờ chưa có, phát hiện qua review: nếu không có fallback, admin ẩn cột Agent sẽ khoá cứng nút Create New Enrollment cho cả công ty). **Đóng luôn 1 bất đối xứng khác phát hiện lúc review toàn bộ cơ chế** (không nằm trong bug report gốc): custom column (không phải hệ thống) trước giờ Hidden chỉ ảnh hưởng bảng List, KHÔNG ảnh hưởng Create/Detail — tức đúng dạng bug y hệt PCP2025 nhưng xảy ra ở custom field. `taskDetailColumns`/`detailCustomColumns` (nguồn của "Custom fields" trên Create/Detail) nay cộng thêm `!hidden_default` vào filter sẵn có (`show_in_detail && !is_system && !archived_at`) — Hidden giờ nghĩa thống nhất "ẩn khỏi mọi nơi" cho cả field hệ thống lẫn custom. `show_in_detail`/checkbox "Detail" giữ nguyên vai trò cũ: opt-in riêng cho custom field xem có nên nhập được trên form hay không (ngoài việc hiện cột ở List) — chỉ có ý nghĩa với custom, vẫn vô tác dụng với field hệ thống. Cũng verify riêng: "Archive" (`archived_at`) đã đúng 100% từ trước, không cần sửa gì — cột bị archive không bao giờ được fetch về client (`archived_at is null` ngay ở query DB) nên không thể lọt vào List/Create/Detail dù ở đâu. Thêm: khoá server-side để 1 cột không thể vừa `pinned=true` vừa `hidden_default=true` (trước đây chỉ chặn ở UI, request PATCH thẳng vẫn lách được); disable checkbox "Detail" cho cột hệ thống trong `/config` vì nó chưa từng có tác dụng ở đó.
- **Vì sao**: user test trực tiếp phát hiện PCP2025 đã tick Hidden vẫn hiện ở New Enrollment — đúng là bug do bản fix đầu ngày quá tay. Trước khi code lại, cho 1 agent phản biện đọc kỹ plan này (2 lỗ hổng tìm được: CS thiếu fallback Agent/Category y hệt bug gốc; Enrollment "agent" không được seed trong schema.sql nhưng đã tồn tại thật trên DB qua cơ chế tự-heal `ensureTableColumns()`/`DEFAULT_TABLE_COLUMNS` — nếu không thêm fallback sẽ brick New Enrollment toàn công ty).
- **File**: app/api/config/columns/[id]/route.ts, tasks/_components/TaskBoardClient.tsx, tasks/_components/NewTaskDialog.tsx, tasks/_components/TaskDetailDrawer.tsx, enrollment/_components/EnrollmentClient.tsx, config/_components/ConfigClient.tsx, supabase/schema.sql (thêm seed `agent` cho aca/medicare, không bắt buộc — DB production đã tự heal sẵn)
- **Ảnh hưởng**: `/config` → Table Columns "Hidden" giờ hoạt động đúng nghĩa "ẩn khỏi mọi nơi" cho cả CS lẫn Enrollment, cả field hệ thống lẫn custom (custom vẫn qua `show_in_detail` như cũ). List View cá nhân của từng user (đã fix đúng ở bản trước) không bị ảnh hưởng gì thêm. Không đổi RBAC/schema (trừ 1 dòng seed optional, không cần chạy ngay).
- **Ref**: docs/superpowers/plans/2026-08-04-fix-admin-hidden-field-visibility.md, agent review nội bộ trước khi code
```

- [ ] **Step 7: Commit**

```bash
git add changelog.md
git commit -m "docs(changelog): document the corrected admin Hidden field-visibility fix"
```

---

## Plan Self-Review

**Spec coverage:**
- "PCP2025 vẫn hiện dù đã hidden" (the screenshot) → Task 2/3 restore `hidden_default`-driven gating for system fields in Create + Detail, both CS and Enrollment.
- "cái detailed nó chỉ ăn cho tất cả cột hay chỉ custom cột thôi?" → answered explicitly in Task 2's design note and Task 4: `show_in_detail` only ever applies to custom columns, confirmed by reading both `taskDetailColumns` and `detailCustomColumns`; Task 4 makes the Config UI honest about that instead of leaving a checkbox that lies.
- "nếu cột có trong task rồi mà chọn thêm detailed thì sao" → answered: nothing happens today (dead control) and Task 4 disables the checkbox for system columns so it can't be toggled into a false impression; no duplicate-render risk exists because system fields render only in their fixed slot and custom fields render only in the dynamic loop, and that separation is untouched.
- "review kĩ ... rồi đề xuất logic" → the two-axis model in **Architecture**/**Global Constraints** above.
- "đưa agent review kĩ lại plan" → an adversarial review already ran against the pre-plan-document version of this design and found the two blockers folded into Task 2/3 (CS Agent/Category fallback, Enrollment Agent fallback + schema drift). This document is the corrected version; still worth another review pass given its size before execution.

**Placeholder scan:** none found — every step has literal before/after code, exact file paths, exact commands.

**Type consistency:** `configuredColumnKeys`/`visibleColumnKeys: ReadonlySet<string>` (CS) and `visibleColumnKeys: ReadonlySet<EnrollmentColumnKey>` (Enrollment) match the prop types both components already declared before the earlier over-broad fix removed them — confirmed against the pre-regression file content read during planning, not guessed.
