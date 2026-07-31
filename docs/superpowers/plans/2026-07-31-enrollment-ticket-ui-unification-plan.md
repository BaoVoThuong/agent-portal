# Enrollment Ticket UI Unification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ACA and Medicare enrollment create/detail feel like the Health Customer Service (CS) ticket UI: main ticket content on the left (`Ticket`, `FUB Link`, `Description`), all selectable metadata on the right, compact readable values instead of always-visible form controls.

> **Revision note (2026-07-31, post senior review):** The first draft of this plan was written against an assumed "raw form" current state and expanded to 8 tasks. A code audit found that the **detail drawer is already ~95% of the target UI** and that enrollment **already ships its own CS-grade anchored-menu controls**. The plan below is the corrected, slimmed version. See **"Verified current state"** for what actually exists so we don't re-build it.

## Verified current state (audited, do not re-do)

The detail drawer `EnrollmentDrawer` (`EnrollmentClient.tsx:1816`) **already implements** almost the entire target detail UI:

- Two-column ticket layout: main content + `280px` sidebar (`EnrollmentClient.tsx:1910`).
- Header: `ENR-xxxx` key + colored stage pill + close.
- Sidebar groups already match the desired grouping: **Pipeline / Plan (& payment) / Ownership / PCP / QC / Audit**.
- Compact custom controls already in use (no native selects here):
  - `EnrollmentStagePill` (`:1705`) — colored stage pill.
  - `EnrollmentOptionMenu` (`:1502`) — bounded, portal-anchored, colored option chip.
  - `EnrollmentConsentToggle` (`:1449`) — **consent is already a compact boolean toggle**, not noisy text.
  - `EnrollmentPersonMenu` (`:1575`) — avatar (`Initials`) + name, dashed **"Assign" / "Unassigned"** empty state, sorted by display name, `createPortal` + `useAnchoredMenu` + `max-h-64 overflow-auto`.
- `EditableInput` for `client_name`, `fub_link` (with open-link button), and PCP fields.
- Tabs: Comments / Activity / Files (reusing CS `CommentThread`, `ActivityFeed`, `AttachmentPanel`).
- Audit block: "Created by … / Updated by … + `RelativeTime`" (`EnrollmentClient.tsx:2130`), so no hydration issues.

**The real gaps are all on the create side and in one shared control:**

- `description` is genuinely **absent end-to-end** — not in `types.ts`, `queries.ts`, either API route, the create dialog, or the drawer.
- The **create dialog** `NewEnrollmentDialog` (`EnrollmentClient.tsx:2169`) is a flat 2-column grid of `FormInput`/`FormSelect`. `FormSelect` (`:2752`) renders a **native `<select>`** — this is the only place native dropdowns still exist, and the cause of the giant-Caller-dropdown overflow.
- Duplicate people names (e.g. two `Ann Strambler`) are **distinct active accounts sharing a display name**, not a dedupe/inactive bug:
  - `fetchEnrollmentPeople` (`queries.ts:88`) already filters `.eq("is_active", true)`.
  - `EnrollmentPersonMenu` is keyed by email (a `Map`), so it is already deduped by email.
  - Therefore "dedupe by email" and "hide inactive" (both already done) will **not** fix the complaint. The fix is a **secondary email label when two display names collide**. Note `EnrollmentPerson` (`types.ts:100`) exposes only `email`, `name`, `agent_id` — **no role** — so disambiguate with **email**, not role.

## Locked decisions (from senior review)

1. **`client_name` stays; relabel in UI only.** The create dialog and drawer show the field as **`Ticket`** but keep mapping to the existing `client_name` column. **No schema rename** of `client_name` → `title`. This removes the "should we rename the domain field" question entirely.
2. **`EnrollmentPersonMenu` is edited in place, shared across table + create + detail.** Adding email disambiguation will also change the table's inline person menu, and that is **accepted** — so we do not fork a second person control. This is an explicit, approved exception to "don't touch the table."

## Architecture

Keep enrollment feature boundaries. The **source of truth to copy for the create dialog is enrollment's own detail drawer**, not the CS `/tasks` components — enrollment already mirrors CS internally (it imports `TaskSelect`, `CommentThread`, `ActivityFeed`, `AttachmentPanel`, `Initials`, `useAnchoredMenu`). Reuse the existing enrollment atoms; do not introduce new CS coupling or a new abstraction layer.

**Tech Stack:** Next.js client components, TypeScript, Supabase schema/API routes, existing enrollment comments/activity/files endpoints.

## Global Constraints

- Do not change the approved list/table layout **except** the shared `EnrollmentPersonMenu` disambiguation in decision #2.
- ACA and Medicare share one layout shell but keep separate program-specific metadata and option sets.
- Preserve comments, activity, attachments, option sets, stage/QC behavior, notifications, realtime, and program-specific option-set separation.
- Reuse existing enrollment atoms (`EnrollmentPersonMenu`, `EnrollmentOptionMenu`, `EnrollmentStagePill`, `EnrollmentConsentToggle`, `EditableInput`). Do **not** copy/adapt CS `TaskSelect`/`TaskAssigneePicker` for this — the enrollment equivalents already exist and match.
- `client_name` is relabeled to `Ticket` in UI only — no schema/domain rename.
- Build, typecheck, lint, and tests must pass before this is complete.

---

## Task 1: Add enrollment `description` support end-to-end

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `src/lib/enrollment/types.ts`
- Modify: `src/lib/enrollment/queries.ts`
- Modify: `src/app/api/enrollment/route.ts`
- Modify: `src/app/api/enrollment/[id]/route.ts`
- Review: `src/app/api/enrollment/[id]/detail/route.ts`
- Review any seed/sample scripts that insert `enrollment_records`

**Implementation notes:**
- Add nullable `description text` to `enrollment_records`.
- Idempotent migration line: `alter table enrollment_records add column if not exists description text;`
- Include `description` in list/detail select payloads.
- Allow create and patch APIs to read/write `description` (add it to the string-cleaning path used for other text fields).
- Keep current create validation: a record still requires `client_name` or `fub_link`. Ticket title is **not** made required.
- Existing rows keep `description = null`.

- [ ] Add DB column + idempotent migration line.
- [ ] Update `EnrollmentRecord` types to include `description`.
- [ ] Update enrollment query select strings (list + detail).
- [ ] Update create API string cleaning to accept `description`.
- [ ] Update patch API string cleaning to accept `description`.
- [ ] Update any seed/sample data path so new records can carry `description`.

**Acceptance criteria:**
- Creating ACA/Medicare enrollment can submit `description`.
- Opening an existing record with `description = null` does not crash.
- Patching `description` persists and reloads.

---

## Task 2: Rebuild the create dialog into the ticket layout

**Primary file:** `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` (`NewEnrollmentDialog:2169`)
**Copy the patterns from:** the existing `EnrollmentDrawer` in the same file (not CS components).

**Target layout:**
- Header: `New enrollment` + short helper text (CS tone).
- Top full-width field: **`Ticket`** — label reads `Ticket`, still maps to `client_name`, placeholder reads like a work item.
- Main grid:
  - **Left ticket content:** `Description` textarea, `FUB Link` compact input.
  - **Right properties panel:** `Properties` heading + program chip (`ACA` / `Medicare`), metadata fields only.
- Footer: match existing cancel/create layout and disabled state.

**ACA right-side properties:** Stage, Caller, Responsible Enroll, Due Date, Payment, Carrier, ACA, Consent, Platform, PCP 2025, PCP 2026.
**Medicare right-side properties:** Stage, Assignee (a.k.a. Responsible Enroll), Due Date, Carrier, PCP.

- [ ] Replace the flat 2-column grid with the ticket layout (left content / right properties).
- [ ] Relabel `Client name` → `Ticket`; keep the payload key `client_name`.
- [ ] Move `FUB Link` into the left ticket content.
- [ ] Add `Description` textarea wired to the create payload.
- [ ] Replace **every** `FormSelect` with the existing enrollment atoms:
  - People (Caller, Responsible/Assignee) → `EnrollmentPersonMenu`.
  - Options (Stage, Payment, Carrier, ACA, Platform) → `EnrollmentStagePill` / `EnrollmentOptionMenu` as appropriate.
  - Consent → `EnrollmentConsentToggle` (match the drawer; don't leave it a dropdown).
- [ ] Keep the default-stage seed on open (`stage_id: optionsBySet.stage[0]?.id`, currently `:2189`).
- [ ] Keep the Medicare payload strip in `submit()` (`:2215`) — `caller_email`, `payment_status_id`, `aca_status_id`, `consent_id`, `platform_id`, `pcp_2026`.
- [ ] First focus goes to `Ticket`.
- [ ] Verify the disabled create state still works.
- [ ] Remove `FormSelect` (and `FormInput` if now unused) once nothing references them.

**Acceptance criteria:**
- ACA and Medicare create modals use the ticket layout: left = Ticket / FUB / Description only; right = all metadata.
- **No native `<select>` remains in create** — every menu is bounded, scrollable, styled, and matches the drawer/table.
- Opening `Caller` no longer bursts a full-viewport native dropdown.
- No awkward empty grid cells when switching ACA vs Medicare.
- Consent renders as the compact toggle, same as the drawer.

---

## Task 3: Add `Description` to the drawer + disambiguate the person menu

**Primary file:** `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

The drawer already matches the target detail UI (see "Verified current state"). Only two changes remain:

- [ ] **Description in drawer:** add an editable `Description` field to the left ticket content (`EditableInput`/textarea, wired to `onPatch({ description })`), placed with `Ticket` and `FUB Link` above the tabs.
- [ ] **Person disambiguation in `EnrollmentPersonMenu` (`:1575`):** when two entries share the same display name, append a secondary **email** line/suffix so they're distinguishable. Applies to the selected-button label and the menu options. This intentionally also improves the table view (decision #2).
  - [ ] Compute name collisions from the `peopleByEmail` map.
  - [ ] Only show the secondary email where a collision exists (keep single-name rows clean).
  - [ ] Long labels/emails truncate inside the control; do not widen the modal or row.

**Acceptance criteria:**
- Drawer has an editable Description that persists and reloads; records with no description show the empty placeholder, not a crash.
- In create, detail, and table, colliding display names now show email; unique names stay clean.
- No native dropdown, no clipped/overflowing menu anywhere in create or detail.

---

## Task 4: Preserve program-specific business rules

- [ ] ACA and Medicare still have separate option sets, scoped by program.
- [ ] Medicare create/update never persists ACA-only fields: `caller_email`, `payment_status_id`, `aca_status_id`, `consent_id`, `platform_id`, `pcp_2026`.
- [ ] ACA still supports Caller, Responsible Enroll, Payment, Carrier, ACA, Consent, Platform, PCP 2025/2026.
- [ ] Stage behavior unchanged: default/fallback stage on create, terminal stages closing records, QC trigger, reopen flow.
- [ ] Notifications and realtime updates still fire after create/update.

**Acceptance criteria:**
- Switching `/enrollment?program=aca` ↔ `/enrollment?program=medicare` does not leak fields or option sets.
- Existing records remain readable.

---

## Task 5: Full verification checklist

**Automated:**
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test:run`
- [ ] `npm run build`

**Manual browser checks:**
- [ ] `/tasks` create + detail (CS reference).
- [ ] `/enrollment?program=aca` create modal — ticket layout, every dropdown bounded/scrollable.
- [ ] `/enrollment?program=medicare` create modal — no ACA-only fields, no empty grid cells.
- [ ] Person dropdowns: colliding names show email; unique names don't.
- [ ] ACA + Medicare detail modal with comments/activity/files; every editable sidebar field opens a bounded, non-clipped menu.
- [ ] Existing record with no `description`; new record with `description`.
- [ ] Narrow viewport: modal scrolls, footer/actions not clipped. Desktop: no wide dead space, labels don't truncate awkwardly.

**Regression checks:**
- [ ] ACA option sets edit ACA only; Medicare option sets edit Medicare only.
- [ ] Enrollment list column settings still work.
- [ ] No hydration warning from relative time / browser-only rendering.
- [ ] `FormSelect`/`FormInput` fully removed if unreferenced (no dead code, no lint warnings).

---

## Rollout

- [ ] Implement in small commits:
  1. Schema/types/API for `description`.
  2. Create dialog rebuild (ticket layout + reuse enrollment atoms + Description).
  3. Drawer Description + `EnrollmentPersonMenu` disambiguation.
  4. Cleanup/tests.
- [ ] Run the full verification checklist locally.
- [ ] Push to GitHub `main` only after user approval.
- [ ] Push/deploy to the Vercel-connected repo only after build is green **and** the user explicitly asks for deployment.
