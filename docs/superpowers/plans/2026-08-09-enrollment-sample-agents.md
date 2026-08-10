# Enrollment Sample Data — Agent Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every enrollment sample record a real `agent_email`, so the agent/assistant permission model (plan 3 of 3) can actually be tested — today every sample record has `agent_email = NULL`.

**Architecture:** `scripts/seed-enrollment-samples.mjs` builds insert rows from two hardcoded arrays and skips records that already exist. It never sets `agent_email`. This plan adds a live read of the `task_agents` roster, a deterministic round-robin assignment, and a `--backfill-agents` mode for records already in the database.

**Tech Stack:** Node ESM script, `@supabase/supabase-js` with the service-role key, run via `npm run seed:enrollment`.

## Global Constraints

- Source of truth: working tree at the commit this plan is executed against. Every quoted snippet was read on 2026-08-09.
- The script talks to a **real database with the service-role key**. Every write in this plan must be additive or scoped — never a bulk overwrite.
- Only `origin` is pushed automatically; never `vercel`.
- Log the change in `agent-portal/changelog.md`.
- After the task: `npx tsc --noEmit`, `npx vitest run`, `rtk proxy npx eslint scripts/seed-enrollment-samples.mjs` must be clean.
- Reply to the user in Vietnamese, concise, when done.

## Codex review comments — 2026-08-09

> **[CODEX REVIEW — BLOCKER] `--seed-assistants` không an toàn để chạy trên DB
> thật theo implementation hiện tại.** Script tự lấy mọi active non-agent
> account, rồi `upsert(... is_assistant: true)` để cấp quyền ngang agent-owner.
> Nó có thể chọn Admin, account nghiệp vụ không phải CS, hoặc biến một membership
> có sẵn `is_assistant=false` thành assistant. Đây là mutation quyền trên user
> thật chứ không chỉ là sample data. Phải dùng explicit allow-list (CLI/env), chỉ
> chấp nhận account có `task.work`/`task.manage`, có `--dry-run`, in target DB và
> yêu cầu opt-in rõ ràng; tốt nhất flag này chỉ chạy ở non-production. Không được
> tự chọn candidate theo alphabet.

> **[CODEX REVIEW — HIGH] `task_agents` không đồng nghĩa với eligible agent.**
> `validateEnrollmentOwnership()` lấy giao của `task_agents` và active
> `portal_account`, còn `loadAgentEmails()` trong plan chỉ đọc `task_agents`.
> Một row agent cũ/inactive sẽ được seed vào record nhưng app lại xem là invalid.
> Loader phải join/intersect với active accounts giống
> `fetchTaskAgents()`/`validateEnrollmentOwnership()` và fail nếu roster hợp lệ
> rỗng.

> **[CODEX REVIEW — HIGH] Backfill đang đọc toàn bộ record có `agent_email IS
> NULL` rồi mới lọc prefix ở Node.** Dù write cuối cùng có scope, service-role vẫn
> tải dữ liệu ngoài sample không cần thiết. Query server-side riêng cho hai prefix
> (hoặc exact `fub_link` list từ `records`) và chỉ select đúng fixture. Quan trọng
> hơn, `indexByLink.get(link) ?? 0` hiện tự gán agent đầu tiên cho mọi record lạ
> có sample prefix; phải `continue` nếu `indexByLink` không chứa exact link.

> **[CODEX REVIEW — MEDIUM] “Deterministic” chỉ đúng khi roster không đổi.** Vì
> assignment phụ thuộc index của danh sách email đã sort, thêm/xoá một agent sẽ
> đổi mapping khi seed DB mới. Không ảnh hưởng backfill-only vì chỉ update null,
> nhưng plan/changelog nên mô tả là deterministic với cùng fixture + cùng roster,
> không phải client luôn cố định bất kể roster.

---

## Context an implementer needs

**Why `agent_email` matters here.** `table_column` seeds `(scope, key) = ('aca'|'medicare', 'agent')` with `required = true` (`supabase/schema.sql:2986-2989`), and `POST /api/enrollment` rejects an `agent_email` that is not an eligible agent (`src/app/api/enrollment/route.ts:148-158`). So sample data must use **real** agent addresses, not invented ones.

**Where agents come from.** The roster is the `task_agents` table, read by `fetchSelectedAgentEmails()` (`src/lib/tasks/assignees.ts:35-41`). It is shared by CS and Enrollment — Enrollment's agent picker already uses `fetchTaskAgents()`.

> **[CODEX REVIEW] Nên lấy `fetchTaskAgents()` làm semantic reference, không phải
> `fetchSelectedAgentEmails()`: picker/API chỉ chấp nhận agent có active portal
> account, trong khi selected-email set có thể chứa email stale. Script ESM có
> thể tự query tương đương nếu không import được helper TypeScript.**

**What the script does today** (`scripts/seed-enrollment-samples.mjs`, 716 lines):
- `acaRecords` (line 19) and `medicareRecords` (line 385) are literal arrays; `records` (line 477) concatenates them.
- `main()` (line 479) loads options, loads existing samples by `fub_link`, inserts only the missing ones.
- `toEnrollmentInsert(record, options)` (line 595) builds the row — and has **no `agent_email` key at all**.
- Sample records are identified by two `fub_link` prefixes: `SAMPLE_PREFIX` and `MEDICARE_SAMPLE_PREFIX` (lines 15-16).

**Constraint that does NOT block this.** `enrollment_records_medicare_fields_check` (`supabase/schema.sql:2665-2675`) forbids `caller_email`, `pcp_2026`, `platform_id`, `consent_id`, `payment_status_id`, `aca_status_id` on Medicare rows. `agent_email` is **not** in that list, so both programs take an agent.

**Decisions already made by the owner (do not revisit):**
- Fill agent into the **existing** sample records; do not invent new sample records.
- Backfill touches **sample records only** — real records are left alone.
- Distribution is **even round-robin**, not weighted.
- Also seed a few **assistant** relationships, because the assistant branch of the permission model cannot be tested without them.

---

### Task 1: Assign agents to enrollment sample records

**Files:**
- Modify: `scripts/seed-enrollment-samples.mjs`
- Modify: `agent-portal/changelog.md`

**Interfaces:**
- Produces: `loadAgentEmails(supabase): Promise<string[]>`, `agentFor(record, agentEmails): string`, `backfillSampleAgents(supabase, agentEmails): Promise<void>`, and a new `agent_email` key on the object returned by `toEnrollmentInsert`.
- `toEnrollmentInsert` gains a third parameter: `toEnrollmentInsert(record, options, agentEmail)`.

- [ ] **Step 1: Add the roster loader and the backfill routine**

Insert both functions immediately **above** the existing `loadOptions` (its comment block starts `// Loads every option set + option across both programs.`):

```js
// The agent roster, read live. Deliberately NOT hardcoded: the API validates
// agent_email against task_agents (api/enrollment/route.ts:148-158), so an
// invented address would create records the app itself considers invalid.
async function loadAgentEmails(supabase) {
  const { data, error } = await supabase
    .from("task_agents")
    .select("email")
    .order("email", { ascending: true });
  if (error) throw new Error(`Unable to read task_agents: ${error.message}`);

  const emails = [...new Set((data ?? []).map((row) => row.email).filter(Boolean))];
  if (emails.length === 0) {
    throw new Error(
      "task_agents is empty — select at least one agent in /config before seeding. " +
        "Seeding an unknown agent_email would create records the enrollment API rejects."
    );
  }
  return emails;
}

// Fills agent_email on sample records that already exist (everything seeded
// before agent support has agent_email NULL). Scoped to the two sample
// fub_link prefixes so real production records are never touched.
async function backfillSampleAgents(supabase, agentEmails) {
  const prefixes = [SAMPLE_PREFIX, MEDICARE_SAMPLE_PREFIX];
  const { data, error } = await supabase
    .from("enrollment_records")
    .select("id,fub_link")
    .is("agent_email", null);
  if (error) throw new Error(`Unable to read enrollment records: ${error.message}`);

  const indexByLink = new Map(records.map((record, index) => [record.fub_link, index]));
  const idsByAgent = new Map();
  let skipped = 0;

  for (const row of data ?? []) {
    const link = row.fub_link ?? "";
    if (!prefixes.some((prefix) => link.startsWith(prefix))) {
      skipped += 1;
      continue;
    }
    // Same rule as a fresh insert, so backfilled and freshly seeded records
    // end up with an identical agent distribution.
    const index = indexByLink.get(link) ?? 0;
    const agent = agentEmails[index % agentEmails.length];
    if (!idsByAgent.has(agent)) idsByAgent.set(agent, []);
    idsByAgent.get(agent).push(row.id);
  }

  let updated = 0;
  for (const [agent, ids] of idsByAgent) {
    // Only agent_email is written — updated_at is deliberately left alone so
    // the aging fixtures the samples encode stay meaningful.
    const { error: updateError } = await supabase
      .from("enrollment_records")
      .update({ agent_email: agent })
      .in("id", ids);
    if (updateError) {
      throw new Error(`Unable to backfill agent_email for ${agent}: ${updateError.message}`);
    }
    updated += ids.length;
  }

  console.log(
    `Backfilled agent_email on ${updated} sample record(s) across ${idsByAgent.size} agent(s).`
  );
  if (skipped > 0) {
    console.log(`Left ${skipped} non-sample record(s) untouched.`);
  }
}
```

> **[CODEX REVIEW — REQUIRED CHANGE] Thay `.is("agent_email", null)` trên toàn
> bảng bằng exact fixture scope ngay trong DB query. Trong loop, nếu
> `indexByLink.get(link)` là `undefined` thì log+skip; không fallback index `0`.
> Thêm assertion `updated <= records.length` trước write để một prefix collision
> không biến thành bulk mutation.**

- [ ] **Step 2: Add the deterministic assignment helper**

Insert immediately **above** `function toEnrollmentInsert(`:

```js
// Deterministic round-robin: the same client always gets the same agent across
// re-runs, so re-seeding a wiped database reproduces the same fixture.
function agentFor(record, agentEmails) {
  const index = records.indexOf(record);
  return agentEmails[(index < 0 ? 0 : index) % agentEmails.length];
}
```

- [ ] **Step 3: Write `agent_email` into the insert row**

Change the signature and add the field. Current (`:595-605`):

```js
function toEnrollmentInsert(record, options) {
  const updatedAt = record.closed_at ?? record.qc_checked_at ?? shiftIso(record.created_at, 42);
  const lookup = (setKey) => {
    const label = record[setKey];
    return label ? options.ids.get(optionKey(record.program, setKey, label)) : null;
  };
  return {
    program: record.program,
    client_name: record.client_name,
    fub_link: record.fub_link,
    due_date: record.due_date ?? null,
```

becomes:

```js
function toEnrollmentInsert(record, options, agentEmail) {
  const updatedAt = record.closed_at ?? record.qc_checked_at ?? shiftIso(record.created_at, 42);
  const lookup = (setKey) => {
    const label = record[setKey];
    return label ? options.ids.get(optionKey(record.program, setKey, label)) : null;
  };
  return {
    program: record.program,
    client_name: record.client_name,
    fub_link: record.fub_link,
    // Applies to BOTH programs: enrollment_records_medicare_fields_check
    // forbids caller/pcp_2026/platform/consent/payment/aca_status on Medicare,
    // but agent_email is not in that list.
    agent_email: record.agent_email ?? agentEmail ?? null,
    due_date: record.due_date ?? null,
```

Leave every other key in the returned object exactly as it is.

- [ ] **Step 4: Wire it into `main()`**

Current (`:479-499`):

```js
  const options = await loadOptions(supabase);
  const existing = await loadExistingSamples(supabase);
  const inserts = records
    .filter((record) => !existing.has(record.fub_link))
    .map((record) => toEnrollmentInsert(record, options));

  if (inserts.length === 0) {
    console.log(`Enrollment samples already exist. Skipped ${records.length} records.`);
    return;
  }
```

becomes — note the roster load and the backfill branch go **before** `loadOptions`, right after the `supabase` client is created:

```js
  // Every enrollment record needs a real agent (table_column seeds
  // (aca|medicare, 'agent') with required = true), and the API validates it
  // against task_agents. Read the roster instead of hardcoding it so the
  // script works on any environment.
  const agentEmails = await loadAgentEmails(supabase);

  // Backfill-only mode: fill agent_email on sample records that already exist.
  if (process.argv.includes("--backfill-agents")) {
    await backfillSampleAgents(supabase, agentEmails);
    return;
  }

  const options = await loadOptions(supabase);
  const existing = await loadExistingSamples(supabase);
  const inserts = records
    .filter((record) => !existing.has(record.fub_link))
    .map((record) =>
      toEnrollmentInsert(record, options, agentFor(record, agentEmails))
    );

  if (inserts.length === 0) {
    console.log(`Enrollment samples already exist. Skipped ${records.length} records.`);
    console.log(
      "Run with --backfill-agents to fill agent_email on the existing sample records."
    );
    return;
  }
```

- [ ] **Step 5: Static verification**

Run: `node --check scripts/seed-enrollment-samples.mjs`
Expected: no output (syntax OK).

Run: `rtk proxy npx eslint scripts/seed-enrollment-samples.mjs`
Expected: clean.

Run: `npx tsc --noEmit` and `npx vitest run`
Expected: unchanged from baseline — this script is not part of the TS build or the test suite, so both must be **exactly** as before. Any change here means something unrelated was touched.

- [ ] **Step 6: Check the roster before running against a database**

```sql
select email from task_agents order by email;
```

If this returns **zero rows**, stop: select agents in `/config` first. The script is written to fail loudly in this case rather than write junk, but finding out from SQL is faster than from a stack trace.

> **[CODEX REVIEW] Query này cũng phải join `portal_account` với
> `is_active=true`; chỉ đếm `task_agents` chưa chứng minh roster hợp lệ. Đồng thời
> Step 8 nói “Record the before value in Step 6” nhưng Step 6 chưa có query lấy
> baseline null non-sample. Thêm chính query Step 8 vào đây và lưu count trước
> khi backfill.**

- [ ] **Step 7: Run the backfill**

```bash
npm run seed:enrollment -- --backfill-agents
```

Expected output: `Backfilled agent_email on N sample record(s) across M agent(s).`

Verify:

```sql
select program, count(*) filter (where agent_email is null) as still_null,
       count(distinct agent_email) as distinct_agents, count(*) as total
from enrollment_records
where fub_link like 'https://app.followupboss.com/2/people/view/sample-%'
group by program;
```

Expected: `still_null = 0` for both programs, and `distinct_agents` equal to `min(number of agents, records in that program)`.

- [ ] **Step 8: Confirm nothing outside the samples moved**

```sql
select count(*) from enrollment_records
where agent_email is null
  and fub_link not like 'https://app.followupboss.com/2/people/view/sample-%';
```

Whatever this returns, it must be **the same number as before Step 7**. Record the before value in Step 6 so this comparison is possible.

- [ ] **Step 9: Changelog**

Add an entry at the top of `## Unreleased` in `agent-portal/changelog.md` (follow the file's own format block): enrollment sample seeding now assigns `agent_email` from the live `task_agents` roster by deterministic round-robin, for both ACA and Medicare; added `--backfill-agents` to fill the field on already-seeded samples without re-creating them; backfill is scoped to the two sample `fub_link` prefixes and writes only `agent_email`, leaving `updated_at` untouched. No schema change, no application code touched.

- [ ] **Step 10: Commit**

```bash
git add scripts/seed-enrollment-samples.mjs agent-portal/changelog.md
git commit -m "feat(seed): assign agents to enrollment sample records"
```

---

### Task 2: Seed assistant relationships so the assistant branch is testable

**Files:**
- Modify: `scripts/seed-enrollment-samples.mjs`
- Modify: `agent-portal/changelog.md`

**Interfaces:**
- Consumes: `loadAgentEmails` from Task 1.
- Produces: `seedSampleAssistants(supabase, agentEmails): Promise<void>`, run behind `--seed-assistants`.

**Why this exists:** the permission model treats an assistant exactly like the agent owner (`isAgentOwnerOrAssistant`, `src/lib/tasks/membership.ts:74-88`). With no row in `agent_members` where `is_assistant = true`, that entire branch is dead code during testing and a bug there would ship unnoticed.

> **[CODEX REVIEW — BLOCKER] Test fixture không được tự cấp production
> authorization. Nếu môi trường đã có assistant thật thì dùng row đó để test;
> nếu chưa có, tạo fixture ở DB test/staging bằng explicit email do người chạy
> cung cấp. Task này phải bị chặn trên production (ví dụ yêu cầu
> `ALLOW_PERMISSION_FIXTURE_WRITE=true` + xác nhận project ref), không chạy chung
> với seed data thông thường.**

- [ ] **Step 1: Add the seeding routine**

Insert below `backfillSampleAgents`:

```js
// Assistant membership fixture. An assistant is a CS account promoted on a
// specific agent (agent_members.is_assistant = true); the permission model
// then treats them exactly like the agent owner for that agent's records.
// Without at least one row here, the assistant branch cannot be exercised.
async function seedSampleAssistants(supabase, agentEmails) {
  const { data: accounts, error } = await supabase
    .from("portal_account")
    .select("email")
    .eq("is_active", true)
    .order("email", { ascending: true });
  if (error) throw new Error(`Unable to read portal_account: ${error.message}`);

  const agentSet = new Set(agentEmails);
  // An assistant must be someone who is NOT themselves the agent, otherwise
  // the fixture proves nothing (agent owner already has every right).
  const candidates = (accounts ?? [])
    .map((row) => row.email)
    .filter((email) => email && !agentSet.has(email));

  if (candidates.length === 0) {
    console.log("No non-agent active accounts found — skipped assistant seeding.");
    return;
  }

  // One assistant per agent, cycling through the candidate pool.
  const rows = agentEmails.map((agentEmail, index) => ({
    agent_email: agentEmail,
    cs_email: candidates[index % candidates.length],
    is_assistant: true,
  }));

  const { error: upsertError } = await supabase
    .from("agent_members")
    .upsert(rows, { onConflict: "agent_email,cs_email" });
  if (upsertError) {
    throw new Error(`Unable to seed agent_members: ${upsertError.message}`);
  }

  console.log(`Seeded ${rows.length} assistant relationship(s).`);
  for (const row of rows) {
    console.log(`  ${row.cs_email} is assistant for ${row.agent_email}`);
  }
}
```

> **[CODEX REVIEW — REQUIRED CHANGE] Candidate query hiện chỉ check active và
> non-agent, lệch với Config UI: Assistant picker chỉ lấy account có
> `task.work`/`task.manage`. Hãy require explicit candidate emails, validate active
> + permission, reject agent=self, và insert-only (`ignoreDuplicates`) thay vì
> silently promote một pair hiện có. Nếu pair tồn tại với `is_assistant=false`,
> báo conflict để owner quyết định thay vì overwrite.**

⚠️ Before writing this, confirm the primary key. `supabase/schema.sql:2211-2216` declares `agent_members` with `primary key (agent_email, cs_email)`, which is what `onConflict` above targets. Re-read that block; if the key differs in the tree you are working on, match it rather than assuming.

- [ ] **Step 2: Add the flag to `main()`**

Directly below the `--backfill-agents` branch added in Task 1:

```js
  if (process.argv.includes("--seed-assistants")) {
    await seedSampleAssistants(supabase, agentEmails);
    return;
  }
```

- [ ] **Step 3: Static verification**

Run: `node --check scripts/seed-enrollment-samples.mjs` → no output.
Run: `rtk proxy npx eslint scripts/seed-enrollment-samples.mjs` → clean.

- [ ] **Step 4: Run and verify**

```bash
npm run seed:enrollment -- --seed-assistants
```

```sql
select agent_email, cs_email, is_assistant
from agent_members
where is_assistant
order by agent_email;
```

Expected: one row per agent, each `cs_email` an active account that is **not** itself an agent.

- [ ] **Step 5: Changelog + commit**

Add to the same `## Unreleased` entry (or a second one) that `--seed-assistants` was added, seeding one assistant per agent from active non-agent accounts, so the assistant permission branch is testable.

```bash
git add scripts/seed-enrollment-samples.mjs agent-portal/changelog.md
git commit -m "feat(seed): seed assistant relationships for permission testing"
```

---

## Self-Review

**Spec coverage.** Owner decisions A1–A4 map to: A1 (fill existing, not create new) → Task 1 Steps 3–4 plus the `--backfill-agents` mode; A2 (samples only) → the prefix filter in `backfillSampleAgents` and the Step 8 proof; A3 (even round-robin) → `agentFor` and the identical rule inside the backfill; A4 (seed assistants) → Task 2.

**Placeholder scan.** No TBD, no "handle errors appropriately". Every step carries its code or its exact SQL.

**Type consistency.** `loadAgentEmails` / `agentFor` / `backfillSampleAgents` / `seedSampleAssistants` are spelled identically where defined and where called. `toEnrollmentInsert` gains exactly one parameter, and its single call site is updated in the same task.

**Risks deliberately front-loaded.**
- *Writing to a real database with the service-role key.* Mitigated by scoping the backfill to the two sample prefixes, by writing only `agent_email`, and by Step 8 proving the untouched count did not move.
- *An empty `task_agents` roster.* `loadAgentEmails` throws with an actionable message instead of writing invalid data; Step 6 catches it earlier still.
- *Re-runs producing different fixtures.* Assignment is index-based, not random, so a re-seed reproduces the same distribution.
- *Disturbing the aging fixtures.* The backfill deliberately does not touch `updated_at`; several samples encode specific ages that the operations dashboard design depends on.

**Sequencing.** Task 1 → Task 2 (Task 2 consumes `loadAgentEmails`). This plan is a prerequisite for the enrollment permission plan — without agents on records, agent/assistant scoping cannot be tested at all.

> **[CODEX REVIEW — CORRECTION] Đây chỉ là prerequisite cho manual test bằng bộ
> sample hiện tại, không phải prerequisite bắt buộc để deploy application code.
> Permission implementation phải có automated fixtures/tests độc lập và xử lý
> record null/stale an toàn; không nên ép chạy mutation sample/assistant trên
> production trước khi có thể ship security fix.**
