# Enrollment & Task UI Standardization Plan

## Status

- Status: PLANNED — NOT STARTED
- Baseline module: Health Customer Service (`/tasks`)
- Target modules: ACA Enrollment and Medicare Enrollment
- Surfaces: Create, List, Detail/View
- Source code modified: No
- Last updated: 2026-08-09

## 1. Request Context

Health Customer Service is the UI baseline for task creation and task viewing. ACA Enrollment and Medicare Enrollment must display equivalent data types with the same visual and interaction pattern unless a different business rule requires different behavior.

The immediate mismatch is the person-assignment UI:

- Health CS displays `Agent` as a full-width select control.
- Health CS displays `Assignee` using an assignee picker with avatar/search behavior.
- Enrollment Create currently displays `Agent` and `Responsible Enroll` using a dashed `Assign` action inside another bordered field.
- Enrollment Create and Enrollment Detail do not present the same person data type consistently.

A second confirmed mismatch is the list presentation for categorical/single-option values:

- Health CS `Category` uses a compact, high-contrast filled badge with consistent height, typography, padding, and color identity.
- Enrollment option fields such as `Carrier`, `ACA status`, and `Payment status` use visually weaker pale chips with inconsistent emphasis compared with Health CS.
- This is a data-type consistency issue, not only a `Category` field issue. Equivalent single-option values in Enrollment should follow the Health CS category badge language in List view.

ACA and Medicare share the main Enrollment implementation. A safe shared change should therefore cover both programs, while program-specific fields and business rules remain separate.

## 2. Objective

Standardize Create, List, and Detail/View UI by data type across Health CS, ACA Enrollment, and Medicare Enrollment.

The finished UI must:

- Feel like one application.
- Use Health CS controls as the visual baseline.
- Render the same data type consistently on equivalent surfaces.
- Preserve existing API payloads, database fields, permissions, validation, and business rules.
- Preserve single-person versus multi-person semantics.
- Avoid double borders, nested controls, misleading required states, and inconsistent empty states.

## 3. Baseline Implementations

### Health CS

- Create dialog: `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`
- Detail drawer: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`
- List row: `src/app/(authed)/tasks/_components/TaskRowItem.tsx`
- Single select: `src/app/(authed)/tasks/_components/TaskSelect.tsx`
- Multi-person assignee: `src/app/(authed)/tasks/_components/TaskAssigneePicker.tsx`

### ACA and Medicare Enrollment

- Shared Create, List, and Detail implementation: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

## 4. Important Business Constraints

Visual consistency does not mean changing the meaning of a field.

- CS `Agent` is a single-person field.
- CS `Assignee` may contain multiple people.
- Enrollment `Agent`, `Caller`, and `Responsible Enroll` currently store a single person/email.
- Enrollment single-person fields must not be converted into multi-person fields only to reuse the CS assignee component.
- ACA and Medicare may use different labels or required rules for program-specific fields.
- Required state must come from actual validation/configuration, not from visual assumptions.
- Read-only users must not receive an interactive-looking editable control.

## 5. UI Mapping by Data Type

| Data type | Create / Detail baseline | List baseline | Notes |
|---|---|---|---|
| Short text | Standard bordered input | Text with safe truncation | Preserve inline editing where allowed |
| Long text | Standard textarea | Preview or truncated text | Full value remains available in Detail |
| Single option / category | Full-width select | Compact, filled, high-contrast category badge/menu based on Health CS | Used for Category, Carrier, program status, Payment status, Platform, and other configured options |
| Status / Stage | Full-width field control | Colored status pill | Preserve domain-specific values and colors |
| Priority | CS priority selector | Priority icon/text | Preserve existing priority semantics |
| Single person | Full-width person select with selected identity | Avatar/initials plus name | Agent, Caller, Responsible Enroll |
| Multiple people | CS assignee picker with search/avatar stack | Avatar stack | Keep only for genuinely multi-value fields |
| Boolean | Standard checkbox or toggle | Checkbox/read-only indicator | Consent, QC, and configured boolean columns |
| URL | URL input with existing validation | Open-link action | Do not navigate when the user is editing |
| Date | Standard date control | Consistent formatted date | Preserve timezone/date-only behavior |
| Empty value | Data-type-specific placeholder | Neutral empty display | Do not show a fake selected value |

## 6. Scope Matrix

| Module | Create | List | Detail/View |
|---|---|---|---|
| Health CS | Baseline audit only | Baseline audit only | Baseline audit only |
| ACA Enrollment | Standardize against CS by data type | Compare compact cell patterns | Standardize against CS by data type |
| Medicare Enrollment | Standardize against CS by data type | Compare compact cell patterns | Standardize against CS by data type |

## 7. Execution Plan

### Phase 1 — Complete the Field Inventory

For every visible field in the three modules, record:

- Field name and program.
- Data type.
- Create component.
- List component.
- Detail/View component.
- Single-value or multi-value behavior.
- Required or optional behavior.
- Editable or read-only permissions.
- Current mismatch against the Health CS baseline.
- Proposed shared or existing component.

Deliverable: a confirmed implementation matrix before source changes begin.

### Phase 2 — Standardize Enrollment Create

Start with the confirmed person-field mismatch:

- Replace the nested/dashed `Assign` presentation for Enrollment single-person fields.
- Render `Agent`, `Caller`, and `Responsible Enroll` as full-width controls matching the CS visual language.
- Use the correct option source for each field.
- Preserve current-user defaults and existing required validation.
- Avoid changing the enrollment request payload or data model.

Then fix other Create data-type mismatches confirmed by Phase 1, one independent issue at a time.

### Phase 3 — Standardize Enrollment Detail/View

- Match Create and Health CS presentation for equivalent editable data types.
- Use a correct read-only presentation when edit permission is absent.
- Preserve current inline update behavior and rollback/error handling.
- Ensure selected values hydrate correctly when opening existing records.
- Ensure ACA and Medicare program-specific labels remain correct.

### Phase 4 — Standardize List Display

- Keep list controls compact rather than rendering full form controls.
- Use avatar/initials plus name for person fields.
- Use the Health CS `Category` badge as the baseline for categorical/single-option fields.
- Apply consistent badge height, radius, horizontal padding, font weight, casing, chevron alignment, and selected-option color identity.
- Prefer a configured/stored option color when one exists; otherwise use the existing stable application color mapping rather than assigning a color that can change between renders.
- Keep semantic status colors meaningful while aligning their size and typography with the same badge system.
- Keep checkbox and link behavior consistent.
- Verify truncation, tooltips, horizontal layout, and large-table performance.

#### Confirmed list mismatch: categorical badges

The comparison target is the Health CS `Category` cell shown in the reference screenshot. Enrollment fields of the same data type must not retain the current pale, loosely styled chip presentation merely because their business labels differ.

Expected List behavior:

- The value is immediately scannable like a Health CS category.
- The badge has sufficient foreground/background contrast.
- Badge dimensions and typography are consistent across option columns.
- Long labels truncate safely without expanding the row height.
- The dropdown chevron remains aligned and does not dominate the label.
- Editable and read-only badges share the same visual presentation; only interaction changes.
- Empty values use a neutral compact state and are not assigned a misleading category color.

### Phase 5 — Cross-Surface Consistency Review

Compare the final result by data type:

- Create versus Detail/View.
- Detail/View versus List.
- ACA versus Medicare.
- Enrollment versus Health CS.

Any remaining difference must have a clear business or surface-specific reason.

### Phase 6 — Verification

Verify at minimum:

- ACA Create, List, and Detail/View.
- Medicare Create, List, and Detail/View.
- Health CS Create, List, and Detail/View regression.
- Required and optional person fields.
- Empty values and existing saved values.
- Current-user defaults.
- Single-person and multi-person behavior.
- Search and option selection.
- Permission/read-only behavior.
- Loading, empty, and error states.
- Dropdown positioning, overflow, keyboard navigation, and responsive layout.
- Create/update payloads remain unchanged.

Run the repository's relevant lint, unit/integration tests, type checks, and production build. Do not record a command as passed unless it was actually run successfully.

## 8. Commit Strategy

Each confirmed independent UI defect will be fixed and committed separately.

Planned commit groups, subject to the Phase 1 audit:

1. Enrollment Create single-person control consistency.
2. Enrollment Detail/View single-person control consistency.
3. Enrollment List categorical/single-option badge consistency.
4. Enrollment List person display consistency, only if a real mismatch remains.
5. Each additional confirmed data-type mismatch as its own source commit.
6. Review log update in `docs/codex_review_code.md` as a separate documentation commit.

Every review-log entry must include:

- Issue and affected surfaces.
- Root cause.
- Exact change made.
- Regression risk.
- Verification performed.
- Source commit ID.
- Documentation commit ID when available.

Existing unrelated or Claude-authored uncommitted documentation changes must not be included in these commits.

## 9. Regression Risks

- Accidentally converting a single-person Enrollment field into a multi-person field.
- Showing all users where only agents are valid.
- Removing the current-user default for Caller.
- Allowing a required field to be cleared.
- Making a read-only field appear editable.
- Changing API values while only intending to change presentation.
- Introducing a double border through nested field wrappers.
- Breaking dropdown layering or scroll behavior inside the modal/drawer.
- Re-rendering large Enrollment tables unnecessarily.
- Applying an ACA-only label or validation rule to Medicare, or vice versa.

## 10. Acceptance Criteria

The work is complete only when:

- Equivalent data types use the same visual language across all three modules.
- Enrollment Create no longer shows the inconsistent nested dashed `Assign` UI for single-person fields.
- Enrollment Create and Detail/View render the same single-person data type consistently.
- Enrollment categorical/single-option List fields use the Health CS category badge language instead of the current pale inconsistent chip presentation.
- List presentation remains compact and appropriate for table density.
- ACA and Medicare both behave correctly through their shared implementation.
- Single-person and multi-person fields retain their original cardinality.
- Required, validation, default values, permissions, and API payloads remain correct.
- Relevant automated verification passes.
- Every implemented fix has an isolated commit and is recorded in `docs/codex_review_code.md`.

## 11. Implementation Log

The first confirmed option-field surface mismatch has been implemented. The
remaining items below stay pending until their respective UI surfaces are
audited and fixed in isolated commits.

| Item | Status | Source commit | Verification | Notes |
|---|---|---|---|---|
| Field inventory and implementation matrix | Pending | — | — | Must complete before source edits |
| Enrollment Create person controls | Pending | — | — | ACA and Medicare shared path |
| Enrollment Detail/View person controls | Pending | — | — | Preserve permissions and inline updates |
| Enrollment List categorical/single-option badges | Confirmed, pending | — | — | Health CS Category is the visual baseline |
| Enrollment List person display | Pending audit | — | — | Change only if a confirmed mismatch remains |
| Enrollment option-field surface (Create/List/Detail) | Completed | `6b7ca86`, `3500586`, `ed5bf0c` | `npx tsc --noEmit`; targeted ESLint; `npx vitest run`; `git diff --check` | Removed nested Create badges, restored CS-style chevrons/menu spacing, kept list badges/detail controls surface-specific, changed Create placeholders from `No ...` to `Select ...`, and removed the redundant Create program badge |
| Other data-type consistency fixes | Pending audit | — | — | One independent issue per commit |
| Cross-module regression verification | Pending | — | — | ACA, Medicare, and Health CS |
| Go-Live review log update | Pending | — | — | Separate documentation commit |
