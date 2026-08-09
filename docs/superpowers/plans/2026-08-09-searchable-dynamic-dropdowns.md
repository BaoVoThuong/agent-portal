# Searchable Dynamic Dropdowns / Combobox Implementation Plan

> **Handoff context for Claude:** This document is intentionally self-contained. Read the
> current source before changing it, execute one task at a time, make one focused commit per
> task, and write the commit ID plus verification result into the Execution Log at the bottom.
> This plan is approved as a plan only; do not infer authorization to change unrelated UI,
> permissions, payloads, schemas, option ordering, or business rules.

## 1. User request and product context

The user reported that selection fields such as Enrollment **Carrier** can contain roughly
100 values. Today the only way to find a value is to open the menu and scroll. The requested
interaction is a searchable dropdown/combobox:

1. Open a dropdown.
2. The search input receives focus immediately.
3. Type part of a label, name, or email.
4. See only matching values.
5. Choose one of the real values from the dropdown.

Typing is for **filtering only**. It must never save arbitrary free-form text into a dropdown
field. A write still occurs only after the user selects an existing option, using the existing
canonical option ID or email.

The screenshot that triggered this plan is ACA Create → Carrier, but ACA, Medicare, and Health
CS are one product. Equivalent dynamic selectors must not use three unrelated search patterns.
The implementation therefore covers selection controls backed by admin-configured values or
people rosters, while deliberately leaving small fixed enums and action menus alone.

## 2. Current repository context

- Plan written against `HEAD 993db8f` (`style(lists): soften identity badges`). Re-read `HEAD`
  before implementation because other agents may have added commits.
- ACA and Medicare share `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`.
  A change to its shared menu components affects both programs.
- Enrollment system option values are already loaded in memory as `EnrollmentOption[]` and are
  grouped in `optionsBySet`. No search API or database change is required for approximately
  100 options.
- `useAnchoredMenu` renders menus through a portal and handles viewport positioning, outside
  click, Escape, scroll, and resize. Preserve this behavior; an inline absolute menu can be
  clipped by the Enrollment drawer/table. The hook currently sets `maxHeight: 300` on the
  portal root and already owns the document-level Escape listener.
- Recent UI work intentionally standardized Create/Detail/List surfaces. Closed controls and
  list badges must keep their current appearance. Search UI appears **inside the open menu**;
  do not turn compact list badges into permanent text inputs.
- Recent badge work made CS Category and Enrollment identity badges pastel. Do not revert or
  bypass `taskCategoryBadgePalette` / `enrollmentIdentityBadgeStyle`.
- Recent permission work disables or hides selectors according to per-record capabilities.
  Searchability must not broaden `canEdit`, `canAssign`, `canTransferAgent`, or row visibility.
- `vitest.config.ts` uses the Node environment and has no component DOM harness. Pure filtering
  logic can and must be unit-tested; focus/portal/keyboard behavior needs typecheck, lint, and
  explicit browser verification.
- Preserve unrelated dirty documentation files and changes from other agents. Stage and commit
  only files owned by the current task.

### 2.1 Claude review resolution (must be reflected during execution)

| Review point | Decision |
|---|---|
| Root `overflow-hidden` without a flex sizing contract clips the list | **Accepted.** Portal root must be `flex flex-col overflow-hidden`; search/pinned rows are `shrink-0`; results wrapper is `min-h-0 flex-1 overflow-y-auto`. Hook `maxHeight: 300` is the one vertical cap. Remove migrated consumers' nested `max-h-56` / `max-h-64` caps. |
| Escape would be handled by both panel and hook | **Accepted.** The panel must not handle Escape. `useAnchoredMenu` remains the single Escape owner and gains explicit focus restoration. |
| Tab from a portal does not naturally reach the field after the trigger | **Accepted.** Panel intercepts Tab only to synchronously close and focus the trigger, does not `preventDefault`, then the browser advances forward/backward from that trigger. |
| Existing portal roots already carry `role="listbox"` | **Accepted.** Every migrated caller removes that role. The neutral portal root contains the combobox input and a separate inner results element with `role="listbox"`. |
| `EditableCustomCell` is a lifecycle rewrite, not a one-line `<select>` replacement | **Accepted.** It is split into a behavior-preserving preparation task and a dedicated integration task with explicit close/commit/error rules and a required changelog entry. |
| Missing selected value after archive | **Accepted.** The panel tolerates `selectedValue` not being present, does not create a synthetic archived choice, and does not auto-clear/save it. Existing parent behavior remains authoritative. |
| Disabled-option keyboard behavior | **Accepted.** Pure active-index helpers skip disabled rows; Enter never selects one. |
| Keyboard-heavy component has no DOM tests | **Accepted.** Initial index, clamping, and next/previous enabled navigation move into pure tested helpers in Task 1. Portal/focus wiring remains a manual browser gate. |
| Move `useAnchoredMenu` into `_shared` | **Not adopted.** Its location is imperfect, but moving it changes imports in nine working consumers for no product benefit. Keep the existing file to honor the pre-go-live minimal-change rule. |
| Existing NFKD code in `table-config/columns.ts` | **Reviewed, not reused directly.** `slugifyColumnKey()` removes email punctuation and emits underscores, so it is the wrong semantic utility for search. `normalizeOptionSearchText()` may use the same NFKD + combining-mark removal technique, adds explicit `đ/Đ` mapping, and becomes the sole normalizer for selectors in this plan. |

## 3. Audit: selectors that exist today

| Area | Current component/path | Data size | Current search | Plan decision |
|---|---|---:|---|---|
| Enrollment Payment/Carrier/AC/Platform | `EnrollmentOptionMenu` | Dynamic; Carrier may exceed 100 | None | Searchable on Create, Detail, and List |
| Enrollment Stage | `EnrollmentStagePill` | Admin-configured; often ~10–20 | None | Searchable on Create, Detail, and List |
| Enrollment Agent/Caller/Responsible | `EnrollmentPersonMenu` | Dynamic roster; may exceed 100 | None | Search by display name and email |
| Enrollment toolbar filters | shared `TaskSelect` | Dynamic; people/carrier may exceed 100 | None | Searchable, preserving multi-select |
| CS Category/Agent in Create/Detail | shared `TaskSelect` | Dynamic | None | Searchable |
| CS Category/Agent inline list cells | `CategoryMenu`, `AgentMenu` | Dynamic | None | Searchable |
| CS Assignee | `TaskAssigneePicker` | Dynamic | **Already searchable** | Keep UI; share normalization only |
| Custom dropdown/person fields | `TaskSelect` in Create; native `<select>` in `EditableCustomCell` | Dynamic | None | Searchable; remove long native select path |
| CS/Enrollment fixed Status/Priority | status/priority controls | Small fixed enum | None | Out of scope |
| Consent | `EnrollmentConsentToggle` | Two values | Not needed | Out of scope; preserve toggle |
| Date, Export, table settings, action menus | Various | Not data value selection | Not applicable | Out of scope |

Important implementation detail: Enrollment Create currently renders only the system fields in
`NewEnrollmentDialog`; Enrollment custom fields are rendered in List/Detail through
`EditableCustomCell`. Do not invent new custom fields in Create as part of this plan.

## 4. UX contract

### 4.1 Closed control

- Keep every current trigger unchanged: full-width field in Create/Detail, colored badge in
  List, and compact filter button in toolbars.
- Clicking the trigger opens the existing anchored portal menu.
- `Enter` or `Space` on a focused trigger opens the menu.
- Disabled/read-only controls stay non-interactive and do not expose a search input.

### 4.2 Open menu

- Put one search row at the top of every dynamic data list.
- Autofocus the search input on open, so the user can click the field and type immediately.
- Use field-specific copy: `Search carrier…`, `Search stage…`, `Search agent or email…`.
- Keep the search row visible while the option list scrolls.
- Keep the menu portal-positioned and bounded to the viewport. `useAnchoredMenu`'s inline
  `maxHeight: 300` is authoritative: portal root = `flex flex-col overflow-hidden`, search and
  pinned rows = `shrink-0`, results region = `min-h-0 flex-1 overflow-y-auto`. Remove local
  `max-h-56` / `max-h-64` and outer `overflow-auto` from each menu as it migrates so there is
  exactly one scrolling region and no stacked height caps.
- An empty query shows the complete list in its existing source order.
- No match shows a non-interactive message such as `No matching carriers.`; it must not show a
  button that creates a new option.
- A query clear button is optional, but if present it must have an accessible label and appear
  only when the query is non-empty.

### 4.3 Matching rules

Create one pure source of truth for matching. Required behavior:

- Case-insensitive.
- Trim and collapse repeated whitespace.
- Accent/diacritic-insensitive, including Vietnamese `đ/Đ`, so `bao` can match `Bảo` and
  `do` can match `Đỗ`.
- Split the query into tokens and require every token to occur somewhere in the searchable
  text. Example: `blue adv` matches `BCBS Blue Advantage`.
- Option fields search the visible option label.
- Person fields search both display name and email.
- Do not search internal UUIDs.
- Preserve the upstream/configured order of matching options; do not silently re-sort option
  sets by relevance or alphabetically.
- No debounce and no network request: filtering ~100 in-memory rows is cheap. Do not add cache,
  server search, virtualization, or `useDeferredValue` without measured evidence.

### 4.4 Selection and clearing

- Single-select: selecting a result writes the existing ID/email, closes the menu, clears the
  query, and restores focus to the trigger.
- Multi-select filter: selecting a result preserves the existing multi-select semantics and
  keeps the menu open; the typed query remains so multiple matching values can be selected.
- Existing `All …`, `Unassigned`, or clear-selection rows stay pinned above filtered results and
  are not hidden by the query.
- Do not add a clear/unassign action to a field that cannot currently be cleared.
- Closing with Escape/outside click discards only the query. It must not alter the selected
  value or call `onChange`/`onSave`.
- Exact typed text is not automatically committed on blur or Enter unless an actual option is
  active and selected.

### 4.5 Keyboard and accessibility

- Search input uses combobox semantics: `role="combobox"`, `aria-autocomplete="list"`,
  `aria-expanded`, `aria-controls`, and `aria-activedescendant` where applicable.
- The outer portal root is a neutral `<div>` with **no** `role="listbox"`. Results use a
  separate inner element with `role="listbox"`; items use `role="option"` and correct
  `aria-selected`. Never place the combobox input inside an element whose role is `listbox`.
- `ArrowDown`/`ArrowUp` moves to the next/previous enabled result, clamps at the first/last
  enabled result, and never moves the text cursor out of the input. Disabled choices remain
  visible but are never active.
- Active result starts at the selected option only when it is present, filtered-in, and enabled;
  otherwise it starts at the first enabled match. If none exists, active index is `-1` and
  `aria-activedescendant` is omitted.
- `Enter` selects only the active enabled result. With zero enabled matches, Enter does nothing.
- Escape ownership is **only** `useAnchoredMenu`'s existing document listener. Extend that
  listener to close and restore focus to `triggerRef`; the panel must not add a second Escape
  handler. Outside-click/scroll/resize close without stealing focus from the user's new target.
- Because the menu is portaled to `document.body`, Tab cannot be left completely passive.
  On `Tab` or `Shift+Tab`, the panel synchronously closes and focuses `triggerRef`, does **not**
  call `preventDefault`, then lets the browser move to the next/previous focusable element from
  the trigger. This is a navigation bridge, not a focus trap.
- Mouse hover updates the active result, and keyboard movement scrolls it into view with
  `block: "nearest"`.
- Opening/typing/clicking a list-cell selector must continue stopping row click/double-click
  propagation so it does not open the detail drawer accidentally.

## 5. Architecture decision

Do not add search state separately to every menu with slightly different matching logic.
Introduce two small shared layers:

1. **Pure search/navigation utility** — normalization, stable filtering, initial active choice,
   clamping, and next/previous enabled navigation, testable in Node.
2. **Shared searchable listbox panel** — the open menu content: search input, empty state,
   active option, keyboard behavior, and result scrolling. It does not own business payloads or
   permission logic.

Parents continue owning their existing trigger and `useAnchoredMenu`, so Create/Detail/List can
keep different closed-control visuals. The shared panel receives normalized option objects and
returns only the selected canonical value.

Suggested interfaces (names may adjust to fit the source, behavior may not):

```ts
type SearchableChoice = {
  value: string;
  label: string;
  keywords?: readonly string[];
  disabled?: boolean;
};

normalizeOptionSearchText(value: string): string;

filterSearchableChoices(
  choices: readonly SearchableChoice[],
  query: string
): SearchableChoice[];

initialEnabledChoiceIndex(
  choices: readonly SearchableChoice[],
  selectedValue?: string
): number; // -1 when no enabled choice exists

moveEnabledChoiceIndex(
  choices: readonly SearchableChoice[],
  currentIndex: number,
  direction: -1 | 1
): number; // skip disabled, clamp at first/last
```

The React panel should support:

- `choices`, `selectedValue`, `queryPlaceholder`, `emptyMessage`;
- optional pinned rows supplied separately from searchable choices;
- single- and multi-select presentation;
- an optional render hook for a color square, avatar, or checkmark without duplicating search
  behavior;
- forwarded `menuRef` and `menuStyle` so it remains compatible with `useAnchoredMenu`;
- explicit `onSelect`, `onCloseAndRestoreFocus`, and `onTabExit` callbacks rather than calling
  a parent's payload logic itself.

The portal DOM contract is:

```text
neutral root div (menuRef + menuStyle; flex flex-col overflow-hidden; NO listbox role)
├─ search row (shrink-0; input role=combobox)
└─ results listbox (min-h-0 flex-1)
   ├─ pinned actions/options (shrink-0)
   └─ filtered results region (min-h-0 flex-1 overflow-y-auto)
```

`useAnchoredMenu` remains in its existing path and gains named close operations rather than
forcing callers to guess between `setIsOpen(false)` and focus restoration:

- Escape and selection: close + restore trigger focus.
- Tab bridge: close + synchronously focus trigger, then allow the browser's default Tab action.
- Outside click, scroll, resize: close without focus restoration.
- Plain trigger toggle-close: close and leave focus on the trigger that was already activated.

The panel must also tolerate `selectedValue` not existing in `choices`. That state occurs when
an option is archived between hydration and interaction. It yields no selected active row and
must not crash, generate an invalid ARIA ID, synthesize an archived option, or call `onSelect`.
Enrollment Create's existing archived-option effect remains responsible for its warning/clear
flow; other parents keep their existing fallback display behavior.

Avoid building a new global design system or replacing `useAnchoredMenu`. Also do not reuse
`SuggestionInput` from Provider Finder directly: that control allows free-form values and is
rendered inline rather than in the anchored portal, which violates this selection-only contract.

## 6. Implementation tasks

### Task 1 — Add and test the pure matching contract

**Files**

- Create: `src/lib/ui/option-search.ts`
- Create: `src/lib/ui/option-search.test.ts`

**Steps**

- [x] Implement normalization for case, whitespace, accents, and `đ/Đ`. Use NFKD plus
  combining-mark removal, but do not call `slugifyColumnKey()` because search must preserve
  meaningful email/name characters rather than converting them to underscores.
- [x] Implement stable all-token filtering over `label + keywords`.
- [x] Implement pure initial-index and next/previous-index helpers. They return `-1` when no
  enabled choice exists, skip disabled choices, and clamp rather than wrap at list boundaries.
- [x] Add tests for empty query, case, substring, multiple tokens, Vietnamese accents,
  name+email keywords, stable ordering, and zero matches.
- [x] Add tests for selected-present, selected-missing, selected-disabled, all-disabled,
  filtered-list clamping, and ArrowUp/ArrowDown skipping disabled choices.
- [x] Confirm no mutation of the original choices array.
- [x] Run targeted Vitest, TypeScript, ESLint, and `git diff --check`.
- [x] Commit only Task 1 and record the commit below.

### Task 2 — Build the shared searchable listbox panel

**Files**

- Create: `src/app/(authed)/_shared/SearchableListboxPanel.tsx`
- Modify: `src/app/(authed)/tasks/_components/use-anchored-menu.ts`

Do **not** move the hook file. The new shared panel may import the existing hook types/path;
avoiding nine mechanical import edits is the smaller pre-go-live change.

**Steps**

- [x] Render the autofocus search row, pinned rows, filtered list, checks, and no-match state.
- [x] Build the exact flex contract from §5: neutral root `flex flex-col overflow-hidden`, fixed
  search/pinned rows, and one `min-h-0 flex-1 overflow-y-auto` results region. Treat the hook's
  inline `maxHeight: 300` as authoritative.
- [x] Consume Task 1's pure active-index helpers when the query/choices change and for
  ArrowUp/ArrowDown. Do not duplicate navigation math in React.
- [x] Implement ArrowUp/ArrowDown/Enter and the Tab focus bridge. The panel does **not** handle
  Escape.
- [x] Extend `useAnchoredMenu` with explicit close/focus operations: document Escape closes and
  restores focus; outside click/scroll/resize close without restoration; Tab can synchronously
  close/focus the trigger without preventing the default browser traversal.
- [x] Preserve the hook's current return fields (`isOpen`, `setIsOpen`, `openMenu`, `toggle`,
  refs, style) so non-migrated consumers do not require a broad refactor. Add named close helpers
  alongside them and use those helpers only where focus semantics require them.
- [x] Add ARIA IDs with `useId`; do not use array indexes as option identity.
- [x] Ensure the portal root has no listbox role; put `role="listbox"` and
  `aria-multiselectable` only on the inner results owner referenced by the combobox input.
- [x] Render disabled choices with `aria-disabled`/native disabled semantics, never make them
  active, and never invoke `onSelect` for them.
- [x] Handle a missing `selectedValue` as an ordinary no-active-selection state.
- [x] Keep the root `ref` compatible with `useAnchoredMenu` outside-click/scroll handling.
- [x] Do not change menu coordinates or introduce a second positioning system.
- [ ] Manually smoke-test Escape/outside-click on one existing non-search menu (for example
  Export or table settings) because the hook focus behavior is shared globally.
- [x] Run TypeScript, targeted ESLint, existing tests, and `git diff --check`.
- [x] Commit only Task 2 and record the commit below.

### Task 3 — Apply search to Enrollment system option menus

**File**

- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

**Steps**

- [x] Replace the option mapping inside `EnrollmentOptionMenu` with the shared panel.
- [x] Remove `role="listbox"` from `EnrollmentOptionMenu`'s current outer portal root and
  remove its nested `max-h-56 overflow-auto`; the shared panel owns the inner listbox and sole
  scroll region.
- [x] Apply it to Payment, Carrier, AC, and Platform across List, Detail, and Create.
- [x] Replace the option mapping inside `EnrollmentStagePill` with the same panel.
- [x] Remove `EnrollmentStagePill`'s current outer `role="listbox"` and `max-h-64 overflow-auto`
  just like `EnrollmentOptionMenu`; the search input must remain outside the inner listbox.
- [x] Preserve each upstream `optionsBySet` order and archived-option behavior. If `optionId`
  is absent from active `options`, render the parent's current fallback, start with no active
  selected result, and do not synthesize, clear, or save an archived value from the panel.
- [x] Preserve the current selected option badge/style and all existing `surface` branches.
- [x] Preserve the terminal/reopen and `canEdit` rules for Stage; this plan changes discovery,
  not workflow permission.
- [x] Verify the `EnrollmentConsentToggle` remains unchanged; only its existing fallback to
  `EnrollmentOptionMenu` becomes searchable.
- [x] Verify selecting still sends the same `*_id` payload and typing alone sends nothing.
- [ ] Test both `?program=aca` and `?program=medicare` in Create, Detail, and List (manual browser gate).
- [x] Run verification and make one Task 3 commit.

### Task 4 — Apply search to Enrollment people and filters

**Files**

- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskSelect.tsx`

**Steps**

- [x] Move `EnrollmentPersonMenu` to the shared panel.
- [x] Remove its current outer `role="listbox"` and `max-h-64 overflow-auto`; use the shared
  inner listbox and single scroll region.
- [x] Search Agent/Caller/Responsible by normalized name and email.
- [x] Preserve the existing sorted roster, missing-current-person fallback, empty labels, and
  required-field behavior.
- [x] Preserve permission-specific candidate sources: `agentsByEmail`, `createAgentsByEmail`,
  and `peopleByEmail` must not be widened or merged.
- [x] Add searchable behavior to `TaskSelect` without breaking single vs multi selection.
- [x] Remove `TaskSelect`'s current `role="listbox"` and outer `overflow-auto` from the portal
  root. The search input is a sibling of the shared inner listbox, never its child.
- [x] Keep `All …` pinned in multi-filter menus and keep multi menus open after selection.
- [x] Enable it for Enrollment Stage/Agent/Caller/Responsible/Carrier toolbar filters.
- [x] Verify the plain-worker default Assignee filter still initializes exactly as before (no initialization logic changed).
- [x] Run verification and make one Task 4 commit.

### Task 5 — Apply the same interaction to Health CS dynamic selectors

**Files**

- Modify: `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskToolbar.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskRowItem.tsx`
- Modify if normalization is shared: `src/app/(authed)/tasks/_components/TaskAssigneePicker.tsx`

**Steps**

- [x] Enable the searchable `TaskSelect` path for dynamic Category and Agent selectors in
  Create/Detail and for dynamic Agent/Assignee/Category toolbar filters.
- [x] Keep fixed Priority and Status controls as simple menus.
- [x] Move inline `CategoryMenu` and `AgentMenu` option lists to the shared panel while keeping
  their current badge/avatar triggers and permission checks.
- [x] Remove the migrated menus' current outer `role="listbox"` and local result height/overflow
  classes; the shared panel owns ARIA and scrolling.
- [x] Keep `AssigneeMenu` / `TaskAssigneePicker` multi-select behavior. It already has a search
  box; reuse the pure normalizer so accented names and email matching follow the same contract.
- [x] Remove `role="listbox"` from `AssigneeMenu`'s outer portal root (it currently wraps the
  picker's search input). Give the existing search input combobox ARIA and its actual results
  container the listbox role/ID without changing selected-first or multi-toggle UI.
- [x] Do not change task assignment membership filtering, selected-first ordering, or the
  relation between Agent and eligible Assignees.
- [ ] Verify CS Create, Detail, List, and filters side by side with Enrollment (manual browser gate).
- [x] Run verification and make one Task 5 commit.

### Task 6 — Make custom-value equality/commit guards testable (no UI change)

**Files**

- Modify: `src/lib/table-config/values.ts`
- Modify: `src/lib/table-config/values.test.ts`
- Modify: `src/app/(authed)/_shared/EditableCustomCell.tsx`

**Steps**

- [x] Move private `normalizedValueEquals()` out of `EditableCustomCell.tsx` into
  `table-config/values.ts` as a named pure export. Do not change its semantics: `""`/`undefined`
  equals next `null`; person emails compare trimmed/lowercased; dropdown IDs compare exactly;
  all other types keep strict equality.
- [x] Add direct tests for unchanged value, empty→null, case-only person email, different
  person, different dropdown ID, and unchanged number/checkbox.
- [x] Import the helper back into `EditableCustomCell` and keep the current native `<select>`,
  `editing`, `onBlur`, `commit()`, and visual behavior exactly unchanged in this commit.
- [x] Run targeted values tests, TypeScript, ESLint, and `git diff --check`.
- [x] Commit this behavior-preserving preparation separately and record the commit.

### Task 7 — Replace `EditableCustomCell` native selection lifecycle

**Files**

- Modify: `src/app/(authed)/_shared/EditableCustomCell.tsx`
- Verify/modify call sites only if their existing props prove insufficient:
  - `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`
  - `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`
  - `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- Modify: `changelog.md`

**Current lifecycle being replaced**

`EditableCustomCell` currently uses one `editing` boolean. For dropdown/person it swaps the
display button for a native `<select autoFocus>`, closes without saving on blur/Escape, and calls
`commit()` only from `onChange`. `commit()` closes first, skips normalized-equal values, clears
the prior error, awaits `onSave`, and sets `saveError` on rejection. The new portal lifecycle
must preserve every one of those semantics; it is not a cosmetic `<select>` substitution.

**Steps**

- [x] Call `useAnchoredMenu()` unconditionally at component top level. Do not call hooks inside
  a `column.type` branch.
- [x] Keep `editing` exclusively for text/number/date/link inputs and their existing blur/Enter/
  Escape behavior. Dropdown/person no longer enter that native-input branch.
- [x] For dropdown/person, make the existing display button the anchored trigger. Opening the
  menu changes no value and clears no server-side data.
- [x] Build canonical choices without changing sources: dropdown `{ value: option.id,
  label: option.label }`; person `{ value: email.toLowerCase(), label: name || email,
  keywords: [email] }`.
- [x] Preserve the current native select's empty `<option>` as a pinned clear row that commits
  `null`. Do not add a clear row to system fields whose current menu cannot clear.
- [x] On a real selection, close with focus restoration, normalize empty to `null`, call Task
  6's equality helper, and invoke `onSave` exactly once only when changed. Clear `saveError`
  before saving and restore it only if the awaited save rejects.
- [x] On query change, no match, Escape, outside click, Tab, scroll, or resize: close/discard
  search state only; never call `onSave`.
- [x] If the current custom option/person is missing from active choices, keep the current
  `formatCustomValue`/map fallback display, start with no selected active row, and do not
  auto-clear or synthesize it.
- [x] Remove the two native `<select>` branches and their `onBlur`; do not remove or alter the
  non-selection input branch.
- [x] Keep row-event propagation guards, `canEdit`, `className`, `inputClassName`, checkbox,
  external-link action, empty label, and `saveError` ring behavior.
- [x] Enable search for New Task custom dropdown/person fields through the already upgraded
  `TaskSelect`; do not invent Enrollment Create custom fields.
- [ ] Verify CS List, CS Detail, Enrollment List, and Enrollment Detail with changed, unchanged,
  cleared, failed-save, missing-current-value, and read-only cases.
- [x] Add a required `changelog.md` entry because selection commit/close semantics are being
  rewired even though the intended business result is unchanged.
- [x] Run verification and make one dedicated Task 7 commit.

### Task 8 — Regression, accessibility, and documentation pass

**Files**

- Modify: this plan's Execution Log.
- Do not add changelog entries for Tasks 1–5 when they remain pure search UI. Task 7's
  `EditableCustomCell` lifecycle entry is mandatory and must already exist before this pass.

**Automated checks**

- [x] `npx vitest run src/lib/ui/option-search.test.ts`
- [x] `npx vitest run`
- [x] `npx tsc --noEmit`
- [x] Targeted ESLint for every touched source/test file.
- [x] `git diff --check`

**Manual browser matrix**

- [ ] ACA Create: Carrier with 100 values; type a middle substring and select.
- [ ] ACA Detail/List: same Carrier change; query alone must not patch.
- [ ] ACA Agent/Caller/Responsible: search by name and email.
- [ ] Medicare Create/Detail/List: Stage, Carrier, Agent/Assignee.
- [ ] Enrollment filters: multi-select two matches without the menu closing.
- [ ] CS Create/Detail/List: Category and Agent searchable, current visuals unchanged.
- [ ] CS Assignee: existing multi-select search still works and matches accented names.
- [ ] Custom dropdown/person: CS and Enrollment List/Detail use canonical ID/email.
- [ ] Keyboard-only: open, type, arrows, Enter, Escape, Tab, focus restoration.
- [ ] Zero matches, empty options, one option, duplicate labels, long labels, archived option
  refresh, selected value missing from choices, disabled/all-disabled choices, read-only record,
  and narrow viewport.
- [ ] With enough results to exceed 300px, search/pinned rows remain visible and exactly the
  results region scrolls; no list is clipped and no nested scrollbar appears.
- [ ] Open a selector inside a table row and confirm search interaction does not open the drawer.
- [ ] Slow CPU / rapid typing: no visible selected-value flicker and no value reset.

## 7. Regression boundaries

- No schema, migration, API route, or request/response contract changes.
- No free-form dropdown values.
- No new permission or visibility rules.
- No change to ACA vs Medicare field availability.
- No change to configured option order, stage terminal/QC metadata, or archived-option handling.
- No change to single-person Enrollment cardinality or multi-person CS Assignee cardinality.
- No change to optimistic update, rollback, required-field, or save-error behavior.
- No change to pastel badges, closed controls, menu anchoring, or row navigation.
- No server request on keystroke.
- No virtualization for ~100 values unless profiling proves it necessary.

## 8. Acceptance criteria

- A user can open Carrier, type a partial label, and select a matching configured value without
  scrolling through the entire list.
- People selectors match both display name and email, case/accent-insensitively.
- Only an existing option ID/email can be saved.
- Typing, clearing the query, Escape, outside click, and zero matches never mutate the record.
- Search works consistently in ACA and Medicare and in equivalent Health CS dynamic selectors.
- Single-select, multi-select, empty/unassigned, required, read-only, and permission behavior are
  unchanged apart from the added search affordance.
- Keyboard and screen-reader semantics satisfy the contract in §4.5.
- A missing selected value and disabled choices never crash, auto-save, or produce an invalid
  active descendant; keyboard navigation skips disabled rows.
- Long menus obey the hook's 300px cap with one working results scrollbar.
- Automated checks pass and every task has its own commit recorded below.

## 9. Execution Log

| Task | Status | Commit | Verification | Notes |
|---|---|---|---|---|
| 1. Pure matching contract | Completed | `4724042` | 8 tests; ESLint; `tsc --noEmit`; `git diff --check` | Pure search + enabled navigation helpers |
| 2. Shared searchable listbox panel | Completed | `2be5cdb` | 8 tests; targeted ESLint; `tsc --noEmit`; `git diff --check` | Shared panel + focus-aware anchored-menu close helpers; manual browser smoke test remains pending |
| 3. Enrollment option menus | Completed | `49ec83d` | Targeted ESLint; `tsc --noEmit`; `git diff --check` | Payment/Carrier/ACA/Platform + Stage use shared searchable panel; manual ACA/Medicare browser matrix remains pending |
| 4. Enrollment people and filters | Completed | `2a76381` | Targeted ESLint; `tsc --noEmit`; `git diff --check` | People menus + searchable TaskSelect with pinned All/multi behavior; manual worker/default-filter and keyboard browser gate remains pending |
| 5. Health CS dynamic selectors | Completed | `7fca96c` | Targeted ESLint; `tsc --noEmit`; `git diff --check` | CS Category/Agent + dynamic TaskSelect + Assignee ARIA/normalization; manual side-by-side browser gate remains pending |
| 6. Custom-value equality preparation | Completed | `4acfca4` | Values + option-search tests 15/15; targeted ESLint; `tsc --noEmit`; `git diff --check` | Named equality helper exported; native custom-cell UI unchanged |
| 7. Custom dropdown/person lifecycle | Completed | `f45954e` | Values + option-search tests 15/15; targeted ESLint; `tsc --noEmit`; `git diff --check` | Portal searchable custom fields + clear/equality/save-error semantics; manual CS/Enrollment browser matrix remains pending; changelog entry added |
| 8. Final regression/a11y pass | Completed | `PENDING-DOC-COMMIT` | 65 test files / 508 tests passed; `tsc --noEmit`; targeted ESLint; `git diff --check`; `npm run build` | Automated regression clean. Manual browser/a11y matrix is still pending because no browser automation is available in this environment. |

## 10. Final handoff note for Claude

The core production risk is not the filtering algorithm; it is accidentally turning a
selection-only field into free-form input, firing a patch while the user types, losing existing
permission/candidate scoping, or breaking portal focus and row click behavior. Keep search state
ephemeral and local to the open menu. The selected ID/email remains the only source of truth.
