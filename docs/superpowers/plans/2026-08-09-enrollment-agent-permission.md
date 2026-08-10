# Enrollment Agent/Assistant Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Enrollment the same agent/assistant permission model CS already has — list scoping by agent, a create gate, and per-action capabilities — reusing the existing `task_agents` / `agent_members` infrastructure rather than building anything new.

**Architecture:** Enrollment today has **one** permission gate (`canMutateEnrollmentRecord` = manager OR caller/responsible/creator) that guards every mutation equally, no create gate at all, and no list scoping. CS has a per-action resolver (`resolveTaskCapabilities`) plus a scoped list query. This plan mirrors that structure: a pure `resolveEnrollmentCapabilities` in `src/lib/enrollment/access.ts`, enforced by the API and consumed by the client so the two cannot drift.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (service-role), Vitest (node — pure logic only).

## Global Constraints

- **This is a breaking permission change.** Today anyone with `task.work` can create an enrollment record and any stakeholder can archive/QC. After this, create/archive/QC/assign require manager or agent-owner/assistant.
- ACA and Medicare share `EnrollmentClient.tsx` and every API route. Each change lands on both — **verify both**.
- **Do not change CS.** See "CS already satisfies the requirement" below; touching a working module for no reason is the larger risk.
- Never run `next build` while the dev server may be running.
- Only `origin` is pushed automatically; never `vercel`.
- Log the change in `agent-portal/changelog.md`, marked breaking.
- After every task: `npx tsc --noEmit`, `npx vitest run`, `rtk proxy npx eslint <touched files>` clean.
- **Prerequisite:** the sample-agents plan (`2026-08-09-enrollment-sample-agents.md`) must be run first. With `agent_email` NULL on every sample record, agent scoping cannot be tested at all.
- Reply to the user in Vietnamese, concise, when done.

## Codex review comments — 2026-08-09

> **[CODEX REVIEW — BLOCKER] Scope chỉ ở list query không phải security
> boundary.** Working tree hiện có nhiều đường đọc record theo ID chỉ check
> `loadEnrollmentActor()` rồi dùng service-role: `GET /api/enrollment/[id]`,
> `/detail`, `/activity`, `/comments`, `/attachments`, comment edit history,
> attachment delete; `enrollment/page.tsx` còn fallback
> `fetchEnrollmentRecordById(recordId)` cho deep link. Với
> `resolveEnrollmentCapabilities(...).canView = true` cho mọi worker, một
> agent/assistant bị scope khỏi list vẫn đọc được PII bằng UUID/deep link. Plan
> phải có actor-scope resolver dùng chung và enforce trên **mọi** read/mutation
> context, không chỉ `fetchEnrollmentRecords`.

> **[CODEX REVIEW — BLOCKER] Enrollment Overview mới hiện cũng unscoped.**
> `GET /api/enrollment/overview` gọi `fetchEnrollmentOverview(program)` và query
> toàn bộ records bằng service-role; response có record/client detail. UI Overview
> đang mở cho mọi enrollment worker. Phải truyền actor scope vào overview query /
> aggregation (và drilldown), hoặc giới hạn Overview cho manager.

> **[CODEX REVIEW — BLOCKER] Export phải giữ cùng row visibility.**
> `api/enrollment/export` hiện gọi unscoped `fetchEnrollmentRecords(program)`.
> Khi kết hợp với plan `export-permission`, agent/assistant có `task.export` có thể
> export toàn bộ hệ thống. Task 4 phải liệt kê export route là caller bắt buộc và
> có test gửi ID ngoài scope vẫn không xuất được.

> **[CODEX REVIEW — HIGH] `agent_email` chưa có rule rõ ràng.** Permission matrix
> chỉ ghi “Assign caller / responsible”, nhưng PATCH hiện cho sửa
> `agent_email`. Code đề xuất `touchesPeople` lại bỏ `agent_email`, khiến thay
> agent rơi vào `touchesOtherFields`; caller/responsible/creator có
> `canEditFields` sẽ tự chuyển record sang agent khác và thay đổi visibility.
> Owner phải quyết định riêng: manager-only hay agent-owner có thể transfer. Dù
> chọn gì, `agent_email` phải có capability riêng/ownership gate, không được tính
> là field edit thông thường.

> **[CODEX REVIEW — HIGH] Fail-open cho `agent_email IS NULL` không “identical to
> CS”.** `fetchTasksForActor()` không thêm `agent_email.is.null`; agent/assistant
> chỉ thấy own/assisted/assigned/participant tasks. Enrollment record chứa PII,
> nên cho mọi scoped agent thấy null-agent record là data overexposure. Nếu cần
> unassigned queue, giới hạn manager/plain-CS hoặc một permission explicit.

> **[CODEX REVIEW — HIGH] “Plain worker sees all, agent sees less” tạo privilege
> inversion.** Xoá một người khỏi `task_agents`/`agent_members` sẽ biến họ từ
> scoped actor thành plain worker và nhìn thấy toàn bộ records. Nếu giữ decision
> này để đồng bộ CS, rollout phải ghi accepted risk và test role-transition; với
> Enrollment PII nên cân nhắc explicit `enrollment.view_all`.

---

## The decided permission matrix

Owner decisions, 2026-08-09. This table is the specification — every task below implements a row of it.

| Action | manager | agent-owner / assistant | caller / responsible | creator |
|---|---|---|---|---|
| Edit record fields | ✅ | ✅ | ✅ | ✅ |
| Change stage | ✅ | ✅ | ✅ | — |
| Reopen from terminal (reason required) | ✅ | ✅ | ✅ | — |
| QC check | ✅ | ✅ | — | — |
| Assign caller / responsible | ✅ | ✅ | — | — |
| Archive | ✅ | ✅ | — | — |
| **Create a record** | ✅ | ✅ *(own agent only)* | — | — |

**List scoping** — identical rule to CS (`src/lib/tasks/queries.ts:43-53`):

| Viewer | Sees |
|---|---|
| manager | every record |
| plain worker (not an agent, not an assistant) | **every record** |
| agent or assistant | **only records whose `agent_email` is one of their agents** |

Yes, this narrows *agents*, not ordinary staff. It is counter-intuitive and it is the deliberate 2026-08-02 view-model decision that CS already implements.

**Null `agent_email` → fail open.** The owner's position is that `agent` is required so this cannot happen. It is required only as a `table_column` seed flag (`supabase/schema.sql:2986-2989`) that an admin can switch off in Config — there is **no `NOT NULL` on the column**. So the scoping code treats a null-agent record as visible to everyone. A record silently invisible to every agent is a far worse failure than one that is over-visible.

> **[CODEX REVIEW — OWNER CONFIRM REQUIRED] Hai premise đang mâu thuẫn: “cannot
> happen” nhưng schema/config cho phép xảy ra. Không được dùng UI-required flag
> làm security invariant. Codex khuyến nghị fail closed cho scoped
> agent/assistant và đưa null-agent vào manager/plain-CS unassigned queue; nếu
> vẫn fail open, ghi rõ đây là accepted PII exposure cùng owner/date trong plan.**

## Why CS is not being changed

The owner asked to update CS if it did not already allow the executing worker to change stage, and assistants to QC. It already does — verified:

- `isAgentOwnerOrAssistant()` (`src/lib/tasks/membership.ts:74-88`) returns true for the agent **and** for any `agent_members` row with `is_assistant = true`. Every CS rule receiving `isAgentOwner` therefore already includes assistants.
- `canChangeTaskStatus` = `manager || isAssignee || isAgentOwner` (`src/lib/tasks/access.ts:140-152`) — the assignee is the executing worker, and they can change status.
- `canReviewDoneTask` = `manager || isAgentOwner` (`:105-112`) — assistants included via the above.
- Reopen is `canChangeStatus` plus a mandatory reason via `ReasonModal`.

All three requirements are already met. **CS is out of scope.**

## Where Enrollment stands today

| Concern | Current state | Evidence |
|---|---|---|
| Mutation gate | One check for everything: manager OR caller/responsible/creator | `src/lib/enrollment/access.ts:26-33`, enforced at `src/app/api/enrollment/[id]/route.ts:123` |
| Create gate | **None.** Only `loadEnrollmentActor()` → `canAccessBoard` | `src/app/api/enrollment/route.ts:97` |
| Create button | Rendered unconditionally | `EnrollmentClient.tsx:~1141` |
| List scoping | **None.** Every record of the program, for everyone | `src/lib/enrollment/queries.ts:64-74` |
| Archive | manager OR creator | `access.ts:40-47` |
| Agent on record | `agent_email` column exists and is seeded `required` — but **no permission code reads it** | `access.ts:35-39` comment says so outright |

The infrastructure is fully reusable: `EnrollmentActor` is a type alias of `TaskActor`, and Enrollment already picks agents from the same `task_agents` roster.

---

### Task 1: Pure capability resolver

**Files:**
- Modify: `src/lib/enrollment/access.ts`
- Create: `src/lib/enrollment/capabilities.test.ts`

**Interfaces:**
- Produces:
  - `type EnrollmentMembershipFlags = { isAgentOwner?: boolean; isCaller?: boolean; isResponsible?: boolean; isCreator?: boolean }`
  - `type EnrollmentCapabilities = { canView; canEditFields; canChangeStage; canReopen; canReviewQC; canAssignPeople; canArchive: boolean }`
  - `resolveEnrollmentCapabilities(actor, flags): EnrollmentCapabilities`
  - `canCreateEnrollmentWithScope(actor, hasAgentScope): boolean`
- Consumed by Tasks 2, 3 and 5. This is the **single source of truth** — server and client both call it, exactly as CS does with `resolveTaskCapabilities`.

`isAgentOwner` folds in assistants, matching CS: the caller resolves it with `isAgentOwnerOrAssistant(record.agent_email, actor.email)`.

> **[CODEX REVIEW — REQUIRED REDESIGN] Các flags được đề xuất chưa đủ để tính
> `canView`: resolver không biết actor là plain worker (see-all) hay
> agent/assistant bị scope, cũng không biết record có thuộc allowed agent set hay
> không. Thêm scope context rõ ràng (ví dụ `seeAll`, `allowedAgentEmails`) và dùng
> cùng context cho list, overview, export, deep link và subroutes. Nếu vẫn trả
> `canView=true` cho mọi worker thì “single source of truth” trong Architecture
> là không đúng. Tránh gọi DB membership theo từng record; resolve scope một lần
> mỗi request rồi dùng in-memory/query filter.**

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/enrollment/capabilities.test.ts
import { describe, expect, it } from "vitest";
import {
  canCreateEnrollmentWithScope,
  resolveEnrollmentCapabilities,
  type EnrollmentActor,
} from "./access";

const manager: EnrollmentActor = { email: "m@x.com", isManager: true, isWorker: true };
const worker: EnrollmentActor = { email: "w@x.com", isManager: false, isWorker: true };
const outsider: EnrollmentActor = { email: "o@x.com", isManager: false, isWorker: false };

describe("resolveEnrollmentCapabilities — manager", () => {
  it("grants everything", () => {
    const caps = resolveEnrollmentCapabilities(manager, {});
    expect(caps).toEqual({
      canView: true,
      canEditFields: true,
      canChangeStage: true,
      canReopen: true,
      canReviewQC: true,
      canAssignPeople: true,
      canArchive: true,
    });
  });
});

describe("resolveEnrollmentCapabilities — agent owner or assistant", () => {
  it("grants every action on their agent's record", () => {
    const caps = resolveEnrollmentCapabilities(worker, { isAgentOwner: true });
    expect(caps.canEditFields).toBe(true);
    expect(caps.canChangeStage).toBe(true);
    expect(caps.canReopen).toBe(true);
    expect(caps.canReviewQC).toBe(true);
    expect(caps.canAssignPeople).toBe(true);
    expect(caps.canArchive).toBe(true);
  });
});

describe("resolveEnrollmentCapabilities — caller and responsible are workers", () => {
  // They do the collection work, so they edit fields and move the stage —
  // but they do not own the record, so no QC, no assigning, no archiving.
  for (const role of ["isCaller", "isResponsible"] as const) {
    it(`${role}: may edit fields, change stage and reopen`, () => {
      const caps = resolveEnrollmentCapabilities(worker, { [role]: true });
      expect(caps.canEditFields).toBe(true);
      expect(caps.canChangeStage).toBe(true);
      expect(caps.canReopen).toBe(true);
    });

    it(`${role}: may NOT QC, assign or archive`, () => {
      const caps = resolveEnrollmentCapabilities(worker, { [role]: true });
      expect(caps.canReviewQC).toBe(false);
      expect(caps.canAssignPeople).toBe(false);
      expect(caps.canArchive).toBe(false);
    });
  }
});

describe("resolveEnrollmentCapabilities — creator", () => {
  it("may edit fields but not move the workflow", () => {
    const caps = resolveEnrollmentCapabilities(worker, { isCreator: true });
    expect(caps.canEditFields).toBe(true);
    expect(caps.canChangeStage).toBe(false);
    expect(caps.canReopen).toBe(false);
    expect(caps.canReviewQC).toBe(false);
    expect(caps.canArchive).toBe(false);
  });
});

describe("resolveEnrollmentCapabilities — unrelated viewer", () => {
  it("may view but change nothing", () => {
    const caps = resolveEnrollmentCapabilities(worker, {});
    expect(caps.canView).toBe(true);
    expect(caps.canEditFields).toBe(false);
    expect(caps.canChangeStage).toBe(false);
    expect(caps.canReviewQC).toBe(false);
    expect(caps.canAssignPeople).toBe(false);
    expect(caps.canArchive).toBe(false);
  });

  it("denies everything to a non-worker", () => {
    const caps = resolveEnrollmentCapabilities(outsider, { isAgentOwner: true });
    expect(caps.canView).toBe(false);
    expect(caps.canEditFields).toBe(false);
  });
});

describe("canCreateEnrollmentWithScope", () => {
  it("allows a manager", () => {
    expect(canCreateEnrollmentWithScope(manager, false)).toBe(true);
  });

  it("allows a worker who owns or assists the target agent", () => {
    expect(canCreateEnrollmentWithScope(worker, true)).toBe(true);
  });

  it("denies a worker with no scope on that agent", () => {
    expect(canCreateEnrollmentWithScope(worker, false)).toBe(false);
  });

  it("denies a non-worker even with scope", () => {
    expect(canCreateEnrollmentWithScope(outsider, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/enrollment/capabilities.test.ts`
Expected: FAIL — `resolveEnrollmentCapabilities` and `canCreateEnrollmentWithScope` are not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/enrollment/access.ts` (keep the existing exports; Task 2 retires `canMutateEnrollmentRecord` afterwards):

```ts
// Mirrors CS's TaskMembershipFlags. `isAgentOwner` INCLUDES a promoted
// assistant — resolve it with isAgentOwnerOrAssistant(record.agent_email, …),
// exactly as the CS routes do.
export type EnrollmentMembershipFlags = {
  isAgentOwner?: boolean;
  isCaller?: boolean;
  isResponsible?: boolean;
  isCreator?: boolean;
};

export type EnrollmentCapabilities = {
  canView: boolean;
  canEditFields: boolean;
  canChangeStage: boolean;
  canReopen: boolean;
  canReviewQC: boolean;
  canAssignPeople: boolean;
  canArchive: boolean;
};

/**
 * Single source of truth for enrollment record permissions. The API enforces
 * these and the client renders from the same result, so the two cannot drift.
 *
 * Where this deliberately differs from CS: caller/responsible CAN edit fields.
 * In CS the assignee cannot edit content because the content is the brief
 * written by the reporter. In Enrollment the fields ARE the work product — the
 * person collecting the customer's information must be able to record it.
 */
export function resolveEnrollmentCapabilities(
  actor: EnrollmentActor,
  flags: EnrollmentMembershipFlags = {}
): EnrollmentCapabilities {
  if (actor.isManager) {
    return {
      canView: true,
      canEditFields: true,
      canChangeStage: true,
      canReopen: true,
      canReviewQC: true,
      canAssignPeople: true,
      canArchive: true,
    };
  }

  if (!actor.isWorker) {
    return {
      canView: false,
      canEditFields: false,
      canChangeStage: false,
      canReopen: false,
      canReviewQC: false,
      canAssignPeople: false,
      canArchive: false,
    };
  }

  const isOwner = Boolean(flags.isAgentOwner);
  // Caller and responsible are the people doing the collection work.
  const isDoingTheWork = Boolean(flags.isCaller) || Boolean(flags.isResponsible);

  return {
    // Enrollment is a shared view by product decision (2026-08-02): any worker
    // may read any record. Scoping happens at the list query, not here.
    canView: true,
    canEditFields: isOwner || isDoingTheWork || Boolean(flags.isCreator),
    canChangeStage: isOwner || isDoingTheWork,
    // Reopening is a stage change; the reason requirement is enforced
    // separately by the API and is not a permission question.
    canReopen: isOwner || isDoingTheWork,
    canReviewQC: isOwner,
    canAssignPeople: isOwner,
    canArchive: isOwner,
  };
}

/**
 * Create gate, mirroring CS's canCreateTaskWithScope. `hasAgentScope` means
 * the actor owns or assists the agent the new record is being created FOR —
 * resolve it with isAgentOwnerOrAssistant(requestedAgentEmail, actor.email).
 */
export function canCreateEnrollmentWithScope(
  actor: EnrollmentActor,
  hasAgentScope: boolean
): boolean {
  if (actor.isManager) return true;
  return actor.isWorker && hasAgentScope;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/enrollment/capabilities.test.ts` → PASS.
Run: `npx vitest run` → `FAIL (0)`, one more test file than baseline.
Run: `npx tsc --noEmit` → no errors (nothing consumes it yet).
Run: `rtk proxy npx eslint src/lib/enrollment/access.ts src/lib/enrollment/capabilities.test.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/access.ts src/lib/enrollment/capabilities.test.ts
git commit -m "feat(enrollment): add per-action capability resolver"
```

---

### Task 2: Enforce per-action capabilities in the PATCH route

**Files:**
- Modify: `src/app/api/enrollment/[id]/route.ts`

**Interfaces:**
- Consumes: `resolveEnrollmentCapabilities` (Task 1), `isAgentOwnerOrAssistant` from `@/lib/tasks/membership`.

The route currently has one gate at `:123`:

```ts
  if (!canMutateEnrollmentRecord(actorResult.actor, current)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

That check runs **before** the patch is parsed, so it cannot distinguish a field edit from an archive. The replacement resolves capabilities once, then checks each capability against what the request actually touches.

- [ ] **Step 1: Resolve membership and capabilities**

Replace the block above with:

```ts
  const [isAgentOwner] = await Promise.all([
    isAgentOwnerOrAssistant(current.agent_email, actorResult.actor.email),
  ]);
  const capabilities = resolveEnrollmentCapabilities(actorResult.actor, {
    isAgentOwner,
    isCaller: normalizeActorEmail(current.caller_email) === normalizeActorEmail(actorResult.actor.email),
    isResponsible:
      normalizeActorEmail(current.responsible_enroll_email) ===
      normalizeActorEmail(actorResult.actor.email),
    isCreator:
      normalizeActorEmail(current.created_by_email) ===
      normalizeActorEmail(actorResult.actor.email),
  });
  if (!capabilities.canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

⚠️ `normalizeActorEmail` does not exist yet. `access.ts` has a private `normalizeEmail` (`:61-63`) doing `email?.trim().toLowerCase() ?? ""`. **Export it** from `access.ts` under a clear name and import it here rather than writing a second copy — the existing `isDirectEnrollmentStakeholder` already relies on that exact normalisation and the two must not diverge.

- [ ] **Step 2: Gate each action against what the body touches**

After `resolved.patch` is built and **before** the database update, add:

```ts
  // Per-action enforcement. The patch is inspected AFTER parsing so a field
  // edit, a stage move, an assignment and a QC toggle are judged separately —
  // the old single gate treated them all as one permission.
  const touchesStage = "stage_id" in resolved.patch;
  const touchesPeople =
    "caller_email" in resolved.patch || "responsible_enroll_email" in resolved.patch;
  const touchesQc = qcChecked !== null;
  const touchesOtherFields = Object.keys(resolved.patch).some(
    (key) =>
      key !== "stage_id" &&
      key !== "caller_email" &&
      key !== "responsible_enroll_email" &&
      key !== "closed_at" &&
      key !== "qc_checked_by_email" &&
      key !== "qc_checked_at" &&
      key !== "qc_stale_notified_at" &&
      key !== "updated_at" &&
      key !== "updated_by_email"
  );

  if (touchesOtherFields && !capabilities.canEditFields) {
    return NextResponse.json({ error: "You cannot edit this record." }, { status: 403 });
  }
  if (touchesPeople && !capabilities.canAssignPeople) {
    return NextResponse.json(
      { error: "You cannot change who owns this record." },
      { status: 403 }
    );
  }
  if (touchesQc && !capabilities.canReviewQC) {
    return NextResponse.json({ error: "You cannot QC check this record." }, { status: 403 });
  }
  if (touchesStage) {
    const allowed = reopening ? capabilities.canReopen : capabilities.canChangeStage;
    if (!allowed) {
      return NextResponse.json(
        { error: "You cannot change this record's stage." },
        { status: 403 }
      );
    }
  }
```

> **[CODEX REVIEW — BLOCKER] Working tree dùng biến `patch`, không có
> `resolved.patch`; snippet này có vẻ lấy từ revision cũ và sẽ không compile nếu
> copy nguyên. Quan trọng hơn, phải phân loại `agent_email` bằng ownership
> capability riêng theo decision đã chốt. Không để agent transfer được authorize
> bởi `canEditFields`. Thêm route test cho caller/creator cố đổi `agent_email`.**

⚠️ Place this **after** `reopening` is computed (`:179-180`) and after `qcChecked` (`:204-205`), since both are referenced. Re-read the surrounding code to find the exact insertion point rather than trusting these line numbers — this route was heavily edited in the go-live batch.

⚠️ The excluded keys in `touchesOtherFields` are fields the route sets *itself* as a consequence of a stage or QC change (`closed_at`, the three `qc_*`, and the two audit columns). Including them would make every stage change also demand `canEditFields`. Verify the list against `resolved.patch`'s actual writers before finalising.

- [ ] **Step 3: Gate DELETE (archive) the same way**

The DELETE handler currently uses `canArchiveEnrollmentRecord` (manager OR creator). Replace with the capability:

```ts
  const isAgentOwner = await isAgentOwnerOrAssistant(
    currentData.agent_email,
    actorResult.actor.email
  );
  const capabilities = resolveEnrollmentCapabilities(actorResult.actor, { isAgentOwner });
  if (!capabilities.canArchive) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

⚠️ The DELETE handler's `select` currently fetches `"id,caller_email,responsible_enroll_email,created_by_email"` — it does **not** fetch `agent_email`. Add it to that select, or the check silently receives `undefined` and denies everyone but managers.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npx vitest run` → unchanged from Task 1.
Run: `rtk proxy npx eslint "src/app/api/enrollment/[id]/route.ts"` → clean.
Run: `rtk proxy grep -n "canMutateEnrollmentRecord\|canArchiveEnrollmentRecord" src/` → only the definitions in `access.ts` remain. If nothing else references them, delete both and their tests in `access.test.ts`; if something does, leave them and note why.

> **[CODEX REVIEW — HIGH] Hiện `canMutateEnrollmentRecord` còn được dùng ở
> attachment upload, và comment/attachment/detail/activity contexts chỉ check
> board access. Không được xoá helper rồi để các route đó unguarded. Task này cần
> inventory toàn bộ route dưới `api/enrollment/[id]` và map read/comment/upload/
> delete-attachment vào capability/visibility cụ thể, kèm route tests.**

- [ ] **Step 5: Manual check** (dev server already running)

On **both** programs, as a worker who is neither agent, assistant, caller, responsible nor creator: open a record — fields are rejected with 403 on edit, and stage/QC/assign/archive are all refused. As the responsible: field edit and stage change succeed; QC and archive return 403.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/enrollment/[id]/route.ts" src/lib/enrollment/access.ts
git commit -m "feat(enrollment): enforce per-action permissions on record mutations"
```

---

### Task 3: Add the create gate

**Files:**
- Modify: `src/app/api/enrollment/route.ts`

**Interfaces:**
- Consumes: `canCreateEnrollmentWithScope` (Task 1), `isAgentOwnerOrAssistant`.

`POST /api/enrollment` has **no create gate** — only `loadEnrollmentActor()` at `:97`. Mirror CS's `/api/tasks/route.ts:102-118`.

- [ ] **Step 1: Add the gate after `agent_email` is resolved**

The route already extracts and validates `agent_email` (it is in `STRING_FIELDS`, and `:148-158` validates ownership eligibility). Immediately **after** the agent value is known and validated, insert:

```ts
  // Create gate, mirroring CS (/api/tasks/route.ts:102-118): a manager, or a
  // worker who owns or assists the agent this record is being created FOR.
  const requestedAgentEmail = patch.agent_email as string | null;
  const hasAgentScope = actorResult.actor.isManager
    ? false
    : await isAgentOwnerOrAssistant(requestedAgentEmail, actorResult.actor.email);
  if (!canCreateEnrollmentWithScope(actorResult.actor, hasAgentScope)) {
    return NextResponse.json(
      { error: "You cannot create enrollment records for this agent." },
      { status: 403 }
    );
  }
```

⚠️ `agent` is a required column by seed, but an admin can turn that off in Config. If `requestedAgentEmail` is null, `isAgentOwnerOrAssistant` returns `false` (it short-circuits on a falsy agent, `membership.ts:78`), so a non-manager cannot create an agent-less record. That is the intended outcome — do not add a null bypass.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npx vitest run` → unchanged.
Run: `rtk proxy npx eslint src/app/api/enrollment/route.ts` → clean.

Manual, on both programs:
- Manager: create succeeds for any agent.
- Agent: succeeds for **their own** agent, 403 for another agent.
- Assistant: same as their agent.
- Plain worker: 403 regardless of agent.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/enrollment/route.ts
git commit -m "feat(enrollment): restrict record creation to managers and agent scope"
```

---

### Task 4: Scope the list query

**Files:**
- Modify: `src/lib/enrollment/queries.ts`
- Modify: every caller of `fetchEnrollmentRecords` (at minimum `src/app/(authed)/enrollment/page.tsx` and `src/app/api/enrollment/route.ts` GET)

**Interfaces:**
- `fetchEnrollmentRecords(program)` becomes `fetchEnrollmentRecords(program, actor)`. The compiler will enumerate every call site.

Mirror `fetchTasksForActor` (`src/lib/tasks/queries.ts:25-63`) exactly:

> **[CODEX REVIEW — CORRECTION] Không thể gọi là mirror “exactly”: proposed
> Enrollment OR có `agent_email.is.null`, còn CS không có. CS scope còn cho
> assignee/participant task; Enrollment model không có hai nhánh đó. Ghi đây là
> policy mới dựa trên CS infrastructure, không phải identical behavior.**

- [ ] **Step 1: Add the scope branch**

Inside `fetchEnrollmentRecords`, after the base query is built and before it is awaited:

```ts
  // Scope mirrors CS (lib/tasks/queries.ts:43-53): managers and PLAIN workers
  // see the whole program; an agent or assistant sees only their agents'
  // records. Narrowing agents rather than ordinary staff is the deliberate
  // 2026-08-02 view-model decision.
  let seeAll = actor.isManager;
  if (!actor.isManager) {
    const [selectedAgentEmails, assistantAgents] = await Promise.all([
      fetchSelectedAgentEmails(),
      fetchAssistantAgentsForCs(actor.email),
    ]);
    const isAgent = selectedAgentEmails.has(actor.email);
    const isAssistant = assistantAgents.length > 0;
    seeAll = !isAgent && !isAssistant;

    if (!seeAll) {
      const agents = [
        ...new Set([
          ...(isAgent ? [actor.email] : []),
          ...assistantAgents,
          ...(await fetchAgentsForCs(actor.email)),
        ]),
      ];
      // Fail OPEN on a null agent: `agent` is required only as a Config flag,
      // not a NOT NULL constraint. A record invisible to every agent is worse
      // than one that is over-visible.
      const ors = ["agent_email.is.null"];
      if (agents.length > 0) {
        ors.push(
          `agent_email.in.(${agents.map(quotePostgrestFilterValue).join(",")})`
        );
      }
      query = query.or(ors.join(","));
    }
  }
```

⚠️ Import `quotePostgrestFilterValue` from `@/lib/tasks/queries` — it already exists there (added to escape identities into PostgREST filter grammar). Do **not** interpolate raw emails.

⚠️ `fetchEnrollmentRecords` currently uses a loose `LooseSupabaseQueryBuilder` cast whose type does not include `.or()`. Widen that local type rather than casting to `any`.

> **[CODEX REVIEW — BLOCKER] `fetchEnrollmentRecords` có ba fallback query
> (missing description, missing custom_values). Scope phải được áp lại cho mọi
> fallback giống `fetchTasksForActor`; nếu chỉ scope base query thì environment
> schema cũ sẽ silently trả toàn bộ records. Tách helper `applyEnrollmentScope`
> để không copy OR string và thêm test cho primary + legacy fallback.**

- [ ] **Step 2: Thread the actor through every caller**

Run `npx tsc --noEmit` and fix each reported call site by passing the actor that is already in scope (`buildTaskActor(...)` in the page, `actorResult.actor` in the route). Do not construct a new actor.

> **[CODEX REVIEW — REQUIRED CALLERS] Compiler hiện sẽ tìm page, GET collection
> và export route. Nhưng typecheck không tự tìm raw service-role query trong
> `overview-data.ts` hay các by-id/subresource routes. Bổ sung checklist explicit:
> overview, page deep-link fallback, base by-id GET/PATCH/DELETE, detail,
> activity, comments + edit history, attachments + delete. Prefer một shared
> `loadScopedEnrollmentRecordContext` để không sót route về sau.**

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npx vitest run` → unchanged.

Manual, on both programs, **after** the sample-agents plan has run:
- Manager: sees every record.
- Plain worker: sees every record.
- Agent: sees only records whose `agent_email` is theirs, **plus** any null-agent record.
- Assistant: sees their agent's records.
- Counter-check with SQL that the agent's visible count matches `select count(*) from enrollment_records where program = … and archived_at is null and (agent_email = '<agent>' or agent_email is null)`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/enrollment/queries.ts "src/app/(authed)/enrollment/page.tsx" src/app/api/enrollment/route.ts
git commit -m "feat(enrollment): scope record list by agent membership"
```

---

### Task 5: Client consumes the same capabilities

**Files:**
- Modify: `src/app/(authed)/enrollment/page.tsx`
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

**Interfaces:**
- Consumes: `resolveEnrollmentCapabilities` (Task 1).
- The page resolves membership server-side and passes it down; the client must **not** re-derive permissions from raw emails.

Today the client has its own `canEditEnrollmentRecordClient` and `canArchiveEnrollmentRecordClient` (`EnrollmentClient.tsx:409-431`) that duplicate the server rule. They now under-grant (no agent concept) and must be replaced by the shared resolver.

- [ ] **Step 1: Pass agent membership from the server**

In `enrollment/page.tsx`, alongside the existing fetches, resolve the viewer's agent scope once:

```ts
    fetchAgentsForCs(email),
    fetchAssistantAgentsForCs(email),
```

and pass both to `<EnrollmentClient>` as `myAgents` and `myAssistantAgents`, mirroring how `tasks/page.tsx` feeds `TaskBoardClient` (`:98-99`).

- [ ] **Step 2: Replace the two client predicates**

Delete `canEditEnrollmentRecordClient` and `canArchiveEnrollmentRecordClient`, and add one helper that builds flags then calls the shared resolver:

```tsx
  const isAgentOwnerOrAssistantOf = (agentEmail: string | null) =>
    Boolean(
      agentEmail &&
        (agentEmail === currentEmail || myAssistantAgents.includes(agentEmail))
    );

  function capabilitiesFor(record: EnrollmentRecordWithStats) {
    return resolveEnrollmentCapabilities(
      { email: currentEmail, isManager: canManageOptions, isWorker: true },
      {
        isAgentOwner: isAgentOwnerOrAssistantOf(record.agent_email),
        isCaller: normalizeEnrollmentEmail(record.caller_email) === normalizeEnrollmentEmail(currentEmail),
        isResponsible:
          normalizeEnrollmentEmail(record.responsible_enroll_email) ===
          normalizeEnrollmentEmail(currentEmail),
        isCreator:
          normalizeEnrollmentEmail(record.created_by_email) ===
          normalizeEnrollmentEmail(currentEmail),
      }
    );
  }
```

`normalizeEnrollmentEmail` already exists in this file (`:411-413`) — reuse it.

- [ ] **Step 3: Bind controls to capabilities, not to one boolean**

Every place currently passing `canEdit={canEditRecord}` gets the capability that actually matches the control:

| Control | Capability |
|---|---|
| Client name, FUB, description, PCP, custom fields | `canEditFields` |
| Stage pill | `canChangeStage` |
| QC button | `canReviewQC` |
| Caller / Responsible person menus | `canAssignPeople` |
| Archive button | `canArchive` |
| Reopen action | `canReopen` |

⚠️ `canEdit` defaults to `true` on the shared menu components. In the **Create dialog** there is no record yet, so leave those call sites at the default — do not pass a record-derived capability there.

- [ ] **Step 4: Hide the create button**

Mirror `TaskBoardClient.tsx:1486` (`canCreateTasks = isManager || canManageOwnAgentGroup`):

```tsx
  const canCreateRecords =
    canManageOptions || myAgents.length > 0 || myAssistantAgents.length > 0;
```

> **[CODEX REVIEW — BUG] Công thức này ẩn nút với agent owner bình thường.
> `fetchAgentsForCs(email)`/`fetchAssistantAgentsForCs(email)` đều query
> `agent_members` theo `cs_email`; một người nằm trong `task_agents` nhưng không
> assist ai sẽ có cả hai array rỗng. Phải thêm
> `agents.some(agent => normalize(agent.email) === normalize(currentEmail))` hoặc
> truyền `isSelectedAgent` từ server.**

> **[CODEX REVIEW — HIGH] Không chỉ hide button: Create dialog đang nhận toàn bộ
> `agents`. Với non-manager, filter picker xuống own + assisted agents; nếu không
> UI cho chọn agent ngoài scope rồi API trả 403. Tương tự, nếu agent transfer
> được phép trong edit UI thì option list cũng phải scope theo capability/policy.**

and wrap the "New enrollment" button (`~:1141`) in `{canCreateRecords ? … : null}`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npx vitest run` → unchanged.
Run: `rtk proxy npx eslint "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" "src/app/(authed)/enrollment/page.tsx"` → clean.
Run: `rtk proxy grep -n "canEditEnrollmentRecordClient\|canArchiveEnrollmentRecordClient" src/` → no output.

Manual matrix, on **both** programs — for each of manager / agent / assistant / caller / responsible / creator / unrelated worker, confirm the visible controls match the decided matrix, and that **no disabled-looking control still issues a request** (open DevTools Network and confirm no 403s are produced by clicking).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(authed)/enrollment/page.tsx" "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "feat(enrollment): render controls from shared capability resolver"
```

---

### Task 6: Impact measurement and rollout

**Files:** none modified.

- [ ] **Step 1: Count who loses what — run BEFORE deploying**

```sql
-- People who can mutate a record today but will lose create/archive/QC/assign.
select count(distinct e.email) as people_affected,
       count(*) as open_records_affected
from enrollment_records r
cross join lateral (values
  (r.caller_email), (r.responsible_enroll_email), (r.created_by_email)
) as e(email)
where r.archived_at is null
  and r.closed_at is null
  and e.email is not null
  and e.email not in (select email from task_agents)
  and e.email not in (select cs_email from agent_members where is_assistant);
```

If the number is large, tell the team before deploying rather than after.

> **[CODEX REVIEW — HIGH] SQL trên không đo đúng hai cột đã đặt tên.**
> `count(*)` đếm stakeholder rows (tối đa 3 mỗi record), không phải distinct open
> records; query cũng không loại manager và coi một người là “assistant” toàn cục
> dù họ có thể chỉ assist agent khác với `r.agent_email`. Hãy trả
> `count(distinct r.id)`, join role/permission để loại manager, và correlate
> `agent_members.agent_email = r.agent_email AND cs_email = e.email`. Create
> impact là account-level concern riêng, không thể suy ra từ stakeholder rows
> hiện tại.**

- [ ] **Step 2: Confirm no record is orphaned by scoping**

```sql
select program, count(*) filter (where agent_email is null) as null_agent
from enrollment_records
where archived_at is null
group by program;
```

Expected `0` after the sample-agents plan. If not zero, those records are visible to everyone by the fail-open rule — acceptable, but know the number.

> **[CODEX REVIEW] Không mặc định ghi “acceptable” trước khi owner xác nhận
> accepted PII risk ở phần trên. Rollout nên block hoặc đưa null records vào hàng
> unassigned giới hạn quyền. Sample-agent script chỉ sửa sample records, nên cũng
> không thể làm expected `0` cho toàn bộ real records.**

- [ ] **Step 3: Changelog**

Add an entry at the top of `## Unreleased`, marked **breaking**: Enrollment now uses the CS agent/assistant model — the record list is scoped for agents and assistants (managers and plain workers still see everything); creating a record requires manager or agent scope; archive, QC and assigning people now require manager or agent-owner/assistant; caller, responsible and creator keep field editing, and caller/responsible keep stage changes and reopen. Record the exact matrix. Note that CS was verified as already compliant and was **not** changed.

```bash
git add agent-portal/changelog.md
git commit -m "docs(changelog): record enrollment agent permission model"
```

---

## Self-Review

**Spec coverage.** B1 (scope like CS) → Task 4. B2 (null agent) → the fail-open branch in Task 4 Step 1 plus the Task 6 Step 2 count. B3 (create gate) → Task 3. B4 (per-action matrix, caller = worker) → Task 1's resolver, enforced in Task 2, rendered in Task 5. C-side export is a separate plan. The "update CS too" request is answered by the "Why CS is not being changed" section with evidence.

> **[CODEX REVIEW — CORRECTION] Spec coverage chưa đủ cho tới khi Task 4 bao
> phủ overview, export, deep links và toàn bộ by-id subroutes. Export không thể
> coi là “separate” ở tầng row authorization: permission key thuộc plan khác,
> nhưng record scope phải do plan này cung cấp và export bắt buộc reuse nó.**

**Placeholder scan.** No TBD. Every code step carries code; every rollout step carries SQL. Three places say "re-read before editing" — those are deliberate, because the PATCH route was heavily rewritten in the go-live batch and its line numbers are the least trustworthy in the repo.

**Type consistency.** `resolveEnrollmentCapabilities(actor, flags)`, `EnrollmentCapabilities`, `EnrollmentMembershipFlags`, `canCreateEnrollmentWithScope(actor, hasAgentScope)` are spelled identically in the test, the implementation, and all three consumers. Capability names (`canEditFields`, `canChangeStage`, `canReopen`, `canReviewQC`, `canAssignPeople`, `canArchive`) are identical in Task 1's type, Task 2's guards and Task 5's binding table.

**Risks deliberately front-loaded.**
- *The DELETE handler does not select `agent_email`.* Called out in Task 2 Step 3 — missing it silently denies everyone but managers, and typecheck would not catch it.
- *Over-broad `touchesOtherFields`.* If the exclusion list is wrong, every stage change also demands `canEditFields` and workers are locked out. Task 2 Step 2 requires verifying the list against the actual patch writers.
- *Client and server drifting.* Both call the same pure resolver; Task 5 explicitly deletes the two duplicate client predicates rather than leaving them.
- *Scoping with no agents on records.* The plan will not work at all until the sample-agents plan has run; stated as a prerequisite in Global Constraints.
- *Disabled UI that still fires requests.* Task 5 Step 5 requires watching the Network tab, because a control that looks disabled but still POSTs produces the A→B→A revert this codebase has already been bitten by.

**Sequencing.** Task 1 → 2 → 3 → 4 → 5 → 6. Tasks 2 and 3 are independent of each other but both need Task 1. Task 5 needs Task 1 and reads better after Task 4. **The sample-agents plan must run before Task 4 can be tested.**

> **[CODEX REVIEW] Sample-agent backfill chỉ cần cho manual test bằng sample DB,
> không nên chặn việc ship automated security tests/fix. Ngược lại, export
> permission không được grant cho scoped actors trước khi row-scope coverage ở
> Task 4 hoàn tất.**
