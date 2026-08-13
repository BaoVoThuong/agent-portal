# Enrollment ACA Overview — Assignment Write Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager assign an unassigned ACA record to a person directly from the overview, and edit who is in the assignment queue — the only two places this dashboard writes.

**Architecture:** No new mutation endpoint for assignment: the existing `PATCH /api/enrollment/[id]` already validates the actor, enforces `canAssignPeople`, writes the activity row, and guards concurrency through `expected_updated_at`. The work is (a) carrying `updated_at` through the snapshot so the dashboard can supply it, (b) a small optimistic-then-reconcile client action, and (c) a queue-membership endpoint mirroring the CS one against the enrollment-specific table.

**Tech Stack:** Next.js App Router route handlers, Supabase, React client components, Vitest (node).

**Depends on:** both `2026-08-13-enrollment-aca-overview-data-layer.md` and `2026-08-13-enrollment-aca-overview-ui.md` complete.

**Spec:** `docs/superpowers/specs/2026-08-13-enrollment-aca-overview-design.md` §7.6, §9.4, §12c.B, §12c.C

## Global Constraints

- **The per-row permission problem does not exist here, and you must not build for it.** The spec's §12c.B warns that `canAssignPeople` is resolved per record against that record's `agent_email`, implying one `agent_members` query per row. That is true for the general case — but **this dashboard is manager/admin only** (spec §12b item 1), and managers receive `canAssignPeople` through the blanket grant at `src/lib/enrollment/access.ts:49-61`, independent of record ownership. Every viewer of this surface therefore already passes. Render the picker for all viewers of the dashboard; do **not** add a batched `agent_members` fetch, and do **not** compute per-row capability on the client.
- **The server still enforces per record.** `src/app/api/enrollment/[id]/route.ts:293-298` stays the authority. The client never becomes the gate.
- **Concurrency is already solved; staleness is the real failure.** The 409 path prevents a double-assign at the database. What it cannot prevent is an assign issued from a snapshot older than the record's last edit — routine on a large snapshot. Every successful assign must adopt the `updated_at` from its own response.
- **One reload, not two.** A successful PATCH fires `broadcastEnrollmentChanged` (`[id]/route.ts:531`), which already triggers the parent's refetch. Do not also blanket-reload the snapshot on every assign; reconcile the single row, and reload only on error.
- ACA only. Read the route-handler guide in `node_modules/next/dist/docs/` before writing endpoints.
- Run `npx tsc --noEmit` before every commit.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/lib/enrollment/aca-overview-assign.ts` | Pure reducer for optimistic assign / revert |
| `src/app/api/enrollment/aca-overview/queue-members/route.ts` | Queue membership toggle |
| `src/app/(authed)/enrollment/_components/aca/AcaAssignPicker.tsx` | Person picker cell |

**Modified:**

| File | Change |
|---|---|
| `src/lib/enrollment/aca-overview-types.ts` | `updatedAt` on the action row; `assignablePeople` on the snapshot |
| `src/lib/enrollment/aca-overview-actions.ts` | Carry `updated_at` through |
| `src/lib/enrollment/aca-overview-data.ts` | Select `updated_at` |
| `src/app/(authed)/enrollment/_components/aca/AcaUnassigned.tsx` | Assign column |
| `src/app/(authed)/enrollment/_components/aca/AcaQueue.tsx` | Edit queue grid |
| `src/app/(authed)/enrollment/_components/aca/AcaOverview.tsx` | Assign handler and row reconciliation |

---

## Task 1: Carry `updated_at` and the assignable roster through the snapshot

**Files:**
- Modify: `src/lib/enrollment/aca-overview-types.ts`
- Modify: `src/lib/enrollment/aca-overview-actions.ts`
- Modify: `src/lib/enrollment/aca-overview-data.ts`
- Modify: `src/lib/enrollment/aca-overview.ts`
- Test: `src/lib/enrollment/aca-overview-actions.test.ts`

**Interfaces:**
- Produces: `AcaOverviewActionRow.updatedAt: string`, `AcaOverviewSnapshot.assignablePeople: AcaOverviewPerson[]`

The PATCH endpoint hard-requires `expected_updated_at` (`[id]/route.ts:111-117`, 409 at `:142-147`, and the RPC's `where updated_at = p_expected_updated_at`). Nothing in the snapshot carries it today, so an assign would need a GET per row first.

- [ ] **Step 1: Add the fields**

In `aca-overview-types.ts`, add to `AcaOverviewRecord`:

```ts
  updated_at: string;
```

to `AcaOverviewActionRow`:

```ts
  /** Required by PATCH's optimistic-concurrency check. Refresh from each response. */
  updatedAt: string;
```

and to `AcaOverviewSnapshot`:

```ts
  /** Who the assign picker may offer. Same roster the queue rotates over. */
  assignablePeople: AcaOverviewPerson[];
```

- [ ] **Step 2: Write the failing test**

Append to `aca-overview-actions.test.ts`:

```ts
describe("buildUnassignedRows updatedAt", () => {
  it("carries the record's updated_at so an assign can pass optimistic concurrency", () => {
    const rows = buildUnassignedRows(
      input([
        record("u1", {
          responsible_enroll_email: null,
          updated_at: "2026-08-12T09:30:00.000Z",
        }),
      ])
    );
    expect(rows[0].updatedAt).toBe("2026-08-12T09:30:00.000Z");
  });
});
```

Add `updated_at: "2026-08-01T00:00:00.000Z",` to that file's `record()` fixture, and to every other `AcaOverviewRecord` fixture in the suite.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/enrollment/aca-overview-actions.test.ts`
Expected: FAIL — `updatedAt` is undefined.

- [ ] **Step 4: Thread the field through**

In `aca-overview-actions.ts`, add to the object `toRow` returns:

```ts
    updatedAt: record.updated_at,
```

In `aca-overview-data.ts`, add `updated_at` to `RECORD_COLUMNS`.

In `aca-overview.ts`, add to the returned snapshot:

```ts
    assignablePeople: input.people.filter((person) => person.canWork),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/enrollment/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/enrollment/aca-overview-types.ts src/lib/enrollment/aca-overview-actions.ts src/lib/enrollment/aca-overview-actions.test.ts src/lib/enrollment/aca-overview-data.ts src/lib/enrollment/aca-overview.ts
git commit -m "feat(enrollment): carry updated_at and assignable roster through the ACA snapshot"
```

---

## Task 2: Optimistic assign reducer

**Files:**
- Create: `src/lib/enrollment/aca-overview-assign.ts`
- Test: `src/lib/enrollment/aca-overview-assign.test.ts`

**Interfaces:**
- Produces: `applyAssign(rows, recordId, email)`, `revertAssign(rows, recordId, previous)`, `reconcileAssign(rows, recordId, updatedAt)`

Keeping this pure is what makes it testable at all — the components cannot be rendered under this repo's node-only Vitest.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { applyAssign, reconcileAssign, revertAssign } from "./aca-overview-assign";
import type { AcaOverviewActionRow } from "./aca-overview-types";

function row(id: string, responsible: string | null = null): AcaOverviewActionRow {
  return {
    recordId: id,
    taskId: `ENR-${id}`,
    clientName: id,
    agentEmail: null,
    responsibleEmail: responsible,
    callerEmail: null,
    stageLabel: "1-Need quote",
    daysInStage: 3,
    daysSilent: 3,
    sortDays: 3,
    stageAgeEstimated: false,
    updatedAt: "2026-08-12T09:30:00.000Z",
  };
}

describe("applyAssign", () => {
  it("removes the row, because an assigned record is no longer unassigned", () => {
    const rows = [row("a"), row("b")];
    expect(applyAssign(rows, "a", "p@x.com").map((r) => r.recordId)).toEqual(["b"]);
  });

  it("leaves other rows untouched", () => {
    const rows = [row("a"), row("b")];
    expect(applyAssign(rows, "missing", "p@x.com")).toHaveLength(2);
  });
});

describe("revertAssign", () => {
  it("puts the row back in its sorted position when the write fails", () => {
    const removed = row("b");
    const rows = [{ ...row("a"), sortDays: 9 }, { ...row("c"), sortDays: 1 }];
    const restored = revertAssign(rows, "b", { ...removed, sortDays: 5 });
    expect(restored.map((r) => r.recordId)).toEqual(["a", "b", "c"]);
  });

  it("does not duplicate a row that is already present", () => {
    const rows = [row("a")];
    expect(revertAssign(rows, "a", row("a"))).toHaveLength(1);
  });
});

describe("reconcileAssign", () => {
  it("adopts the server's updated_at so the next write is not stale", () => {
    const rows = [row("a")];
    const next = reconcileAssign(rows, "a", "2026-08-13T10:00:00.000Z");
    expect(next[0].updatedAt).toBe("2026-08-13T10:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/enrollment/aca-overview-assign.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { AcaOverviewActionRow } from "./aca-overview-types";

/** An assigned record leaves the unassigned list immediately. */
export function applyAssign(
  rows: readonly AcaOverviewActionRow[],
  recordId: string,
  _email: string
): AcaOverviewActionRow[] {
  return rows.filter((row) => row.recordId !== recordId);
}

/**
 * Restores a row after a failed write, in its sorted position rather than at the
 * end. Dropping it at the end would make a failed assign look like a successful
 * one that simply moved.
 */
export function revertAssign(
  rows: readonly AcaOverviewActionRow[],
  recordId: string,
  previous: AcaOverviewActionRow
): AcaOverviewActionRow[] {
  if (rows.some((row) => row.recordId === recordId)) return [...rows];
  return [...rows, previous].sort((first, second) => second.sortDays - first.sortDays);
}

/**
 * Adopts the timestamp the server returned. Without this, a second write
 * against the same row sends a stale `expected_updated_at` and 409s — which the
 * user experiences as "it worked once and then stopped working".
 */
export function reconcileAssign(
  rows: readonly AcaOverviewActionRow[],
  recordId: string,
  updatedAt: string
): AcaOverviewActionRow[] {
  return rows.map((row) => (row.recordId === recordId ? { ...row, updatedAt } : row));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/enrollment/aca-overview-assign.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/aca-overview-assign.ts src/lib/enrollment/aca-overview-assign.test.ts
git commit -m "feat(enrollment): add ACA overview optimistic assign reducer"
```

---

## Task 3: Assign picker component

**Files:**
- Create: `src/app/(authed)/enrollment/_components/aca/AcaAssignPicker.tsx`
- Modify: `src/app/(authed)/enrollment/_components/aca/AcaUnassigned.tsx`

**Interfaces:**
- Produces: `<AcaAssignPicker people value pending onAssign />`; `AcaUnassigned` gains `people`, `onAssign`, `pendingId`, `errorId`

- [ ] **Step 1: Write the picker**

```tsx
"use client";

import type { AcaOverviewPerson } from "@/lib/enrollment/aca-overview-types";
import { personLabel } from "@/lib/tasks/people";

export function AcaAssignPicker({
  people,
  pending,
  failed,
  onAssign,
}: {
  people: readonly AcaOverviewPerson[];
  pending: boolean;
  failed: boolean;
  onAssign: (email: string) => void;
}) {
  return (
    <span
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <select
        value=""
        disabled={pending}
        onChange={(event) => {
          const email = event.target.value;
          if (email) onAssign(email);
        }}
        className={`h-8 w-full rounded border bg-white px-2 text-xs font-bold outline-none disabled:opacity-50 ${
          failed ? "border-[#bf2600] text-[#bf2600]" : "border-[#cfd8e5] text-[#475467]"
        }`}
      >
        <option value="">{pending ? "Assigning…" : failed ? "Failed — retry" : "Assign to…"}</option>
        {people.map((person) => (
          <option key={person.email} value={person.email}>
            {person.name ?? personLabel(person.email)}
          </option>
        ))}
      </select>
    </span>
  );
}
```

The `stopPropagation` wrapper matters: each row is itself a button that opens the record, and without it choosing a person would also open the drawer.

- [ ] **Step 2: Add the column to `AcaUnassigned`**

Widen the grid by one column and add the header and cell:

```tsx
const GRID = "grid grid-cols-[7rem_minmax(10rem,1fr)_8rem_8rem_minmax(9rem,1fr)_7rem_10rem]";
```

Header: `<span>Assign to</span>` after `Days in stage`.

Cell, last in each row:

```tsx
<AcaAssignPicker
  people={people}
  pending={pendingId === row.recordId}
  failed={errorId === row.recordId}
  onAssign={(email) => onAssign(row, email)}
/>
```

Extend the component's props with `people: readonly AcaOverviewPerson[]`, `onAssign: (row: AcaOverviewActionRow, email: string) => void`, `pendingId: string | null`, `errorId: string | null`.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaAssignPicker.tsx" "src/app/(authed)/enrollment/_components/aca/AcaUnassigned.tsx"
git commit -m "feat(enrollment): add assign picker to the ACA unassigned table"
```

---

## Task 4: Wire the assign action

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/aca/AcaOverview.tsx`

**Interfaces:**
- Consumes: `applyAssign`, `revertAssign`, `reconcileAssign`

- [ ] **Step 1: Add the handler**

```tsx
const [unassigned, setUnassigned] = useState<AcaOverviewActionRow[]>([]);
const [pendingId, setPendingId] = useState<string | null>(null);
const [errorId, setErrorId] = useState<string | null>(null);
const [assignError, setAssignError] = useState<string | null>(null);

useEffect(() => {
  if (snapshot) setUnassigned(snapshot.unassigned);
}, [snapshot]);

const handleAssign = useCallback(
  async (row: AcaOverviewActionRow, email: string) => {
    setPendingId(row.recordId);
    setErrorId(null);
    setAssignError(null);
    setUnassigned((rows) => applyAssign(rows, row.recordId, email));
    try {
      const response = await fetch(`/api/enrollment/${row.recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_updated_at: row.updatedAt,
          patch: { responsible_enroll_email: email },
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { updated_at?: string; error?: string }
        | null;
      if (!response.ok) {
        // 409 means someone edited this record after the snapshot was taken.
        // Say so plainly: "refresh" is the actual fix, not a generic failure.
        throw new Error(
          response.status === 409
            ? "This record changed since the dashboard loaded. Refresh and try again."
            : payload?.error ?? "Could not assign."
        );
      }
      if (payload?.updated_at) {
        setUnassigned((rows) => reconcileAssign(rows, row.recordId, payload.updated_at!));
      }
    } catch (error) {
      setUnassigned((rows) => revertAssign(rows, row.recordId, row));
      setErrorId(row.recordId);
      setAssignError(error instanceof Error ? error.message : "Could not assign.");
    } finally {
      setPendingId(null);
    }
  },
  []
);
```

**Open `src/app/api/enrollment/[id]/route.ts` and confirm the exact request body shape before writing this** — the `expected_updated_at` / `patch` envelope above is the expected form, but use whatever the route actually parses.

Render `assignError` above the unassigned table as a dismissible banner, and pass `unassigned` (not `snapshot.unassigned`) plus `snapshot.assignablePeople`, `pendingId` and `errorId` into `AcaUnassigned`.

**Do not reload the snapshot after a successful assign.** The PATCH already fires `broadcastEnrollmentChanged` (`[id]/route.ts:531`), and the parent client subscribes to that channel — a second reload here would double-fetch. The optimistic removal keeps the table correct until the broadcast-driven refresh arrives.

- [ ] **Step 2: Verify the build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: PASS.

- [ ] **Step 3: See it running**

Open the ACA overview as a manager, assign an unassigned record, and confirm: the row disappears immediately, the person's `Holding` rises on the next refresh, and assigning a record that another tab just edited shows the refresh message rather than a silent failure.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaOverview.tsx"
git commit -m "feat(enrollment): assign records from the ACA overview"
```

---

## Task 5: Queue membership endpoint

**Files:**
- Create: `src/app/api/enrollment/aca-overview/queue-members/route.ts`

**Interfaces:**
- Produces: `PATCH { email, enabled }` against `enrollment_queue_members` (the table created by the data-layer plan's Task 11b)

**This must not touch `task_assignment_queue_members`.** That table is keyed on email with no program column, and the CS assignment RPC refuses to assign to a disabled member (`supabase/schema.sql:3171-3175`) — so disabling someone for enrollment would make them un-assignable for CS tasks.

- [ ] **Step 1: Write the route**

Mirror `src/app/api/tasks/assignment-queue/route.ts:10-58` — read it first and copy its auth, validation and error shape — changing three things: the table, the eligibility rule, and the broadcast.

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Same gate as the dashboard itself.
  if (!isManagerSession(session)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const enabled = typeof body?.enabled === "boolean" ? body.enabled : null;
  if (!email || enabled === null) {
    return NextResponse.json({ error: "email and enabled are required." }, { status: 400 });
  }

  // Enrollment eligibility is "an active portal account", not CS assignee
  // eligibility. Do not reuse isEligibleTaskAssigneeEmail here.
  const account = await getSupabaseAdmin()
    .from("portal_account")
    .select("email")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();
  if (enabled && (account.error || !account.data)) {
    return NextResponse.json({ error: `Not an active account: ${email}` }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("enrollment_queue_members")
    .upsert(
      { email, program: "aca", queue_enabled: enabled, updated_by_email: actorEmail, updated_at: nowIso },
      { onConflict: "email" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastEnrollmentChanged("aca");
  return NextResponse.json({ email, enabled, updatedAt: nowIso });
}
```

**Three things to confirm against the tree before writing:** the manager check used by the other enrollment routes (copy that helper rather than inventing `isManagerSession`), the real account table and active-flag names used by `src/lib/enrollment/queries.ts:263-271`, and `broadcastEnrollmentChanged`'s signature.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/enrollment/aca-overview/queue-members/route.ts"
git commit -m "feat(enrollment): add ACA queue membership endpoint"
```

---

## Task 6: Edit queue grid

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/aca/AcaQueue.tsx`
- Modify: `src/app/(authed)/enrollment/_components/aca/AcaOverview.tsx`

- [ ] **Step 1: Add the toggle grid**

Mirror the CS pattern at `CSWorkloadOverview.tsx:860-900`: an **Edit queue** button that reveals a checkbox grid of every assignable person, each calling the endpoint and reloading the snapshot on success.

```tsx
const [editing, setEditing] = useState(false);
const [updatingEmail, setUpdatingEmail] = useState<string | null>(null);
```

```tsx
{editing ? (
  <div className="border-y border-[#e6eaf0] bg-[#fbfdff] px-4 py-3">
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {people.map((person) => {
        const enabled = cards.some((card) => card.email === person.email);
        return (
          <label
            key={person.email}
            className={`flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm font-semibold ${
              enabled ? "border-[#b3d4ff] bg-white text-[#172b4d]" : "border-[#dfe3ea] bg-[#f4f5f7] text-[#667085]"
            }`}
          >
            <span className="min-w-0 truncate">{person.name ?? personLabel(person.email)}</span>
            <input
              type="checkbox"
              checked={enabled}
              disabled={updatingEmail === person.email}
              onChange={(event) => void onToggleMember(person.email, event.target.checked)}
              className="h-4 w-4 shrink-0 rounded border-[#c1c7d0] disabled:opacity-50"
            />
          </label>
        );
      })}
    </div>
  </div>
) : null}
```

Note the seeding consequence, which the spec flags in §12c.C: **a person toggled on has no assignment history and pins to position #1 until they receive a record.** That is the intended behaviour for a genuinely new worker. If it proves wrong in practice, the fix is to stamp `responsible_assigned_at`-equivalent state at enable time — do not paper over it in the sort.

- [ ] **Step 2: Add the handler in `AcaOverview`**

```tsx
const handleToggleMember = useCallback(
  async (email: string, enabled: boolean) => {
    const response = await fetch("/api/enrollment/aca-overview/queue-members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, enabled }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setAssignError(payload?.error ?? "Could not update the queue.");
      return;
    }
    // Membership changes the whole queue order, so a full reload is correct here
    // — unlike an assign, which only removes one row.
    await load();
  },
  [load]
);
```

- [ ] **Step 3: Verify the build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/aca/AcaQueue.tsx" "src/app/(authed)/enrollment/_components/aca/AcaOverview.tsx"
git commit -m "feat(enrollment): edit ACA assignment queue membership"
```

---

## Task 7: Changelog

- [ ] **Step 1: Append**

```markdown
## 2026-08-13 — ACA overview assignment

- Managers can assign an unassigned ACA record from the overview. It reuses the
  existing enrollment PATCH, so the per-record permission check and the
  optimistic-concurrency guard are unchanged; the snapshot now carries
  `updated_at` per row and adopts the server's value after each write, so a
  second assign on the same row cannot 409 on a stale timestamp.
- A 409 is reported as "this record changed since the dashboard loaded" rather
  than a generic failure, because refreshing is the actual fix.
- Added an enrollment-specific assignment-queue membership table and endpoint.
  It deliberately does not reuse the CS queue table: that one is keyed on email
  with no program, and the CS assignment RPC refuses disabled members, so a
  shared toggle would make someone un-assignable for CS tasks.
- No per-row permission fetch: the dashboard is manager-only, and managers hold
  `canAssignPeople` through the blanket grant regardless of record ownership.
```

- [ ] **Step 2: Commit**

```bash
git add changelog.md
git commit -m "docs: record ACA overview assignment surface"
```

## Codex implementation notes (2026-08-13)

- The queue endpoint uses `loadEnrollmentActor()` and `actor.isManager`,
  matching the repository's actual auth model; the illustrative
  `isManagerSession` helper is not introduced.
- Assignment responses are checked against the actual enrollment PATCH route
  envelope and response fields before wiring the optimistic reducer.

## Codex execution log

### Stage 5 — ACA assignment surface

- Commit: `0bb8db9`
- Added the manager-only assignment picker for unassigned overview rows,
  guarded by `expected_updated_at` and the existing enrollment PATCH contract.
- Added a pure assignment reducer helper and an enrollment-specific queue
  membership PATCH endpoint with active-account validation; CS queue state is
  not reused.
- Verification: `npm run typecheck`.
