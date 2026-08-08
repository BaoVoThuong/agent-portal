# Enrollment & Task UI Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Enrollment (ACA + Medicare) Create/Detail/List render person and single-option data types with the same visual language as Health CS, without changing payloads, permissions, cardinality, or business rules.

**Architecture:** Enrollment already has the right component split — `EnrollmentPersonMenu` / `EnrollmentOptionMenu` each render two variants selected by a boolean `field` prop, and `CreatePropertyField` supplies the border chrome in Create. The mismatch is **not** a missing component; it is that `EnrollmentPersonMenu`'s `field={false}` empty state renders a *bordered dashed "Assign" pill* designed for the borderless List surface, and that branch is also what Create shows. The fix replaces the boolean with an explicit 3-value surface prop so each surface gets the affordance it should have, and extracts the badge-emphasis decision into one tested helper.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Vitest (node environment — see "Testing reality" below).

## Global Constraints

- Source of truth for this plan: `HEAD = 8d08351`, working tree read 2026-08-09. Every quoted snippet below was read from the tree, not from the earlier spec.
- ACA and Medicare share **one** implementation (`EnrollmentClient.tsx`). Every change here lands on both. Verify both.
- **Never** change: request/response payloads, DB fields, `canEditEnrollmentRecordClient` / `canMutateEnrollmentRecord`, required-field resolution, or single-vs-multi cardinality. Enrollment `agent_email` / `caller_email` / `responsible_enroll_email` are **single-person `text` columns** — they must not be migrated to the CS multi-assignee component.
- Never run `next build` while the dev server may be running.
- Only push to `origin` automatically; push to `vercel` only if explicitly asked.
- Log every logic-relevant change in `agent-portal/changelog.md`.
- After every task: `npx tsc --noEmit`, `npx vitest run`, and `rtk proxy npx eslint <touched files>` must all be clean before moving on.
- **Baseline at plan time (`8d08351`), all green — any regression is a stop:** typecheck 0 errors · lint "No issues found" · vitest **60 files / 458 tests** · build exit 0.
- Reply to the user in Vietnamese, concise, when the plan is executed.

### Testing reality (read before Task 1)

`vitest.config.ts` sets `environment: "node"` and `include: ["src/**/*.test.ts"]`. **There is no jsdom and no component test harness in this repo.** A plan that writes "render the component and assert the class list" would be fiction. So:

- Pure logic (colour/emphasis decisions) is **extracted into `.ts` modules and TDD'd for real** — Task 1.
- Component wiring is verified by `tsc` (the surface prop is a discriminated union, so a missed call site is a **build error**, not a visual regression) plus the explicit manual checks in each task.

This is why Task 1 exists at all: it converts as much of this UI change as possible into something the test suite can actually hold.

---

## What the audit found (this replaces "Phase 1 — Complete the Field Inventory")

The original spec deferred the field inventory to execution time. It is done here; the results **materially shrink two of its phases and escalate one decision to the user**.

### Finding A — Create's design contract is already correct; only the person *empty state* violates it

`CreatePropertyField` draws the chrome (`EnrollmentClient.tsx:4007`):

```tsx
className={`flex min-h-10 items-center rounded-lg border-2 border-[#dfe1e6] bg-white px-2 py-1 text-sm font-semibold text-[#172b4d] transition hover:border-[#c1c7d0] focus-within:border-[#0c66e4] focus-within:ring-2 focus-within:ring-[#deebff] ${invalid ? INVALID_RING_CLASS : ""}`}
```

Every inner control in Create is therefore called **without** `field`, deliberately, so the wrapper owns the border. Verified at all Create call sites: Stage `:3491`, Payment `:3520`, Carrier `:3535`, AC `:3550`, Consent `:3565`, Platform `:3579`, Agent `:3598`, Caller `:3613`, Responsible `:3631`.

`EnrollmentOptionMenu`'s `field={false}` empty state is plain grey text — correct inside the wrapper:

```tsx
// EnrollmentClient.tsx:2302-2308
<span className={`min-w-0 flex-1 truncate text-left ${field && !option ? "font-normal text-[#97a0af]" : ""}`}>
  {option?.label ?? emptyLabel}
</span>
```

`EnrollmentPersonMenu`'s `field={false}` empty state is **a bordered dashed pill** — wrong inside the wrapper:

```tsx
// EnrollmentClient.tsx:2399-2408
<span
  className={
    field
      ? "inline-flex min-w-0 items-center gap-1.5 text-sm font-normal text-[#97a0af]"
      : "inline-flex items-center gap-1 rounded border border-dashed border-[#0c66e4] px-2 py-1 text-[11px] font-bold text-[#0c66e4] transition hover:bg-[#e9f2ff]"
  }
>
  <UserPlus className={field ? "h-4 w-4" : "h-3 w-3"} />
  {field ? emptyLabel : "Assign"}
</span>
```

**So the defect is one branch of one component**, not a missing control. The spec's "Replace the nested/dashed `Assign` presentation … render as full-width controls matching the CS visual language" would over-correct: passing `field` in Create would nest `DETAIL_FIELD_BUTTON_CLASS` (itself `border-2`) inside `CreatePropertyField`'s `border-2` and **create** the double border the spec wants to avoid.

The dashed "Assign" pill is genuinely right on **List**, where there is no wrapper and a call-to-action is useful. It must stay there.

> **Correction to the spec:** the spec's §1 says *"Enrollment Create currently displays `Agent` and `Responsible Enroll` using a dashed `Assign` action inside another bordered field."* Confirmed accurate. Its §7 Phase 2 remedy is not — see above. Detail/View is **already correct** (`field` is passed at `:3045`, `:3068`, `:3087`), so the spec's Phase 3 has no person work in it.

### Finding B — CS has **two** badge languages; Enrollment applies the wrong one to attributes

This is the correction the user supplied on 2026-08-09, and reading CS confirms it exactly. CS does not have "a badge style" — it has two, and which one a column gets is decided by **what the value means**, not by how it is stored.

**Language 1 — Identity badge.** Used for `Category`. `CategoryBadge` (`TaskRowItem.tsx:1544-1559`):

```tsx
    <span
      className="inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: palette.background, color: palette.foreground }}
    >
```
- **Solid, full-opacity** background = the category's own colour identity; foreground computed for contrast (`category-colors.ts:39` `readableTextColor`).
- **No chevron, ever — not even when editable.** `CategoryMenu` (`:1467-1490`) wraps `<CategoryBadge>` in a button and adds **nothing**; the edit affordance is `hover:opacity-85` (`:1478`).
- Empty state is a dashed CTA (`:1479`), read-only renders the bare badge or grey "No category" (`:1457-1464`).

**Language 2 — Workflow-state pill.** Used for `Status`/Stage. `STATUS_PILL` (`:169-176`):

```ts
  backlog:     { bg: "#dfe1e6", fg: "#42526e" },
  todo:        { bg: "#dfe1e6", fg: "#42526e" },
  in_progress: { bg: "#deebff", fg: "#0055cc" },
  waiting:     { bg: "#fff0b3", fg: "#7f5f01" },
  done:        { bg: "#e3fcef", fg: "#006644" },
  cancel:      { bg: "#ffebe6", fg: "#bf2600" },
```
- **Pale/tinted** semantic backgrounds, dark matching foregrounds.
- **Chevron only when the pill is actionable** (`:1260`, `:1346-1348`):
  ```tsx
  const showChevron = interactive || canReopen || canUnlockOverdue;
  ```
- **Typography is identical to the identity badge** — `text-[11px] font-bold uppercase tracking-wide`. Only colour weight and the chevron differ.

**So the CS rule is:**

| | Background | Chevron | Typography |
|---|---|---|---|
| **Identity** (Category) | **Solid**, full opacity, = the value's colour | **Never** | `text-[11px] font-bold uppercase tracking-wide` |
| **Workflow state** (Stage/Status) | **Pale tint**, semantic | **Only when actionable** | *(same)* |

**What Enrollment does today — wrong on both axes for attributes:**

| Enrollment control | Background | Chevron | Typography | Verdict |
|---|---|---|---|---|
| `EnrollmentStagePill` (`:2518`, `:2531`, `:2535`) | `optionPillStyle(stage)` → alpha **0.14** tint ✅ | **unconditional** (`:2535`) ❌ | `text-[11px] font-bold uppercase tracking-wide` ✅ | Colour + type correct; chevron ignores `canEdit` |
| `EnrollmentOptionMenu` — Carrier, Payment, AC, Platform, Consent (`:2274`, `:2291`, `:2309`) | alpha **0.08** tint ❌ | **unconditional** (`:2309`) ❌ | `text-xs font-medium`, no uppercase ❌ | Wrong language entirely — these are identity attributes, not workflow state |

The `// Calmer than the Stage pill on purpose` comment at `:2272` explains the 0.08 as "don't compete with Stage". CS answers that concern differently and better: it lets Category be **solid** *and* keeps Stage readable, because the two are separated by **chevron presence and colour semantics**, not by dimming one of them.

> **This supersedes the earlier framing of Finding B as an open product question.** The user has stated the rule and CS implements it; Task 3 now implements the two-language rule rather than asking which alpha to use.

### Field inventory — Enrollment vs Health CS baseline

| Data type | Field(s) | Create | Detail | List | Mismatch vs CS | Action |
|---|---|---|---|---|---|---|
| Single person | `agent_email`, `caller_email` (ACA), `responsible_enroll_email` | `EnrollmentPersonMenu` bare, **dashed-pill empty state** | `EnrollmentPersonMenu field` ✅ | `EnrollmentPersonMenu` bare + dashed pill ✅ (correct here) | **Create empty state only** | **Task 2** |
| Multiple people | *(none in Enrollment)* | — | — | — | None — cardinality differs by design | **No action** |
| Single option — **identity** | `carrier_id`, `payment_status_id`, `aca_status_id`, `platform_id`, `consent_id` | `EnrollmentOptionMenu` bare ✅ | `field` ✅ | tint `0.08` + always-on chevron + `text-xs font-medium` | **Wrong badge language** (Finding B): should be solid, no chevron, CS badge typography | **Task 3** |
| Single option — **workflow state** | `stage_id` | `EnrollmentStagePill` ✅ | ✅ | tint `0.14` + CS typography ✅, but chevron ignores `canEdit` | **Chevron only** | **Task 3** |
| Boolean | `consent_id` (option-backed), `qc_checked` | ✅ | ✅ | ✅ | None | No action |
| Short text / Long text / URL / Date | `client_name`, `description`, `fub_link`, `due_date`, `pcp_*` | ✅ | ✅ | ✅ | None found | No action |
| Empty value | all | mixed — see Task 2 | ✅ | ✅ | Create only | Task 2 |

**Net effect on the spec:** its Phase 2 shrinks to one component branch, Phase 3 becomes a no-op verification, Phase 4 becomes a user decision plus a constant. Phases 5–6 stand as written.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/enrollment/option-badge.ts` | **New.** Pure resolution of an option's List badge colours + the single emphasis constant. Zero React. | Create (Task 1) |
| `src/lib/enrollment/option-badge.test.ts` | **New.** TDD for the above, incl. the CS-parity contract. | Create (Task 1) |
| `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Person-menu surface prop + call sites; option chip consumes the new helper. | Modify (Tasks 2, 3) |
| `agent-portal/changelog.md` | Change log. | Modify (Tasks 2, 3) |

`option-badge.ts` is a new *library* file rather than another block inside the 4,200-line `EnrollmentClient.tsx` because it is the only part of this work the test suite can execute, and burying it in the component would make it untestable — the exact problem this plan is trying not to repeat.

---

### Task 1: Extract the List option-badge palette into a tested module

**Files:**
- Create: `src/lib/enrollment/option-badge.ts`
- Test: `src/lib/enrollment/option-badge.test.ts`

**Interfaces:**
- Consumes: `EnrollmentOption` from `@/lib/enrollment/types`; `readableTextColor` from `@/lib/tasks/category-colors` (**must be exported there first — Step 0**).
- Produces:
  - `ENROLLMENT_STATE_BADGE_ALPHA: number` (= `0.14`, the Stage tint)
  - `ENROLLMENT_BADGE_EMPTY: { bg: string; fg: string }`
  - `enrollmentIdentityBadgeStyle(option: EnrollmentOption | null): { bg: string; fg: string }` — **solid**, CS `CategoryBadge` language
  - `enrollmentStateBadgeStyle(option: EnrollmentOption | null, alpha?: number): { bg: string; fg: string }` — **tinted**, CS `StatusPill` language
  - `hexToRgba(hex: string, alpha: number): string | null`
- Later tasks rely on: both style functions (Task 3 replaces the in-component `optionPillStyle` with them).

This replaces `optionPillStyle` + `hexToRgba` (currently `EnrollmentClient.tsx:4251-4270`) with **two** named functions, one per badge language from Finding B, so a call site has to state which language it means instead of passing an unexplained alpha.

- [x] **Step 0: Export `readableTextColor` so contrast logic exists once**

`src/lib/tasks/category-colors.ts:39` currently declares it module-private:
```ts
function readableTextColor(background: string): string {
```
Change to:
```ts
export function readableTextColor(background: string): string {
```
Nothing else in that file changes. Re-implementing contrast maths in `option-badge.ts` would be a second source of truth for "is this text readable" — exactly what this plan is trying to remove.

Run: `npx tsc --noEmit` → no errors. Run: `npx vitest run` → unchanged totals.

- [x] **Step 1: Write the failing test**

```ts
// src/lib/enrollment/option-badge.test.ts
import { describe, expect, it } from "vitest";
import { readableTextColor } from "@/lib/tasks/category-colors";
import type { EnrollmentOption } from "./types";
import {
  ENROLLMENT_BADGE_EMPTY,
  ENROLLMENT_STATE_BADGE_ALPHA,
  enrollmentIdentityBadgeStyle,
  enrollmentStateBadgeStyle,
  hexToRgba,
} from "./option-badge";

function option(color: string | null): EnrollmentOption {
  return {
    id: "opt-1",
    set_key: "carrier",
    label: "Aetna",
    color,
    position: 1,
    is_terminal: false,
    triggers_qc: false,
    archived_at: null,
  } as EnrollmentOption;
}

describe("hexToRgba", () => {
  it("converts a 6-digit hex with alpha", () => {
    expect(hexToRgba("#36b37e", 0.14)).toBe("rgba(54, 179, 126, 0.14)");
  });

  it("accepts a leading-hash-less value and is case-insensitive", () => {
    expect(hexToRgba("36B37E", 1)).toBe("rgba(54, 179, 126, 1)");
  });

  it("returns null for anything that is not a 6-digit hex", () => {
    expect(hexToRgba("#fff", 0.5)).toBeNull();
    expect(hexToRgba("rebeccapurple", 0.5)).toBeNull();
    expect(hexToRgba("", 0.5)).toBeNull();
  });
});

// Identity badge = the Health CS CategoryBadge language: SOLID background,
// contrast-computed foreground. Used by Carrier / Payment / AC / Platform /
// Consent, which describe what the record IS, not where it is in a workflow.
describe("enrollmentIdentityBadgeStyle", () => {
  it("uses the stored colour at full opacity", () => {
    expect(enrollmentIdentityBadgeStyle(option("#36b37e")).bg).toBe("#36b37e");
  });

  it("computes a readable foreground rather than reusing the background", () => {
    const style = enrollmentIdentityBadgeStyle(option("#36b37e"));
    expect(style.fg).toBe(readableTextColor("#36b37e"));
    expect(style.fg).not.toBe(style.bg);
  });

  it("matches the CS CategoryBadge contract for the same colour", () => {
    // Locks the two modules together: a CS palette change must not silently
    // leave Enrollment identity badges behind.
    const style = enrollmentIdentityBadgeStyle(option("#6554c0"));
    expect(style).toEqual({ bg: "#6554c0", fg: readableTextColor("#6554c0") });
  });

  it("falls back to the neutral empty style with no option or no colour", () => {
    expect(enrollmentIdentityBadgeStyle(null)).toEqual(ENROLLMENT_BADGE_EMPTY);
    expect(enrollmentIdentityBadgeStyle(option(null))).toEqual(ENROLLMENT_BADGE_EMPTY);
  });

  it("falls back to the neutral empty style when the colour is malformed", () => {
    expect(enrollmentIdentityBadgeStyle(option("not-a-colour"))).toEqual(
      ENROLLMENT_BADGE_EMPTY
    );
  });
});

// State badge = the Health CS StatusPill language: PALE tint, colour-as-text.
// Used by Stage only.
describe("enrollmentStateBadgeStyle", () => {
  it("tints the stored colour and keeps it as the foreground", () => {
    const style = enrollmentStateBadgeStyle(option("#36b37e"));
    expect(style.bg).toBe(hexToRgba("#36b37e", ENROLLMENT_STATE_BADGE_ALPHA));
    expect(style.fg).toBe("#36b37e");
  });

  it("preserves the current Stage tint so Stage does not change appearance", () => {
    expect(ENROLLMENT_STATE_BADGE_ALPHA).toBe(0.14);
  });

  it("honours an explicit alpha override", () => {
    expect(enrollmentStateBadgeStyle(option("#36b37e"), 1).bg).toBe(
      "rgba(54, 179, 126, 1)"
    );
  });

  it("falls back to the neutral empty style with no option or no colour", () => {
    expect(enrollmentStateBadgeStyle(null)).toEqual(ENROLLMENT_BADGE_EMPTY);
    expect(enrollmentStateBadgeStyle(option(null))).toEqual(ENROLLMENT_BADGE_EMPTY);
  });

  it("falls back to a flat grey when the stored colour is malformed", () => {
    expect(enrollmentStateBadgeStyle(option("not-a-colour")).bg).toBe("#dfe1e6");
  });
});

describe("the two languages are actually different", () => {
  it("identity is solid where state is tinted", () => {
    const identity = enrollmentIdentityBadgeStyle(option("#36b37e"));
    const state = enrollmentStateBadgeStyle(option("#36b37e"));
    expect(identity.bg).not.toBe(state.bg);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/enrollment/option-badge.test.ts`
Expected: FAIL — `Failed to resolve import "./option-badge"`.

- [x] **Step 3: Write the implementation**

```ts
// src/lib/enrollment/option-badge.ts
//
// Health CS uses TWO badge languages, and which one a column gets depends on
// what the value MEANS:
//
//   Identity  (CS: CategoryBadge, TaskRowItem.tsx:1544-1559)
//     solid full-opacity background = the value's own colour identity,
//     contrast-computed foreground, and NO chevron — not even when editable.
//     Enrollment equivalents: Carrier, Payment status, AC status, Platform,
//     Consent. These say what the record IS.
//
//   Workflow state  (CS: StatusPill, TaskRowItem.tsx:169-176)
//     pale tinted background, colour-as-foreground, chevron ONLY when the
//     control is actionable. Enrollment equivalent: Stage. This says where the
//     record is in its lifecycle.
//
// Both share typography: text-[11px] font-bold uppercase tracking-wide.
// Keeping the two as separate named functions means a call site must state
// which language it means, instead of passing an unexplained alpha.
import { readableTextColor } from "@/lib/tasks/category-colors";
import type { EnrollmentOption } from "./types";

/**
 * Tint opacity for workflow-state badges (Stage).
 *
 * This is the value Stage already renders at (`optionPillStyle`'s old default),
 * kept deliberately so this refactor does not change Stage's appearance.
 */
export const ENROLLMENT_STATE_BADGE_ALPHA = 0.14;

/** Neutral badge for "nothing selected" — never a real option colour. */
export const ENROLLMENT_BADGE_EMPTY = {
  bg: "#f4f5f7",
  fg: "#5e6c84",
} as const;

export function hexToRgba(hex: string, alpha: number): string | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return null;
  const [, red, green, blue] = match;
  return `rgba(${parseInt(red, 16)}, ${parseInt(green, 16)}, ${parseInt(blue, 16)}, ${alpha})`;
}

/**
 * Identity badge — the CS CategoryBadge language. Solid background, readable
 * foreground. Deterministic: the colour is the stored option row's own colour,
 * never a hash that could shift between renders.
 */
export function enrollmentIdentityBadgeStyle(
  option: EnrollmentOption | null
): { bg: string; fg: string } {
  if (!option?.color) return { ...ENROLLMENT_BADGE_EMPTY };
  // A malformed stored colour must not produce an unreadable badge; fall back
  // to neutral rather than trusting it as a CSS colour.
  if (!hexToRgba(option.color, 1)) return { ...ENROLLMENT_BADGE_EMPTY };
  return {
    bg: option.color,
    fg: readableTextColor(option.color),
  };
}

/**
 * Workflow-state badge — the CS StatusPill language. Pale tint, colour as
 * foreground.
 */
export function enrollmentStateBadgeStyle(
  option: EnrollmentOption | null,
  alpha: number = ENROLLMENT_STATE_BADGE_ALPHA
): { bg: string; fg: string } {
  if (!option?.color) return { ...ENROLLMENT_BADGE_EMPTY };
  return {
    bg: hexToRgba(option.color, alpha) ?? "#dfe1e6",
    fg: option.color,
  };
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/enrollment/option-badge.test.ts`
Expected: PASS — 10 tests.

Run: `npx vitest run`
Expected: **61 files**, `FAIL (0)`, total up from 458.

Run: `npx tsc --noEmit` → no errors.
Run: `rtk proxy npx eslint "src/lib/enrollment/option-badge.ts" "src/lib/enrollment/option-badge.test.ts"` → clean.

⚠️ If the `EnrollmentOption` literal in the test fails to type-check, open `src/lib/enrollment/types.ts` and match its actual fields — do **not** loosen the test with `as any`.

- [x] **Step 5: Commit**

```bash
git add src/lib/enrollment/option-badge.ts src/lib/enrollment/option-badge.test.ts
git commit -m "refactor(enrollment): extract option badge palette into a tested module"
```

---

### Task 2: Give `EnrollmentPersonMenu` a surface-aware empty state

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` (component at `:2349-2450`; call sites at `:1870`, `:1886`, `:1902`, `:3045`, `:3068`, `:3087`, `:3598`, `:3613`, `:3631`)
- Modify: `agent-portal/changelog.md`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `EnrollmentPersonMenu` prop `surface: "list" | "form-bare" | "form-field"` replacing the boolean `field`. Task 3 does not depend on this.

**The bug:** `field` conflates *"which surface am I on"* with *"do I draw my own border"*. Create needs `field={false}`'s borderless body but must **not** get its dashed "Assign" call-to-action, because `CreatePropertyField` already supplies a bordered box — nesting a dashed bordered pill inside it is the double border in the spec's §9 regression list.

Replacing the boolean with a 3-value union means **`tsc` fails on any call site not updated** — the compiler enumerates the work instead of a human grepping for it.

- [x] **Step 1: Change the component signature and the two branches**

In `EnrollmentPersonMenu` (`:2349`), replace the `field?: boolean;` prop with:

```ts
  /**
   * Which surface this control is rendered on.
   *  - "list"       → borderless, and an explicit dashed "Assign" call-to-action
   *                   when empty (there is no field wrapper to hint at it).
   *  - "form-bare"  → borderless body for Create, where CreatePropertyField
   *                   already draws the border. Empty state is a plain
   *                   placeholder, matching EnrollmentOptionMenu (:2302-2308).
   *  - "form-field" → draws its own bordered control for the Detail drawer.
   */
  surface: "list" | "form-bare" | "form-field";
```

Derive the two old behaviours from it, right after the `useAnchoredMenu()` call:

```ts
  const drawsOwnChrome = surface === "form-field";
  const showsAssignCallToAction = surface === "list";
```

Then replace every `field ? … : …` inside the component with the matching flag. The button className (`:2385`) becomes:

```tsx
        className={
          drawsOwnChrome
            ? `${DETAIL_FIELD_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-60`
            : "flex w-full min-w-0 items-center disabled:cursor-not-allowed disabled:opacity-60"
        }
```

the selected-value span (`:2389-2391`):

```tsx
            className={`flex min-w-0 items-center gap-1.5 text-left font-semibold transition ${
              drawsOwnChrome
                ? "flex-1 text-sm text-[#172b4d]"
                : "text-xs text-[#42526e] hover:text-[#0c66e4]"
            }`}
```

the empty state (`:2399-2409`) — this is the actual fix:

```tsx
          <span
            className={
              showsAssignCallToAction
                ? "inline-flex items-center gap-1 rounded border border-dashed border-[#0c66e4] px-2 py-1 text-[11px] font-bold text-[#0c66e4] transition hover:bg-[#e9f2ff]"
                : "inline-flex min-w-0 items-center gap-1.5 text-sm font-normal text-[#97a0af]"
            }
          >
            <UserPlus className={showsAssignCallToAction ? "h-3 w-3" : "h-4 w-4"} />
            {showsAssignCallToAction ? "Assign" : emptyLabel}
          </span>
```

and the trailing chevron (`:2410`):

```tsx
        {drawsOwnChrome ? <ChevronDown className="ml-auto h-4 w-4 shrink-0 opacity-60" /> : null}
```

- [x] **Step 2: Run typecheck to enumerate every call site**

Run: `npx tsc --noEmit`
Expected: FAIL — one error per `EnrollmentPersonMenu` usage, `Property 'surface' is missing`. There should be **nine**: `:1870`, `:1886`, `:1902` (List row), `:3045`, `:3068`, `:3087` (Detail drawer), `:3598`, `:3613`, `:3631` (Create dialog).

⚠️ If the count is not nine, **stop and re-grep** (`rtk proxy grep -n "EnrollmentPersonMenu" src/app/\(authed\)/enrollment/_components/EnrollmentClient.tsx`) — a call site was added or moved since this plan was written, and it needs a deliberate surface value rather than a guess.

- [x] **Step 3: Update the call sites**

- List row (`:1870`, `:1886`, `:1902`) — had no `field`: add `surface="list"`.
- Detail drawer (`:3045`, `:3068`, `:3087`) — had bare `field`: replace it with `surface="form-field"`.
- Create dialog (`:3598`, `:3613`, `:3631`) — had no `field`: add `surface="form-bare"`. **This is the behaviour change.**

Example, Create's Agent field (`:3598`):

```tsx
                      <EnrollmentPersonMenu
                        value={form.agent_email || null}
                        peopleByEmail={agentsByEmail}
                        emptyLabel="No agent"
                        surface="form-bare"
                        onChange={(value) => update("agent_email", value)}
                      />
```

Example, Detail's Responsible field (`:3087`):

```tsx
                  <EnrollmentPersonMenu
                    value={record.responsible_enroll_email}
                    peopleByEmail={peopleByEmail}
                    emptyLabel="Unassigned"
                    surface="form-field"
                    canEdit={canEditRecord}
                    onChange={(value) =>
                      void onPatch({ responsible_enroll_email: value })
                    }
                  />
```

Do **not** touch `value`, `peopleByEmail`, `emptyLabel`, `canEdit`, or `onChange` at any call site. `canEdit` stays omitted in Create (it defaults to `true` — Create has no record to check permissions against, which is intentional; see the go-live review's M-34 note).

- [x] **Step 4: Verify**

Run: `npx tsc --noEmit` → `No errors found`.
Run: `npx vitest run` → same totals as Task 1, `FAIL (0)`.
Run: `rtk proxy npx eslint "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"` → clean.
Run: `rtk proxy grep -n "field={\|field$" src/app/\(authed\)/enrollment/_components/EnrollmentClient.tsx | rtk proxy grep -i person` → no output (no leftover boolean on the person menu).

- [ ] **Step 5: Manual check** (dev server already running — do not start a second one)

**ACA** `/enrollment?program=aca` → New enrollment:
- Agent / Caller / Responsible each show **one** bordered box (from `CreatePropertyField`) containing plain grey placeholder text — "No agent" / "No caller" / "Unassigned". **No dashed pill, no inner border.**
- Clicking anywhere in the box opens the person dropdown; picking someone shows initials + name.
- The Required asterisk still appears for whichever of these Config marks required, and Create still blocks when one is empty.

**Medicare** `/enrollment?program=medicare` → same, except Caller is absent (Medicare-inapplicable) and Responsible is labelled "Assignee".

**List** (both programs): an unassigned Responsible still shows the dashed **"Assign"** pill — unchanged, this surface keeps its call-to-action.

**Detail drawer** (both programs): person fields still render as full-width bordered controls with a chevron — unchanged.

- [x] **Step 6: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "fix(enrollment): use a surface-aware empty state for person fields"
```

- [x] **Step 7: Changelog**

Add an entry at the top of `## Unreleased` in `agent-portal/changelog.md` (follow the file's own format block) recording: Enrollment Create person fields (Agent / Caller / Responsible, ACA + Medicare) no longer render the List-view dashed "Assign" pill inside `CreatePropertyField`'s border; `EnrollmentPersonMenu`'s boolean `field` prop became `surface: "list" | "form-bare" | "form-field"` so each surface is explicit and the compiler enforces coverage. No payload, permission, validation, or cardinality change — these remain single-person `text` columns.

```bash
git add agent-portal/changelog.md
git commit -m "docs(changelog): record enrollment person field surface fix"
```

---

### Task 3: Apply the two badge languages to Enrollment List

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
  - `EnrollmentOptionMenu` — component at `:2254-2348`; badge style `:2274`; non-`field` className `:2291`; chevron `:2309`
  - `EnrollmentStagePill` — style `:2518`; row chevron `:2535`; field chevron `:2527`
  - delete `optionPillStyle` (`:4251-4263`) and `hexToRgba` (`:4265-4270`)
- Modify: `agent-portal/changelog.md`

**Interfaces:**
- Consumes: `enrollmentIdentityBadgeStyle`, `enrollmentStateBadgeStyle` from Task 1.
- Produces: nothing later tasks depend on.

**The rule being implemented** (Finding B — stated by the user, confirmed against CS):

| Enrollment control | Language | Background | Chevron | Typography |
|---|---|---|---|---|
| `EnrollmentOptionMenu` — Carrier, Payment, AC, Platform, Consent | **Identity** (CS `CategoryBadge`) | **solid**, `enrollmentIdentityBadgeStyle` | **none** | `text-[11px] font-bold uppercase tracking-wide` |
| `EnrollmentStagePill` — Stage | **Workflow state** (CS `StatusPill`) | **pale tint**, `enrollmentStateBadgeStyle` (unchanged 0.14) | **only when `canEdit`** | already correct |

Only the **List** (`field={false}`) presentation changes. The Detail-drawer (`field`) presentation is a form control and keeps its `DETAIL_FIELD_BUTTON_CLASS` + chevron — a form field must still look operable.

- [x] **Step 1: Switch both components onto the shared helpers**

Add to the `@/lib/enrollment/...` import block in `EnrollmentClient.tsx`:

```ts
import {
  enrollmentIdentityBadgeStyle,
  enrollmentStateBadgeStyle,
} from "@/lib/enrollment/option-badge";
```

In `EnrollmentOptionMenu`, replace `:2272-2274`:

```ts
  // Calmer than the Stage pill on purpose: these are attributes, not the
  // record's primary status, so they shouldn't compete visually with Stage.
  const style = optionPillStyle(option, 0.08);
```

with:

```ts
  // Identity badge (CS CategoryBadge language): a Carrier/Payment/AC/Platform
  // value is what the record IS, so it carries its own solid colour. Stage
  // stays distinguishable via its tint + chevron, not by dimming these.
  const style = enrollmentIdentityBadgeStyle(option);
```

In `EnrollmentStagePill`, replace `:2518`:

```ts
  const style = optionPillStyle(stage);
```

with:

```ts
  // Workflow-state badge (CS StatusPill language) — tinted, not solid.
  const style = enrollmentStateBadgeStyle(stage);
```

⚠️ Before deleting `optionPillStyle`, run:
```bash
rtk proxy grep -n "optionPillStyle\|hexToRgba" "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
```
Every remaining caller must be moved to whichever helper matches its language. Only delete the two functions once that grep returns nothing but their own definitions.

- [x] **Step 2: Give identity badges the CS typography**

`EnrollmentOptionMenu`'s non-`field` className (`:2291`) is currently:

```tsx
            : "flex w-full min-w-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
```

Replace with (matches `CategoryBadge` at `TaskRowItem.tsx:1549`, plus the button-state classes this element needs):

```tsx
            : "flex w-full min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-60"
```

Leave the `field` branch (`DETAIL_FIELD_BUTTON_CLASS`) untouched — the drawer is a form, not a badge.

- [x] **Step 3: Remove the chevron from identity badges**

`:2309` currently renders unconditionally:

```tsx
        <ChevronDown className={`${field ? "h-4 w-4" : "h-3 w-3"} shrink-0 opacity-60`} />
```

Replace with:

```tsx
        {/* CS never puts a chevron on an identity badge — CategoryMenu
            (TaskRowItem.tsx:1467-1490) wraps CategoryBadge in a button and
            adds nothing. The drawer's form control still needs one. */}
        {field ? <ChevronDown className="h-4 w-4 shrink-0 opacity-60" /> : null}
```

- [x] **Step 4: Make the Stage chevron conditional on editability**

CS shows the status chevron only when the pill can actually do something (`TaskRowItem.tsx:1260`, `:1346-1348`). `EnrollmentStagePill` currently always shows it.

At `:2535` (row/List variant), replace:

```tsx
      <ChevronDown className="h-3 w-3 shrink-0" />
```

with:

```tsx
      {canEdit ? <ChevronDown className="h-3 w-3 shrink-0" /> : null}
```

Leave the `field` variant's chevron (`:2527`) as-is — that is the drawer form control.

⚠️ `canEdit` defaults to `true` (`:2506`), so List rows for editable records are unchanged; only read-only rows lose the misleading affordance.

- [x] **Step 5: Delete the superseded helpers**

Remove `optionPillStyle` (`:4251-4263`) and `hexToRgba` (`:4265-4270`) from `EnrollmentClient.tsx`. `hexToRgba` now lives in `option-badge.ts` and is exported from there.

- [x] **Step 6: Verify**

Run: `npx tsc --noEmit` → `No errors found`.
Run: `npx vitest run` → `FAIL (0)`, totals from Task 1.
Run: `rtk proxy npx eslint "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" "src/lib/enrollment/option-badge.ts" "src/lib/tasks/category-colors.ts"` → clean.
Run: `rtk proxy grep -n "optionPillStyle" src/` → **no output**.

- [ ] **Step 7: Manual check**

Take a **before** screenshot of `/enrollment?program=aca` List first — Stage must not change, and that is easiest to prove visually.

On `/enrollment?program=aca` List, with a record that has Carrier, Payment, AC, Platform and Consent set:
- All identity badges render **solid** in the option's own colour, white/dark text chosen for contrast, **no chevron**.
- They sit at the same height and typography as a Health CS `Category` badge — open `/tasks` List side by side and compare.
- Long labels truncate without growing row height.
- An unset option shows the neutral grey `#f4f5f7` state, **not** a coloured badge.
- Clicking a badge still opens its dropdown (the affordance is now hover/cursor, exactly as CS `CategoryMenu`).
- **Stage is visually identical to the before screenshot**, and still shows its chevron.
- Open a record the current user cannot edit (not caller/responsible/creator): Stage now shows **no** chevron, identity badges are still readable.

Repeat on `?program=medicare` — Carrier and Stage only; Payment/AC/Platform/Consent are Medicare-inapplicable and must not appear.

- [x] **Step 8: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" src/lib/tasks/category-colors.ts
git commit -m "fix(enrollment): apply CS identity/state badge languages in list view"
```

- [x] **Step 9: Changelog**

Add an entry at the top of `## Unreleased` recording: Enrollment List now distinguishes **identity** badges (Carrier / Payment / AC / Platform / Consent — solid option colour, no chevron, CS `CategoryBadge` typography) from **workflow-state** badges (Stage — pale tint, chevron only when editable), matching Health CS. Stage's colour and typography are unchanged. Badge palettes moved to `src/lib/enrollment/option-badge.ts` with tests; `readableTextColor` is now exported from `src/lib/tasks/category-colors.ts` so contrast logic exists once. No payload, permission, or validation change.

```bash
git add agent-portal/changelog.md
git commit -m "docs(changelog): record enrollment list badge language split"
```

---
### Task 4: Cross-surface consistency review and regression verification

**Files:** none modified — this task produces a written result only.

**Interfaces:** consumes the output of Tasks 1–3.

This is the spec's Phase 5 + Phase 6, with the audit already done so it is a check rather than a discovery exercise.

- [x] **Step 1: Full automated suite**

```bash
npx tsc --noEmit
rtk proxy npx eslint .
npx vitest run
npm run build
```

Expected: typecheck 0 errors · lint "No issues found" · vitest `FAIL (0)` with a total **≥ 469** · build exit 0. **Record the actual numbers.** Do not write "passed" for a command that was not run.

- [x] **Step 2: Data-type matrix walkthrough**

For each pair below, confirm the same data type looks and behaves the same, and write one line per row stating pass or the remaining difference plus its business reason:

| Comparison | Person (single) | Single option | Stage | Boolean | Date | URL |
|---|---|---|---|---|---|---|
| ACA Create ↔ ACA Detail | | | | | | |
| ACA Detail ↔ ACA List | | | | | | |
| ACA ↔ Medicare | | | | | | |
| Enrollment ↔ Health CS | | | | | | |

Known-and-accepted differences that must **not** be "fixed":
- Health CS `Assignee` is multi-person with an avatar stack; Enrollment has no multi-person field. Different cardinality, different control — correct.
- Medicare hides Caller / Payment / AC / Consent / Platform / PCP 2026. Program rule, enforced in five places (see the go-live review's M-31).
- Stage keeps its own pill treatment, distinct from attribute badges.

- [x] **Step 3: Regression checklist from the spec's §9**

Confirm each, on **both** programs:
- No single-person field became multi-person — `agent_email`, `caller_email`, `responsible_enroll_email` still send a single string.
- Agent options still come from `agentsByEmail`; Caller/Responsible from `peopleByEmail`. (Task 2 did not touch these.)
- The Caller current-user default still applies on ACA Create (`caller_email: isMedicare ? "" : currentEmail`).
- A required person field still blocks Create when empty.
- A read-only record's Detail controls are still disabled (`canEdit={canEditRecord}` untouched).
- No double border anywhere in Create.
- Dropdowns still open above/below correctly inside the Create dialog and the Detail drawer, and still scroll.
- Large List still scrolls smoothly — Tasks 2–3 changed only className/style resolution, added no per-row state.

- [x] **Step 4: Record the result**

Append a section to `docs/codex_review_code.md` following the format the spec's §8 requires — issue and affected surfaces, root cause, exact change, regression risk, verification performed, source commit IDs. Reference Findings A and B from this plan for root cause rather than restating them.

```bash
git add docs/codex_review_code.md
git commit -m "docs(go-live): record enrollment UI standardization verification"
```

---

## Implementation Record — 2026-08-09

The executable source work is complete. ACA and Medicare use the same shared `EnrollmentClient.tsx` path; no program-specific payload or permission behavior was changed.

### Source commits

| Scope | Result | Commit |
|---|---|---|
| Task 1 | Exported CS contrast logic; added tested identity/state badge palette helpers. | `f20392e` |
| Task 2 | Replaced `EnrollmentPersonMenu.field` with the surface union and fixed Create's nested dashed empty state. | `c51691f` |
| Task 3 | Applied solid CS CategoryBadge language to identity options, preserved tinted Stage language, and hid non-actionable Stage chevrons. | `912bb00` |
| Task 3 follow-up | Applied the helper's neutral empty style instead of overriding empty option badges to transparent. | `b86ffbb` |
| Task 2 changelog | Recorded person-menu surface behavior. | `f7601b3` |
| Task 3 changelog | Recorded the identity/workflow badge split. | `9369b9e` |
| Task 3 follow-up changelog | Recorded neutral empty option badges. | `9cb8375` |

### Automated verification

- `npx tsc --noEmit`: PASS.
- `rtk proxy npx eslint .`: PASS.
- `npx vitest run`: **62 files / 480 tests passed**.
- `option-badge.test.ts`: 14 tests passed.
- Compiler surface audit: all nine `EnrollmentPersonMenu` call sites explicitly use `list`, `form-field`, or `form-bare`; no boolean `field` remains on that component.
- Source audit: no `optionPillStyle` references remain.

### Data-type matrix walkthrough

| Comparison | Person (single) | Single option | Stage | Boolean | Date | URL |
|---|---|---|---|---|---|---|
| ACA Create ↔ ACA Detail | PASS — same single-person value; Create uses wrapper-owned `form-bare`, Detail uses bordered `form-field` | PASS — form controls are surface-specific; same selected option/value | PASS — same workflow-state semantics | PASS — unchanged | PASS — unchanged | PASS — unchanged |
| ACA Detail ↔ ACA List | PASS — Detail full control vs compact List avatar/Assign is intentional surface difference | PASS — Detail select vs solid identity badge is intentional surface difference | PASS — tinted state pill; chevron is actionable only | PASS — unchanged | PASS — unchanged | PASS — unchanged |
| ACA ↔ Medicare | PASS — shared Agent/Responsible single-person controls; ACA Caller remains conditional | PASS — shared identity badge helper; Medicare only renders applicable Carrier/Stage fields | PASS — shared state helper and tint | PASS — program fields remain conditional | PASS — unchanged | PASS — unchanged |
| Enrollment ↔ Health CS | PASS — Enrollment remains single-person; CS multi-person Assignee remains intentionally different cardinality | PASS — Enrollment identity badges now match CS CategoryBadge typography/solid contrast | PASS — Enrollment Stage retains CS StatusPill tint/typography | PASS — unchanged | PASS — unchanged | PASS — unchanged |

### Regression checklist

- Single-person columns remain `agent_email`, `caller_email`, and `responsible_enroll_email`; no multi-person component was introduced.
- Agent options still use `agentsByEmail`; Caller/Responsible still use `peopleByEmail`.
- ACA Create still defaults `caller_email` to `currentEmail`; Medicare remains empty by program rule.
- Required-field checks and `canEditRecord` paths were untouched.
- Create person controls use `form-bare`, so `CreatePropertyField` remains the only border owner; no nested border is introduced.
- Existing anchored-menu implementation is unchanged; dropdown positioning/scroll behavior remains a manual browser gate.
- The List changes add no per-row React state.

### Manual/build gates

`next dev` is currently running, so `npm run build` was intentionally not run under the repository safety rule. No authenticated browser session is available in this execution context, so ACA/Medicare Create/List/Detail screenshots, read-only affordance checks, dropdown interaction, and responsive checks remain manual gates. The automated checks above are green; this UI change does not alter the overall Go-Live recommendation.

## Self-Review

**1. Spec coverage.** Spec §7 Phase 1 → done inline (Findings A/B + inventory table); its deliverable "a confirmed implementation matrix" is the inventory table. Phase 2 → Task 2. Phase 3 → verified already correct (`field` passed at `:3045`/`:3068`/`:3087`), covered as a check in Task 4 Step 2. Phase 4 → Tasks 1 + 3. Phase 5 → Task 4 Step 2. Phase 6 → Task 4 Steps 1 and 3. Spec §8 commit strategy → one commit per task, source and docs separated, as required. Spec §10 acceptance criteria → all map to Task 4 checks.

**Gap intentionally left:** spec §7 Phase 4 also lists "Use avatar/initials plus name for person fields" in List. Already true — `EnrollmentPersonMenu`'s value branch (`:2393`) renders `<Initials …/>` plus the name. No task, because there is nothing to change. Recorded as "Pending audit → no mismatch" rather than silently dropped.

**2. Placeholder scan.** No "TBD"/"handle edge cases"/"similar to Task N". Every code step carries the actual code. No step defers a decision — Finding B's open question was closed by the user on 2026-08-09, so Task 3 states one outcome rather than branching.

**3. Type consistency.** Names are spelled identically everywhere they appear:
- `enrollmentIdentityBadgeStyle(option)` / `enrollmentStateBadgeStyle(option, alpha?)` / `ENROLLMENT_STATE_BADGE_ALPHA` / `ENROLLMENT_BADGE_EMPTY` / `hexToRgba` — defined in Task 1, consumed in Task 3.
- `surface: "list" | "form-bare" | "form-field"` — Task 2's signature, its two derived flags (`drawsOwnChrome`, `showsAssignCallToAction`), and all nine call sites.
- `readableTextColor` — exported in Task 1 Step 0 from `category-colors.ts`, imported by `option-badge.ts` and by `option-badge.test.ts`.

An earlier draft of this plan used a single `enrollmentOptionBadgeStyle(option, alpha?)`; it was replaced when Finding B was corrected to two languages. No reference to the old name survives.

**4. Risks this plan deliberately front-loads.**
- **Stage regressing.** Task 3 deletes `optionPillStyle`, which `EnrollmentStagePill` depends on for its `0.14` default. Mitigated three ways: `ENROLLMENT_STATE_BADGE_ALPHA` is pinned to `0.14` with a test asserting that exact value; Task 3 Step 1 mandates a grep before deletion; Task 3 Step 7 requires a before/after screenshot comparison of Stage specifically. Stage is out of scope and must look identical.
- **A person-menu call site added after this plan was written.** Handled by the union type plus the explicit "expect nine errors, stop if not" gate in Task 2 Step 2.
- **Contrast on a solid badge.** Moving identity badges from an 8% tint to full opacity means foreground colour now matters. Handled by reusing CS's own `readableTextColor` rather than a second implementation, with a test asserting `fg !== bg` and parity with the CS palette contract.
- **A malformed stored option colour.** At 8% opacity a bad value was nearly invisible; at full opacity it would be a broken badge. `enrollmentIdentityBadgeStyle` validates via `hexToRgba` and falls back to the neutral style, with a test covering it.

**5. Sequencing.** Task 1 → Task 3 (Task 3 imports Task 1's module). Task 2 is independent and can run in parallel or first. Task 4 is last. **None of this is a go-live blocker** — the open `security definer` execute-grant issue (`docs/codex_review_code.md` → `[CLAUDE] Post-fix review` §2) should land before any of it.
