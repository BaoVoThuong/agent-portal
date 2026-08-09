# Enrollment Permission & Export — Final Consolidated Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Supersedes** `2026-08-09-enrollment-sample-agents.md`, `2026-08-09-enrollment-agent-permission.md`, and `2026-08-09-export-permission.md`. Those three were reviewed by Codex on 2026-08-09; every accepted finding is folded in here. Do not execute the originals.

**Goal:** Port the CS agent/assistant model to Enrollment as a **real security boundary** (not just a filtered list), gate record creation, and move export behind an explicit `task.export` permission — without breaking the people who do the collection work.

**Architecture:** One pure resolver (`src/lib/enrollment/access.ts`) owns every permission decision. One scope resolver (`src/lib/enrollment/scope.ts`) owns "which records may this actor touch". Every read-by-ID route, the list query, the overview query and the export route consult them; the client renders from the same resolver so server and UI cannot drift.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (service-role), NextAuth v5, Vitest (node — pure logic only, no jsdom).

---

## 1. What the Codex review changed

I got things wrong in the three original plans. Recording them plainly, because each one changes the work.

| # | My original claim | Reality (verified 2026-08-09) | Consequence |
|---|---|---|---|
| 1 | Scoping `fetchEnrollmentRecords` gives agent scoping | **Wrong — not a security boundary.** `GET /api/enrollment/[id]`, `/detail`, `/activity`, `/comments`, `/attachments`, comment-edit history, attachment delete, and `enrollment/page.tsx`'s deep-link fallback `fetchEnrollmentRecordById()` all authenticate with `loadEnrollmentActor()` only, then read with the service role | A scoped agent reads any record's PII by UUID. **Phase 1 Task 3 exists for this.** |
| 2 | *(not considered)* | `GET /api/enrollment/overview` → `fetchEnrollmentOverview(program, …)` queries every record unscoped and returns client detail | Overview leaks the same PII. **Phase 1 Task 5.** |
| 3 | *(not considered)* | `api/enrollment/export/route.ts:82` calls `fetchEnrollmentRecords(program)` unscoped | An agent with `task.export` exports the whole system. **Phase 2 must land after Phase 1.** |
| 4 | *(not considered)* | `agent_email` is in `TEXT_FIELDS` (`api/enrollment/[id]/route.ts:54`) — PATCH can change it | Under my matrix, anyone with `canEditFields` could **transfer a record to another agent and change who can see it**. Needs its own capability — `canTransferAgent`, **resolved** in §3. |
| 5 | Null-`agent_email` fail-open is "identical to CS" | **Wrong.** `fetchTasksForActor` (`src/lib/tasks/queries.ts:43-63`) never adds `agent_email.is.null` | Fail-open would expose PII to every scoped agent. **Now fail-closed** — §3. |
| 6 | "Plain worker sees all, agent sees less" is fine because CS does it | True that CS does it, but it is a **privilege inversion**: removing someone from `task_agents` *widens* their view | Kept for CS parity, but recorded as an accepted risk with a required role-transition test — §3. |
| 7 | Adding the key to the `permissions` seed is enough for `Admin` | **Wrong.** The catalogue `insert` and the `cross join role_permissions` insert (`supabase/schema.sql:286-291`) are **separate statements** | Running only the catalogue insert grants nobody. **Phase 2 Task 4 ships explicit idempotent SQL.** |
| 8 | Export call sites use `canExportImport` | Stale — they use `canExport` (`tasks/page.tsx:48,104`; `enrollment/page.tsx:53,92`) | Corrected throughout. |
| 9 | Add `auth()` in the export routes | `loadEnrollmentActor()` already calls `auth()` | Two auth contexts per request. **Extend the loader instead** — Phase 2 Task 2. |
| 10 | Seed assistants by picking active non-agent accounts | That is a **permission mutation on real users**, and could promote an Admin or flip an existing `is_assistant=false` row | **Allow-list + dry-run + non-production guard** — Phase 0 Task 2. |
| 11 | Read the roster from `task_agents` | `validateEnrollmentOwnership()` intersects `task_agents` with **active** `portal_account`; a stale agent row would be seeded but rejected by the app | Roster loader must intersect — Phase 0 Task 1. |
| 12 | Backfill: read all null-agent rows, filter prefix in Node; `indexByLink.get(link) ?? 0` | Pulls non-sample PII to the client, and `?? 0` silently assigns the first agent to any unknown sample-prefixed link | Server-side filter + `continue` on unknown link — Phase 0 Task 1. |
| 13 | Assignment is "deterministic" | Only for a **fixed roster** — adding an agent reshuffles a fresh seed | Wording corrected; backfill is unaffected because it only fills nulls. |

**Codex findings I did not adopt as stated:** only finding 6. The owner confirmed on 2026-08-09 that people are not removed from `task_agents` in practice, so the scenario does not arise; it is documented in §3 for future readers and needs no mitigation work.

## 2. Owner decisions already made — do not revisit

| Topic | Decision |
|---|---|
| Model | Port CS's agent/assistant model to Enrollment |
| Edit rights | Option **B** (replace), softened by "caller = worker" — see the matrix in §3 |
| Create | manager + agent-owner + assistant; agent/assistant only for **their own** agent |
| Stage change | Workers do the work, so they change stage |
| QC | manager + agent-owner + assistant |
| Reopen | Workers may, reason required |
| CS | **Not changed** — verified already compliant, §4 |
| Export permission | **One** key, shared; **required** (manager status alone insufficient); seeded to `Admin`, granted by hand to `Admin Health Task` |
| Sample data | Fill existing samples, samples only, even round-robin, plus assistants |

## 3. The permission model

### Record capabilities

| Action | manager | agent-owner / assistant | caller / responsible | creator |
|---|---|---|---|---|
| View record | ✅ | ✅ *(their agents only)* | ✅ | ✅ |
| Edit main content *(Client/FUB/Description)* | ✅ | ✅ | — | ✅ |
| Edit enrollment fields *(except agent)* | ✅ | ✅ | ✅ | ✅ |
| Change stage | ✅ | ✅ | ✅ | — |
| Reopen from terminal *(reason required)* | ✅ | ✅ | ✅ | — |
| QC check | ✅ | ✅ | — | — |
| Assign caller / responsible | ✅ | ✅ | — | — |
| Archive | ✅ | ✅ | — | — |
| **Transfer `agent_email`** | ✅ | ✅ | — | ✅ |
| **Create a record** | ✅ | ✅ *(own agent only)* | — | — |

> ### D1 — RESOLVED 2026-08-09: manager + agent-owner/assistant + creator
>
> `agent_email` is editable through PATCH today, and changing it **moves the record into a different agent's visibility scope**. Codex was right that it must not be an ordinary field edit — it gets its own capability, `canTransferAgent`, checked separately and first.
>
> **Who gets it is settled by CS precedent, which I failed to check when first recommending manager-only.** In CS, `agent_email` sits in `CONTENT_PATCH_KEYS` (`src/app/api/tasks/[id]/route.ts:47-55`) and is gated by `canEditContent` (`:72`) = `canMutateTask` = `manager || isAgentOwner || isReporter`. So CS already permits **manager + agent-owner/assistant + the task's creator** to move a task between agents, accepting the same visibility consequence.
>
> This is therefore the faithful port the owner asked for, and it is still far narrower than the hole Codex identified: **caller and responsible do not get it**, even though they hold `canEditFields`. That separation is the whole point of the dedicated capability.

**Which roles do NOT get `canTransferAgent`:** caller and responsible. They collect information; they do not decide which agent owns the customer.

### Visibility scope

| Viewer | Sees |
|---|---|
| manager | every record |
| plain worker (not an agent, not an assistant) | every record |
| agent or assistant | **only** records whose `agent_email` is one of their agents |

**Null `agent_email` → fail CLOSED for scoped agents.** They are visible to managers and plain workers only, as an unassigned pool. Rationale: `agent` is required only as a `table_column` seed flag (`supabase/schema.sql:2986-2989`) that Config can switch off — there is **no `NOT NULL`** on the column, so a UI flag must not be used as a security invariant. The owner's position is that null cannot occur; if that holds, this branch never fires and costs nothing. If it does not hold, fail-closed leaks nothing.

**Documented behaviour, no action required.** Because plain workers see everything and agents are scoped, removing someone from `task_agents` / `agent_members` would *widen* their visibility rather than narrow it. Codex flagged this; the owner confirmed on 2026-08-09 that agents are not removed from the roster in practice, so no mitigation is planned. Recorded here only so a future reader is not surprised by the rule. This is inherited from the 2026-08-02 view model that CS already implements.

## 4. Why CS is not changed

The owner asked to update CS if the executing worker could not change stage and assistants could not QC. Both already work:

- `isAgentOwnerOrAssistant()` (`src/lib/tasks/membership.ts:74-88`) returns true for the agent **and** any `agent_members` row with `is_assistant = true`, so every CS rule taking `isAgentOwner` already includes assistants.
- `canChangeTaskStatus` = `manager || isAssignee || isAgentOwner` (`src/lib/tasks/access.ts:140-152`).
- `canReviewDoneTask` = `manager || isAgentOwner` (`:105-112`).
- Reopen = `canChangeStatus` + mandatory reason via `ReasonModal`.

**CS is out of scope.** Touching a working permission module without a defect is the larger risk.

## 5. Global constraints

- **Breaking change.** Today any `task.work` holder creates records and any stakeholder archives/QCs; export follows manager status. All three change.
- ACA and Medicare share `EnrollmentClient.tsx` and every route — **verify both, every time**.
- **Phase order is mandatory:** 0 → 1 → 2. Phase 2 (export) must not ship before Phase 1 Task 4, or `task.export` becomes a system-wide data-egress hole (finding 3).
- Never run `next build` while the dev server may be running.
- Only `origin` is pushed automatically; never `vercel`.
- Log each phase in `agent-portal/changelog.md`, marked breaking where applicable.
- After every task: `npx tsc --noEmit`, `npx vitest run`, `rtk proxy npx eslint <touched files>` clean.
- Line numbers in this plan were read on 2026-08-09. `api/enrollment/[id]/route.ts` was heavily rewritten in the go-live batch — **re-read before editing it**, do not trust its line numbers.

---

# Phase 0 — Sample data (prerequisite)

Without agents on records, nothing in Phase 1 can be tested.

### Task 0.1: Assign agents to sample records

**Files:** Modify `scripts/seed-enrollment-samples.mjs`, `agent-portal/changelog.md`

**Interfaces:** produces `loadEligibleAgentEmails(supabase)`, `agentFor(record, agentEmails)`, `backfillSampleAgents(supabase, agentEmails)`; `toEnrollmentInsert` gains a third parameter `agentEmail`.

- [ ] **Step 1: Roster loader that matches what the app accepts**

`validateEnrollmentOwnership()` accepts an agent only if it is in `task_agents` **and** has an active `portal_account`. Reading `task_agents` alone (my original plan) would seed stale agents the app then rejects.

Insert above `loadOptions`:

```js
// Must match what the API accepts: validateEnrollmentOwnership() intersects
// task_agents with ACTIVE portal_account. Reading task_agents alone would seed
// stale agents that the app itself treats as invalid.
async function loadEligibleAgentEmails(supabase) {
  const [{ data: agentRows, error: agentError }, { data: accountRows, error: accountError }] =
    await Promise.all([
      supabase.from("task_agents").select("email"),
      supabase.from("portal_account").select("email").eq("is_active", true),
    ]);
  if (agentError) throw new Error(`Unable to read task_agents: ${agentError.message}`);
  if (accountError) throw new Error(`Unable to read portal_account: ${accountError.message}`);

  const activeEmails = new Set((accountRows ?? []).map((row) => row.email).filter(Boolean));
  const emails = [
    ...new Set(
      (agentRows ?? [])
        .map((row) => row.email)
        .filter((email) => email && activeEmails.has(email))
    ),
  ].sort();

  if (emails.length === 0) {
    throw new Error(
      "No eligible agent found (task_agents ∩ active portal_account is empty). " +
        "Select at least one agent with an active account in /config before seeding."
    );
  }
  return emails;
}
```

- [ ] **Step 2: Backfill that filters server-side and never guesses**

```js
// Fills agent_email on sample records seeded before agent support existed.
// Filtering happens IN THE QUERY so non-sample rows are never transferred, and
// an unrecognised link is skipped rather than silently given the first agent.
async function backfillSampleAgents(supabase, agentEmails) {
  const sampleLinks = records.map((record) => record.fub_link);
  const indexByLink = new Map(records.map((record, index) => [record.fub_link, index]));

  const { data, error } = await supabase
    .from("enrollment_records")
    .select("id,fub_link")
    .is("agent_email", null)
    .in("fub_link", sampleLinks);
  if (error) throw new Error(`Unable to read sample records: ${error.message}`);

  const idsByAgent = new Map();
  let unknown = 0;
  for (const row of data ?? []) {
    const index = indexByLink.get(row.fub_link ?? "");
    if (index === undefined) {
      // Cannot happen given the .in() filter, but never fall back to agent 0.
      unknown += 1;
      continue;
    }
    const agent = agentEmails[index % agentEmails.length];
    if (!idsByAgent.has(agent)) idsByAgent.set(agent, []);
    idsByAgent.get(agent).push(row.id);
  }

  let updated = 0;
  for (const [agent, ids] of idsByAgent) {
    // Only agent_email is written. updated_at is deliberately untouched — the
    // samples encode specific ages the operations dashboard depends on.
    const { error: updateError } = await supabase
      .from("enrollment_records")
      .update({ agent_email: agent })
      .in("id", ids);
    if (updateError) {
      throw new Error(`Unable to backfill agent_email for ${agent}: ${updateError.message}`);
    }
    updated += ids.length;
  }

  console.log(`Backfilled agent_email on ${updated} sample record(s) across ${idsByAgent.size} agent(s).`);
  if (unknown > 0) console.log(`Skipped ${unknown} record(s) with an unrecognised sample link.`);
}
```

- [ ] **Step 3: Deterministic assignment helper**

```js
// Deterministic for a FIXED roster + fixture: re-seeding a wiped database with
// the same agents reproduces the same mapping. Adding or removing an agent
// reshuffles a fresh seed — backfill is unaffected because it only fills nulls.
function agentFor(record, agentEmails) {
  const index = records.indexOf(record);
  return agentEmails[(index < 0 ? 0 : index) % agentEmails.length];
}
```

- [ ] **Step 4: Write the field on insert**

Change `toEnrollmentInsert(record, options)` → `toEnrollmentInsert(record, options, agentEmail)` and add, immediately after `fub_link`:

```js
    // Both programs: enrollment_records_medicare_fields_check forbids
    // caller/pcp_2026/platform/consent/payment/aca_status on Medicare, but
    // agent_email is not in that list.
    agent_email: record.agent_email ?? agentEmail ?? null,
```

- [ ] **Step 5: Wire `main()`**

After the `supabase` client is created, before `loadOptions`:

```js
  const agentEmails = await loadEligibleAgentEmails(supabase);

  if (process.argv.includes("--backfill-agents")) {
    await backfillSampleAgents(supabase, agentEmails);
    return;
  }
```

and change the insert mapping to `.map((record) => toEnrollmentInsert(record, options, agentFor(record, agentEmails)))`.

- [ ] **Step 6: Verify**

`node --check scripts/seed-enrollment-samples.mjs` → silent.
`rtk proxy npx eslint scripts/seed-enrollment-samples.mjs` → clean.
`npx tsc --noEmit` and `npx vitest run` → **identical to baseline** (this script is in neither).

Record the "before" number, run, then compare:
```sql
-- before AND after; must be unchanged
select count(*) from enrollment_records
where agent_email is null
  and fub_link not like 'https://app.followupboss.com/2/people/view/sample-%';
```

```bash
npm run seed:enrollment -- --backfill-agents
```

```sql
select program,
       count(*) filter (where agent_email is null) as still_null,
       count(distinct agent_email) as distinct_agents
from enrollment_records
where fub_link like 'https://app.followupboss.com/2/people/view/sample-%'
group by program;
```
Expected `still_null = 0` for both programs.

- [ ] **Step 7: Changelog + commit**

```bash
git add scripts/seed-enrollment-samples.mjs agent-portal/changelog.md
git commit -m "feat(seed): assign eligible agents to enrollment sample records"
```

### Task 0.2: Seed assistants — safely

**Files:** Modify `scripts/seed-enrollment-samples.mjs`, `agent-portal/changelog.md`

My original version auto-selected active non-agent accounts and upserted `is_assistant: true`. That is a **permission mutation on real users** — it could promote an Admin, promote a non-CS account, or flip an existing `is_assistant = false` row. Replaced with an explicit allow-list.

- [ ] **Step 1: Allow-list, dry-run, environment guard**

```js
// Assistant membership is a REAL permission grant: an assistant gets the same
// rights as the agent owner on that agent's records. This never picks people
// automatically — pairs are given explicitly and previewed first.
//
//   npm run seed:enrollment -- --seed-assistants=cs@x.com:agent@x.com --dry-run
//
// Refuses to run unless SEED_ALLOW_ASSISTANTS=1, so it cannot fire by accident
// against production.
async function seedSampleAssistants(supabase, agentEmails, pairsArg, dryRun) {
  if (process.env.SEED_ALLOW_ASSISTANTS !== "1") {
    throw new Error(
      "Refusing to modify agent_members: set SEED_ALLOW_ASSISTANTS=1 to confirm this is a non-production database."
    );
  }

  const pairs = pairsArg
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [csEmail, agentEmail] = entry.split(":").map((part) => part?.trim());
      if (!csEmail || !agentEmail) {
        throw new Error(`Bad --seed-assistants entry "${entry}" — expected cs@email:agent@email`);
      }
      return { cs_email: csEmail, agent_email: agentEmail };
    });
  if (pairs.length === 0) throw new Error("--seed-assistants needs at least one cs:agent pair.");

  const agentSet = new Set(agentEmails);
  const { data: accounts, error } = await supabase
    .from("portal_account")
    .select("email")
    .eq("is_active", true);
  if (error) throw new Error(`Unable to read portal_account: ${error.message}`);
  const activeEmails = new Set((accounts ?? []).map((row) => row.email));

  for (const pair of pairs) {
    if (!agentSet.has(pair.agent_email)) {
      throw new Error(`"${pair.agent_email}" is not an eligible agent.`);
    }
    if (!activeEmails.has(pair.cs_email)) {
      throw new Error(`"${pair.cs_email}" is not an active account.`);
    }
    if (agentSet.has(pair.cs_email)) {
      throw new Error(`"${pair.cs_email}" is itself an agent — an assistant must be someone else.`);
    }
  }

  console.log(`Target database: ${process.env.SUPABASE_URL}`);
  for (const pair of pairs) {
    console.log(`  ${pair.cs_email} → assistant for ${pair.agent_email}`);
  }
  if (dryRun) {
    console.log("--dry-run: nothing written.");
    return;
  }

  const { error: upsertError } = await supabase
    .from("agent_members")
    .upsert(
      pairs.map((pair) => ({ ...pair, is_assistant: true })),
      { onConflict: "agent_email,cs_email" }
    );
  if (upsertError) throw new Error(`Unable to seed agent_members: ${upsertError.message}`);
  console.log(`Granted ${pairs.length} assistant relationship(s).`);
}
```

⚠️ Confirm the conflict target against `supabase/schema.sql:2211-2216` (`primary key (agent_email, cs_email)`) before writing. ⚠️ This **upserts `is_assistant: true`**, so it will promote an existing non-assistant membership for the same pair — that is why the pairs are explicit and previewed.

- [ ] **Step 2: Wire the flag**

```js
  const assistantsArg = process.argv.find((arg) => arg.startsWith("--seed-assistants="));
  if (assistantsArg) {
    await seedSampleAssistants(
      supabase,
      agentEmails,
      assistantsArg.split("=")[1] ?? "",
      process.argv.includes("--dry-run")
    );
    return;
  }
```

- [ ] **Step 3: Verify — dry run first, always**

```bash
SEED_ALLOW_ASSISTANTS=1 npm run seed:enrollment -- --seed-assistants=cs@x.com:agent@x.com --dry-run
```
Confirm the printed database URL is **not** production, then re-run without `--dry-run`.

```sql
select agent_email, cs_email, is_assistant from agent_members where is_assistant order by agent_email;
```

- [ ] **Step 4: Changelog + commit**

```bash
git add scripts/seed-enrollment-samples.mjs agent-portal/changelog.md
git commit -m "feat(seed): add guarded assistant seeding for permission testing"
```

---

# Phase 1 — Enrollment permission

### Task 1.1: Capability resolver

**Files:** Modify `src/lib/enrollment/access.ts`; create `src/lib/enrollment/capabilities.test.ts`

**Interfaces:** produces `EnrollmentMembershipFlags`, `EnrollmentCapabilities`, `resolveEnrollmentCapabilities(actor, flags)`, `canCreateEnrollmentWithScope(actor, hasAgentScope)`. Consumed by Tasks 1.2–1.6.

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

describe("manager", () => {
  it("gets every capability", () => {
    expect(resolveEnrollmentCapabilities(manager, {})).toEqual({
      canView: true, canEditFields: true, canChangeStage: true, canReopen: true,
      canReviewQC: true, canAssignPeople: true, canArchive: true, canTransferAgent: true,
    });
  });
});

describe("agent owner or assistant", () => {
  it("gets every capability including transferring the record", () => {
    const caps = resolveEnrollmentCapabilities(worker, { isAgentOwner: true });
    expect(caps.canEditFields).toBe(true);
    expect(caps.canChangeStage).toBe(true);
    expect(caps.canReviewQC).toBe(true);
    expect(caps.canAssignPeople).toBe(true);
    expect(caps.canArchive).toBe(true);
    // D1 resolved: matches CS, where the agent owner may reassign.
    expect(caps.canTransferAgent).toBe(true);
  });
});

describe("caller and responsible are workers", () => {
  for (const role of ["isCaller", "isResponsible"] as const) {
    it(`${role}: edits fields, moves stage, reopens`, () => {
      const caps = resolveEnrollmentCapabilities(worker, { [role]: true });
      expect(caps.canEditFields).toBe(true);
      expect(caps.canChangeStage).toBe(true);
      expect(caps.canReopen).toBe(true);
    });
    it(`${role}: cannot QC, assign, archive or transfer`, () => {
      const caps = resolveEnrollmentCapabilities(worker, { [role]: true });
      expect(caps.canReviewQC).toBe(false);
      expect(caps.canAssignPeople).toBe(false);
      expect(caps.canArchive).toBe(false);
      expect(caps.canTransferAgent).toBe(false);
    });
  }
});

describe("creator", () => {
  it("edits fields and may transfer the agent, but does not move the workflow", () => {
    const caps = resolveEnrollmentCapabilities(worker, { isCreator: true });
    expect(caps.canEditFields).toBe(true);
    expect(caps.canChangeStage).toBe(false);
    expect(caps.canArchive).toBe(false);
    // CS parity: the reporter may change agent_email (CONTENT_PATCH_KEYS).
    expect(caps.canTransferAgent).toBe(true);
  });
});

describe("unrelated and non-worker", () => {
  it("an unrelated worker may view but change nothing", () => {
    const caps = resolveEnrollmentCapabilities(worker, {});
    expect(caps.canView).toBe(true);
    expect(caps.canEditFields).toBe(false);
  });
  it("a non-worker gets nothing", () => {
    expect(resolveEnrollmentCapabilities(outsider, { isAgentOwner: true }).canView).toBe(false);
  });
});

describe("canCreateEnrollmentWithScope", () => {
  it("manager yes; worker with scope yes; worker without scope no; non-worker no", () => {
    expect(canCreateEnrollmentWithScope(manager, false)).toBe(true);
    expect(canCreateEnrollmentWithScope(worker, true)).toBe(true);
    expect(canCreateEnrollmentWithScope(worker, false)).toBe(false);
    expect(canCreateEnrollmentWithScope(outsider, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`resolveEnrollmentCapabilities` not exported).

- [ ] **Step 3: Implement** — append to `src/lib/enrollment/access.ts`, and **export the existing private `normalizeEmail`** (`:61-63`) as `normalizeEnrollmentActorEmail` so no second copy is ever written:

```ts
export type EnrollmentMembershipFlags = {
  /** Agent owner OR promoted assistant — resolve with isAgentOwnerOrAssistant(). */
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
  /** Changing agent_email moves the record between visibility scopes. */
  canTransferAgent: boolean;
};

/**
 * Single source of truth for enrollment record permissions; the API enforces
 * these and the client renders from the same result.
 *
 * Deliberate difference from CS: caller/responsible CAN edit fields. In CS the
 * assignee cannot edit content because the content is the brief written by the
 * reporter. In Enrollment the fields ARE the work product — whoever collects
 * the customer's information must be able to record it.
 *
 * canView here answers "may this actor act on a record they can already
 * reach". WHICH records they can reach is decided by scope.ts, and both must
 * be checked — see Task 1.3.
 */
export function resolveEnrollmentCapabilities(
  actor: EnrollmentActor,
  flags: EnrollmentMembershipFlags = {}
): EnrollmentCapabilities {
  if (actor.isManager) {
    return {
      canView: true, canEditFields: true, canChangeStage: true, canReopen: true,
      canReviewQC: true, canAssignPeople: true, canArchive: true, canTransferAgent: true,
    };
  }
  if (!actor.isWorker) {
    return {
      canView: false, canEditFields: false, canChangeStage: false, canReopen: false,
      canReviewQC: false, canAssignPeople: false, canArchive: false, canTransferAgent: false,
    };
  }

  const isOwner = Boolean(flags.isAgentOwner);
  const isDoingTheWork = Boolean(flags.isCaller) || Boolean(flags.isResponsible);

  return {
    canView: true,
    canEditFields: isOwner || isDoingTheWork || Boolean(flags.isCreator),
    canChangeStage: isOwner || isDoingTheWork,
    canReopen: isOwner || isDoingTheWork,
    canReviewQC: isOwner,
    canAssignPeople: isOwner,
    canArchive: isOwner,
    // D1 (resolved): mirrors CS, where agent_email lives in CONTENT_PATCH_KEYS
    // gated by canEditContent = manager || isAgentOwner || isReporter.
    // Caller/responsible are deliberately excluded despite having canEditFields.
    canTransferAgent: isOwner || Boolean(flags.isCreator),
  };
}

export function canCreateEnrollmentWithScope(
  actor: EnrollmentActor,
  hasAgentScope: boolean
): boolean {
  if (actor.isManager) return true;
  return actor.isWorker && hasAgentScope;
}
```

- [ ] **Step 4: Verify** — test PASS; `npx vitest run` one file up; `tsc` clean; eslint clean.
- [ ] **Step 5: Commit** — `feat(enrollment): add per-action capability resolver`

### Task 1.2: Scope resolver — the security boundary

**Files:** Create `src/lib/enrollment/scope.ts` and `src/lib/enrollment/scope.test.ts`

**Interfaces:** produces
`type EnrollmentScope = { seeAll: true } | { seeAll: false; agentEmails: string[] }`,
`resolveEnrollmentScope(actor): Promise<EnrollmentScope>`,
`isRecordInScope(scope, agentEmail: string | null): boolean`,
`applyEnrollmentScope(query, scope)`.
Consumed by Tasks 1.3–1.6 **and** Phase 2.

This exists because scoping a single list query is not a boundary (finding 1). Every path that returns record data must consult it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/enrollment/scope.test.ts
import { describe, expect, it } from "vitest";
import { isRecordInScope } from "./scope";

describe("isRecordInScope", () => {
  it("lets an unscoped viewer see everything, including null-agent records", () => {
    expect(isRecordInScope({ seeAll: true }, "a@x.com")).toBe(true);
    expect(isRecordInScope({ seeAll: true }, null)).toBe(true);
  });

  it("lets a scoped viewer see only their agents", () => {
    const scope = { seeAll: false as const, agentEmails: ["a@x.com", "b@x.com"] };
    expect(isRecordInScope(scope, "a@x.com")).toBe(true);
    expect(isRecordInScope(scope, "c@x.com")).toBe(false);
  });

  // Fail CLOSED. `agent` is required only by a Config flag, not by NOT NULL,
  // so a UI flag must never be treated as a security invariant.
  it("hides null-agent records from a scoped viewer", () => {
    expect(isRecordInScope({ seeAll: false, agentEmails: ["a@x.com"] }, null)).toBe(false);
  });

  it("hides everything from a scoped viewer with no agents", () => {
    expect(isRecordInScope({ seeAll: false, agentEmails: [] }, "a@x.com")).toBe(false);
  });

  it("compares case-insensitively", () => {
    expect(isRecordInScope({ seeAll: false, agentEmails: ["A@X.com"] }, "a@x.COM")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/lib/enrollment/scope.ts
//
// WHICH records an actor may reach. Deliberately separate from access.ts,
// which decides WHAT they may do to a record they can already reach. Both
// must be checked on every path that returns record data — scoping only the
// list query is not a security boundary, because /api/enrollment/[id],
// /detail, /activity, /comments, /attachments, the overview and the export
// all read with the service role.
import {
  fetchAgentsForCs,
  fetchAssistantAgentsForCs,
} from "@/lib/tasks/membership";
import { fetchSelectedAgentEmails } from "@/lib/tasks/assignees";
import type { EnrollmentActor } from "./access";

export type EnrollmentScope =
  | { seeAll: true }
  | { seeAll: false; agentEmails: string[] };

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Mirrors CS (lib/tasks/queries.ts:43-53): managers and PLAIN workers see the
 * whole program; an agent or assistant is narrowed to their agents. Narrowing
 * agents rather than ordinary staff is the deliberate 2026-08-02 view model.
 */
export async function resolveEnrollmentScope(
  actor: EnrollmentActor
): Promise<EnrollmentScope> {
  if (actor.isManager) return { seeAll: true };
  if (!actor.isWorker) return { seeAll: false, agentEmails: [] };

  const [selectedAgentEmails, assistantAgents] = await Promise.all([
    fetchSelectedAgentEmails(),
    fetchAssistantAgentsForCs(actor.email),
  ]);
  const isAgent = selectedAgentEmails.has(actor.email);
  const isAssistant = assistantAgents.length > 0;
  if (!isAgent && !isAssistant) return { seeAll: true };

  const covered = await fetchAgentsForCs(actor.email);
  return {
    seeAll: false,
    agentEmails: [
      ...new Set(
        [...(isAgent ? [actor.email] : []), ...assistantAgents, ...covered].map(normalize)
      ),
    ],
  };
}

/** Fail closed: a null agent is never visible to a scoped viewer. */
export function isRecordInScope(
  scope: EnrollmentScope,
  agentEmail: string | null
): boolean {
  if (scope.seeAll) return true;
  if (!agentEmail) return false;
  return scope.agentEmails.includes(normalize(agentEmail));
}
```

Add `applyEnrollmentScope(query, scope)` in the same file, returning the query unchanged when `seeAll`, otherwise `query.in("agent_email", scope.agentEmails)`. When `agentEmails` is empty it must produce a query that matches nothing — use an impossible value rather than skipping the filter.

- [ ] **Step 4: Verify** — test PASS; `tsc`/eslint clean.
- [ ] **Step 5: Commit** — `feat(enrollment): add actor scope resolver`

### Task 1.3: Enforce scope on every read-by-ID path

**Files:** Modify `src/app/api/enrollment/[id]/route.ts` (GET + PATCH + DELETE), `[id]/detail/route.ts`, `[id]/activity/route.ts`, `[id]/comments/route.ts`, `[id]/comments/[cid]/route.ts`, `[id]/comments/[cid]/edits/route.ts`, `[id]/attachments/route.ts`, `[id]/attachments/[aid]/route.ts`, `src/app/(authed)/enrollment/page.tsx`

This is finding 1 — the blocker. Without it Phase 1 is decoration.

- [ ] **Step 1: Add a shared guard to `scope.ts`**

```ts
/**
 * Loads a record and refuses it if the actor's scope does not cover it.
 * Returns 404 rather than 403 on an out-of-scope record so the endpoint does
 * not confirm that a given UUID exists.
 */
export async function loadScopedEnrollmentRecord(
  id: string,
  actor: EnrollmentActor
): Promise<
  | { ok: true; record: EnrollmentRecordWithStats; scope: EnrollmentScope }
  | { ok: false; status: 403 | 404; error: string }
> { /* fetchEnrollmentRecordById + resolveEnrollmentScope + isRecordInScope */ }
```

⚠️ Returning 404 is deliberate — a 403 tells an attacker the UUID is real.

- [ ] **Step 2: Apply it in every route above**

Each currently does `loadEnrollmentActor()` then reads with the service role. Insert the scope check immediately after the actor loads and before any record data is read or returned. **Re-read each route** — they were rewritten in the go-live batch.

- [ ] **Step 3: Close the deep-link fallback**

`enrollment/page.tsx` falls back to `fetchEnrollmentRecordById(recordId)` when a deep-linked record is not in the list. Gate that with `isRecordInScope`; if out of scope, behave as if the record does not exist rather than redirecting to it.

- [ ] **Step 4: Verify**

`rtk proxy grep -rln "loadEnrollmentActor" src/app/api/enrollment/` — every listed file must also reference the scope guard.

Manual, as an agent scoped to agent A, using a record UUID belonging to agent B: `GET /api/enrollment/{id}`, `/detail`, `/activity`, `/comments`, `/attachments` **all return 404**, and the deep link `/enrollment?record={id}` does not open it.

- [ ] **Step 5: Commit** — `fix(enrollment): scope every record read by actor`

### Task 1.4: Per-action enforcement in PATCH and DELETE

**Files:** Modify `src/app/api/enrollment/[id]/route.ts`

- [ ] **Step 1: Resolve capabilities once** after the Task 1.3 scope guard, using `isAgentOwnerOrAssistant(current.agent_email, actor.email)` and the normalized caller/responsible/creator comparisons.

- [ ] **Step 2: Gate each action against what the patch touches**

```ts
  const touchesStage = "stage_id" in resolved.patch;
  const touchesAgent = "agent_email" in resolved.patch;
  const touchesPeople =
    "caller_email" in resolved.patch || "responsible_enroll_email" in resolved.patch;
  const touchesQc = qcChecked !== null;
  const DERIVED_KEYS = new Set([
    "stage_id", "agent_email", "caller_email", "responsible_enroll_email",
    "closed_at", "qc_checked_by_email", "qc_checked_at", "qc_stale_notified_at",
    "due_soon_notified_at", "overdue_notified_at", "overdue_reminded_at",
    "updated_at", "updated_by_email",
  ]);
  const touchesOtherFields = Object.keys(resolved.patch).some((k) => !DERIVED_KEYS.has(k));

  if (touchesAgent && !capabilities.canTransferAgent) {
    return NextResponse.json(
      { error: "You cannot move this record to another agent." },
      { status: 403 }
    );
  }
  if (touchesOtherFields && !capabilities.canEditFields) { /* 403 */ }
  if (touchesPeople && !capabilities.canAssignPeople) { /* 403 */ }
  if (touchesQc && !capabilities.canReviewQC) { /* 403 */ }
  if (touchesStage && !(reopening ? capabilities.canReopen : capabilities.canChangeStage)) { /* 403 */ }
```

⚠️ `agent_email` is checked **first and separately** (finding 4). ⚠️ `DERIVED_KEYS` must list every key the route sets as a *consequence* of stage/QC/due-date changes — verify against the route's own writers, or a stage change will wrongly demand `canEditFields`. ⚠️ Place this after `reopening` and `qcChecked` are computed.

- [ ] **Step 3: DELETE** — resolve capabilities and require `canArchive`. **Add `agent_email` to the handler's `select`**, which currently fetches only `id,caller_email,responsible_enroll_email,created_by_email`; without it the check receives `undefined` and denies everyone but managers, and typecheck will not catch it.

- [ ] **Step 4: Verify** — `rtk proxy grep -n "canMutateEnrollmentRecord\|canArchiveEnrollmentRecord" src/`; retire both plus their tests if nothing references them.

Manual on both programs: as responsible → field edit and stage change succeed, QC/archive/agent-transfer 403. As agent owner → all actions in the matrix succeed, including agent transfer (D1). As creator-only → field edit and agent transfer succeed. As manager → all succeed.

- [ ] **Step 5: Commit** — `feat(enrollment): enforce per-action permissions on mutations`

### Task 1.5: Scope the list, the overview and the export query

**Files:** Modify `src/lib/enrollment/queries.ts`, `src/lib/enrollment/overview-data.ts`, `src/app/api/enrollment/overview/route.ts`, `src/app/api/enrollment/export/route.ts`, plus every caller the compiler reports

- [ ] **Step 1:** `fetchEnrollmentRecords(program)` → `fetchEnrollmentRecords(program, scope)`, applying `applyEnrollmentScope`. Import `quotePostgrestFilterValue` from `@/lib/tasks/queries` if a raw `.or()` is needed; never interpolate an email. The local `LooseSupabaseQueryBuilder` type must be widened rather than cast to `any`.

- [ ] **Step 2:** `fetchEnrollmentOverview(program, …)` takes the scope and applies it to **every** record query it runs, including drill-down lists (finding 2).

- [ ] **Step 3:** `api/enrollment/export/route.ts:82` passes the resolved scope (finding 3). An exporting agent must receive exactly the rows they can see in the list.

- [ ] **Step 4: Verify**

`npx tsc --noEmit` enumerates the callers — pass the actor/scope already in scope at each, never build a new actor.

Manual: for one scoped agent, assert the three counts agree — list rows, overview "Open" tile, and export row count — and that all three equal
```sql
select count(*) from enrollment_records
where program = :program and archived_at is null and agent_email = :agent;
```

- [ ] **Step 5: Commit** — `fix(enrollment): scope list, overview and export queries`

### Task 1.6: Create gate + client

**Files:** Modify `src/app/api/enrollment/route.ts`, `src/app/(authed)/enrollment/page.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

- [ ] **Step 1: Create gate** — after `agent_email` is validated in POST:

```ts
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

`isAgentOwnerOrAssistant` short-circuits false on a null agent (`membership.ts:78`), so a non-manager cannot create an agent-less record. That is intended — do not add a bypass.

- [ ] **Step 2: Feed membership to the client** — `enrollment/page.tsx` passes `myAgents` and `myAssistantAgents`, mirroring `tasks/page.tsx:98-99`.

- [ ] **Step 3: Replace the duplicate client predicates** — delete `canEditEnrollmentRecordClient` and `canArchiveEnrollmentRecordClient` (`EnrollmentClient.tsx:409-431`) and call the shared resolver instead, reusing the file's existing `normalizeEnrollmentEmail`.

- [ ] **Step 4: Bind each control to its own capability**

| Control | Capability |
|---|---|
| Client name, FUB, description, PCP, custom fields | `canEditFields` |
| **Agent picker** | **`canTransferAgent`** |
| Stage pill | `canChangeStage` |
| QC button | `canReviewQC` |
| Caller / Responsible menus | `canAssignPeople` |
| Archive | `canArchive` |
| Reopen | `canReopen` |

⚠️ In the **Create dialog** there is no record, so leave those menus at their `canEdit` default — do not pass a record-derived capability.

- [ ] **Step 5: Hide the create button** — `canCreateRecords = canManageOptions || myAgents.length > 0 || myAssistantAgents.length > 0`.

- [ ] **Step 6: Verify** — `rtk proxy grep -n "canEditEnrollmentRecordClient\|canArchiveEnrollmentRecordClient" src/` → empty. Walk the full matrix on **both** programs with DevTools Network open: **no disabled-looking control may emit a request**.

- [ ] **Step 7: Commit** — `feat(enrollment): gate creation and render controls from capabilities`

---

# Phase 2 — Export permission

**Must land after Phase 1 Task 1.5.** Granting `task.export` before the export query is scoped turns the permission into a system-wide data-egress hole (finding 3).

### Task 2.1: Catalogue key

- [ ] Add `TASK_EXPORT: "task.export"` to `PERMISSIONS` (`src/lib/rbac/permissions.ts`).
- [ ] Add the catalogue row to the `insert into permissions … on conflict (key) do update` block (`supabase/schema.sql:163-185`) — remember the current last row needs a trailing comma:
```sql
  ('task.export', 'Tasks - Export', 'Export task and enrollment tables to Excel. Required on its own — a manager role alone does not grant export.', 'tasks', 'Tasks', 300)
```
- [ ] Verify `tsc` / `vitest` unchanged; commit.

### Task 2.2: Single auth context, permission-based gate

**Files:** `src/lib/enrollment/access.ts`, `src/lib/table-config/export-access.ts` + test, and the four call sites

- [ ] **Step 1:** Extend `loadEnrollmentActor()` to also return `permissions` from the session snapshot it already has. Do **not** add a second `auth()` call in the export routes (finding 9), and do **not** put permissions on `EnrollmentActor`.

- [ ] **Step 2: Test first**

```ts
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { canActorExport } from "./export-access";

describe("canActorExport", () => {
  it("allows a holder", () => expect(canActorExport([PERMISSIONS.TASK_EXPORT])).toBe(true));
  it("denies a manager without it", () => expect(canActorExport([PERMISSIONS.TASK_MANAGE])).toBe(false));
  it("denies empty and undefined", () => {
    expect(canActorExport([])).toBe(false);
    expect(canActorExport(undefined)).toBe(false);
  });
});
```

- [ ] **Step 3:** Replace `export-access.ts` with a synchronous `canActorExport(permissions: readonly string[] | undefined): boolean` returning `can(permissions, PERMISSIONS.TASK_EXPORT)`. Confirm `can`'s handling of `undefined` in `src/lib/rbac/client.ts` and guard here if needed.

- [ ] **Step 4:** Update the four call sites. **The pages use `canExport`, not `canExportImport`** (`tasks/page.tsx:48,104`; `enrollment/page.tsx:53,92`) — read the compiler, do not trust older notes.

- [ ] **Step 5:** Verify `rtk proxy grep -rn "canActorExport" src/` → five hits, none passing an actor. Commit.

### Task 2.3: Idempotent rollout SQL

Not "re-run schema.sql" — that also runs `delete from role_permissions … where r.name in ('Admin','Agent')` (`:281-285`) plus unrelated DDL.

- [ ] **Step 1: Run exactly this, in one transaction**

```sql
begin;

insert into permissions (key, label, description, group_key, group_label, sort_order)
values ('task.export', 'Tasks - Export',
        'Export task and enrollment tables to Excel. Required on its own — a manager role alone does not grant export.',
        'tasks', 'Tasks', 300)
on conflict (key) do update
  set label = excluded.label, description = excluded.description,
      group_key = excluded.group_key, group_label = excluded.group_label,
      sort_order = excluded.sort_order;

-- The catalogue row alone grants nobody: role_permissions is a separate table.
insert into role_permissions (role_id, permission_key)
select r.id, 'task.export' from roles r where r.name = 'Admin'
on conflict (role_id, permission_key) do nothing;

commit;
```

- [ ] **Step 2: Verify in the same session**
```sql
select r.name from role_permissions rp join roles r on r.id = rp.role_id
where rp.permission_key = 'task.export' order by r.name;
```
Expected: `Admin`.

- [ ] **Step 3:** If `Admin Health Task` or `Task Admin` exists (`select name from roles order by name`), grant **Tasks - Export** through `/role-manager` — it writes via `replace_role_permissions` and keeps the set consistent. These roles are not seeded (`grep` finds zero in `schema.sql`); they exist only as names checked in `TASK_ADMIN_ROLE_NAMES` (`src/lib/tasks/access.ts:13-16`).

- [ ] **Step 4: Name who loses export, before deploying**
```sql
select a.email, coalesce(string_agg(r.name, ', ' order by r.name), '(no roles)') as roles
from portal_account a
left join user_roles ur on ur.user_id = a.id
left join roles r on r.id = ur.role_id
where a.is_active
  and a.id not in (
    select ur2.user_id from user_roles ur2
    join role_permissions rp on rp.role_id = ur2.role_id
    where rp.permission_key = 'task.export')
group by a.email order by a.email;
```

- [ ] **Step 5: Manual** — a `task.export` holder **without** `task.manage` can export; a manager **without** the key gets **403 from the API**, not merely a hidden menu. Test the route directly.

---

# Phase 3 — Rollout verification

- [ ] **Impact count, before deploy**
```sql
select count(distinct e.email) as people_affected, count(*) as open_records
from enrollment_records r
cross join lateral (values (r.caller_email), (r.responsible_enroll_email), (r.created_by_email)) as e(email)
where r.archived_at is null and r.closed_at is null and e.email is not null
  and e.email not in (select email from task_agents)
  and e.email not in (select cs_email from agent_members where is_assistant);
```

- [ ] **Null-agent count** — expected 0 after Phase 0; anything else is invisible to scoped agents by the fail-closed rule.
```sql
select program, count(*) filter (where agent_email is null) from enrollment_records
where archived_at is null group by program;
```

- [ ] **Cross-surface consistency.** For one scoped agent, list count = overview Open tile = export row count = the SQL count.

- [x] **Changelog** — one breaking entry covers: enrollment scoping is now enforced on every read path (not just the list), create requires manager or agent scope, archive/QC/assign require manager or agent-owner/assistant, `agent_email` transfer follows D1 (manager + agent-owner/assistant + creator), caller/responsible/creator keep field editing, caller/responsible keep stage and reopen, export moved to `task.export`. CS was verified compliant and **not** changed.

---

## Self-Review

**Codex coverage.** Findings 1→Task 1.3, 2→1.5 Step 2, 3→1.5 Step 3 + the Phase 2 ordering rule, 4→`canTransferAgent` + D1, 5→fail-closed in `scope.ts`, 6→accepted risk + Phase 3 role-transition test, 7→Task 2.3's explicit two-statement SQL, 8→corrected names in 2.2 Step 4, 9→loader extension in 2.2 Step 1, 10→Task 0.2 allow-list/dry-run/env guard, 11→`loadEligibleAgentEmails`, 12→server-side `.in()` + `continue`, 13→corrected wording in `agentFor`.

**Placeholder scan.** One deliberate stub: `loadScopedEnrollmentRecord`'s body in Task 1.3 Step 1 is described rather than written, because it must be assembled against routes that were rewritten in the go-live batch and whose current shape must be read first. Its signature, return type and the 404-not-403 rule are fully specified. Everything else carries code or SQL.

**Type consistency.** `resolveEnrollmentCapabilities` / `EnrollmentCapabilities` / `canCreateEnrollmentWithScope` / `EnrollmentScope` / `resolveEnrollmentScope` / `isRecordInScope` / `applyEnrollmentScope` / `loadScopedEnrollmentRecord` are spelled identically wherever they appear. `canTransferAgent` appears in the type, the resolver, the PATCH guard, the client binding table and two tests.

**Open decisions.** None. D1 was resolved on 2026-08-09 to match CS precedent (manager + agent-owner/assistant + creator); the privilege-inversion risk in §3 was reviewed by the owner and accepted for this release, with the Phase 3 role-transition test as the required observation.

**Sequencing.** Phase 0 → Phase 1 (1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6) → Phase 2 → Phase 3. Tasks 1.3–1.5 all depend on 1.2. Phase 2 must follow 1.5.

---

## Codex execution log — 2026-08-09

| Phase / task | Result | Commit |
|---|---|---|
| 0.1 Sample enrollment agent assignment | Implemented eligible-agent intersection, deterministic assignment and fixture-only null backfill | `2eceede` |
| 0.2 Guarded assistant fixtures | Implemented explicit allow-list, environment guard and dry-run; no live membership write was run | `6b53238` |
| 0.3 Generated QA agent backfill correction | Reclassified the 640 `[Sample QA]` rows correctly, added strict dual-marker + dry-run guards, assigned all 640 across 17 eligible agents, and verified 0 missing in both programs | `2173014` |
| 1.1 Capability resolver | Implemented and unit-tested the D1 action matrix | `1e5a763` |
| 1.2 Actor scope resolver | Implemented manager/plain-worker shared view, agent/assistant scope and null-agent fail-closed | `b2b3b00` |
| 1.3 Record read scope | Applied 404 scope guard to every record/deep-link read path | `cc86ddb` |
| 1.4 Mutation permissions | Split PATCH/DELETE enforcement by stage, fields, QC, people, archive and agent transfer | `20b7909` |
| 1.5 List/overview/export scope | Applied the same scope to all collection and aggregate queries | `99698b5` |
| 1.6 Create/client capability gate | Restricted create agent choices, hid create for unscoped workers, bound each UI control to its own capability and retired duplicate predicates | `50cdd85` |
| 2.1 Export permission catalogue | Added `task.export` to TypeScript and schema catalogues | `c70587b` |
| 2.2 Export gate | Reused the authenticated permission snapshot in both pages and APIs; manager status no longer grants export implicitly | `512a738` |
| 2.3 Rollout SQL | Added an idempotent transaction and verification queries | `ff12606` |

Automated verification after implementation: `npx tsc --noEmit`, `npx vitest run` and ESLint passed. Production build was intentionally not run because a live `next dev` process owns `.next`; cross-surface browser checks still require authenticated role sessions.

### Live rollout audit

- Ran the fixture-only `--backfill-agents`: **27 sample records across 17 eligible agents** were updated; a read-back confirmed **0 sample records remain null-agent**.
- **[CODEX CORRECTION — 2026-08-09]** The 640 remaining null-agent rows were incorrectly classified as real/non-sample. A direct read-back proved all 640 are generated QA fixtures: 320 ACA + 320 Medicare, each carrying both a `[Sample QA]` client-name prefix and a dedicated `https://sample.qa/enrollment-{program}/...` FUB URL. They were omitted only because Task 0.1 scoped the backfill to the 27 hardcoded Follow Up Boss fixture links. The backfill implementation now recognizes the generated QA family using both markers and supports a read-only `--dry-run` before assignment.
- The corrected dry-run targeted exactly **640 QA fixtures** and no canonical/real rows. The live write assigned all 640 across **17 eligible agents**. Independent read-back confirmed ACA **320 total / 0 missing** and Medicare **320 total / 0 missing**, with **18–19 records per agent per program**.
- The open-record impact query found **13 distinct non-agent stakeholders** across **245 stakeholder slots** in 531 open records. This is a role-transition observation, not a reason to broaden owner-only actions.
- `task.export` is **not yet present in the live permission catalogue** and has **0 live grants**. The transactional rollout is ready at `supabase/rollouts/2026-08-09-task-export-permission.sql`, but was not executed because the workspace has no transactional DB connection.

**Deployment gate:** The previous blocker for “640 non-sample records” is resolved and withdrawn because those rows are verified QA fixtures, not customers; the strict QA-only backfill has been executed and read back. The export permission rollout SQL still needs its separate deployment/review.

### Post-plan owner override — main content

The owner clarified that Enrollment CS workers must match Health CS for the three large content fields. `canEditContent` now covers Client Name, FUB Link and Description and is granted only to manager, agent-owner/assistant and creator. Caller/Responsible retain operational enrollment-field editing plus Stage/Reopen, but cannot edit those three fields through either the drawer or direct PATCH.
