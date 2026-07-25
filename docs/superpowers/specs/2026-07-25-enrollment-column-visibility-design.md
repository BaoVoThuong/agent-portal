# Enrollment — Column Show/Hide — Design Spec

**Status:** Approved (design), pending spec review
**Date:** 2026-07-25
**Author:** Bao Vo + Claude
**Related:** [2026-07-20-health-enrollment-design.md](2026-07-20-health-enrollment-design.md) — the table this feature extends. No schema changes; see §3 for why.

---

## 1. Goal

Let each user hide/show individual columns in the Enrollment list table (`EnrollmentClient.tsx`), for **both** the ACA and Medicare tabs independently, without touching the database — this is a per-browser display preference, not shared record data.

## 2. Non-goals

- Column reordering (drag-and-drop) — not requested, adds complexity for no stated need.
- Named/saved column presets ("views") — YAGNI; one active set of hidden columns per program is enough.
- Cross-device sync of the preference — explicitly rejected in favor of zero DB footprint (see §3).
- Changing which columns Medicare structurally lacks (Payment/Consent/Platform/AC/PCP 2026 stay absent for Medicare regardless of this feature — that's a data-model difference, not a display toggle).

## 3. Why no DB change

The column set is already computed client-side by `enrollmentColumnsForProgram(program)` in `EnrollmentClient.tsx` (`ACA_ENROLLMENT_COLUMNS` filtered/relabeled for Medicare), and each row (`EnrollmentRow`) already renders conditionally per column via `has(key)` — this mechanism exists today to hide Medicare's inapplicable columns. Adding a user-driven hide/show is the same mechanism with one more filter applied before `columns` is passed down. Since the preference is purely "what does *this user's browser* choose to display," it belongs in `localStorage`, not a new table + API route + migration.

## 4. Storage

- Key: `enrollment.columns.aca` / `enrollment.columns.medicare` (per-program, since their column sets differ).
- Value: JSON array of hidden column keys, e.g. `["caller","createdBy"]`.
- Missing/invalid key → treated as empty array (nothing hidden) — matches today's behavior exactly, so existing users see no change until they opt in.
- Read/write via a small hook, e.g. `useHiddenColumns(program: EnrollmentProgram)`, returning `[hiddenKeys, toggleColumn]`. Writes go straight to `localStorage` on every toggle (no debounce needed — infrequent, cheap).

## 5. Which columns are toggleable

- **Never toggleable (always rendered):** `key`, `client`, `qc` — the three columns already flagged `sticky` in `EnrollmentColumn`. Hiding a sticky column would break the sticky-offset math (`stickyOffset()`) and remove the row's primary identifiers.
- **Toggleable:** every other column currently applicable to that program. The toggle list itself is built from `enrollmentColumnsForProgram(program)`, so it automatically excludes columns Medicare doesn't have (Payment, ACA status, Consent, Platform, PCP 2026) — no separate Medicare-specific toggle config needed.

## 6. Rendering change

In `EnrollmentClient.tsx`, where `columns = useMemo(() => enrollmentColumnsForProgram(program), [program])` is computed today (~line 914), derive a second value:

```ts
const visibleColumns = useMemo(
  () => columns.filter((c) => c.sticky || !hiddenKeys.has(c.key)),
  [columns, hiddenKeys]
);
```

`visibleColumns` replaces `columns` in the two places it's currently passed down: the header `.map()` (~line 930) and the `<EnrollmentRow columns={...} />` prop (~line 959). No changes needed inside `EnrollmentRow` — its existing `has(key)` per-cell checks already handle a shorter `columns` array correctly (that's how Medicare's trimmed set already works).

## 7. UI

- New "Columns" button in `EnrollmentToolbar` (~line 727, next to the existing `Overdue` toggle button, before the `ml-auto` record count). Icon: `Columns3` or `SlidersHorizontal` from `lucide-react` (already a project dependency).
- Click opens a small popover/dropdown (reuse the existing popover pattern used by `TaskSelect` multi-select filters in the same file, for visual consistency) listing every toggleable column for the current program, each with a checkbox reflecting `!hiddenKeys.has(key)`. Toggling a checkbox calls `toggleColumn(key)` immediately — no "Apply" button, no confirmation.
- Sticky columns are not listed (nothing to toggle).
- Switching tabs (ACA ↔ Medicare) re-reads the other program's own `hiddenKeys` — the two programs' visibility choices are independent, matching the two separate localStorage keys.

## 8. Edge cases

- **Empty state:** if a user hides every toggleable column, sticky columns (`Key`, `Client Name`, `QC`) still render — table is never fully empty.
- **`localStorage` unavailable** (private browsing edge cases, SSR): hook falls back to "nothing hidden" (today's behavior), fails silently — this is a display nicety, not a critical path.
- **New columns added later:** a column absent from a user's stored hidden-list is visible by default (array only stores hidden keys, not a full visible/hidden map), so future columns show up automatically without a migration of stored prefs.

## 9. File touches

- `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` — add `useHiddenColumns` hook (colocated or in a new small file `src/lib/enrollment/column-visibility.ts` if it grows beyond a few lines), compute `visibleColumns`, add the Columns button + popover to `EnrollmentToolbar`.
- No API routes, no `supabase/schema.sql` changes, no new types beyond the hook's own.
