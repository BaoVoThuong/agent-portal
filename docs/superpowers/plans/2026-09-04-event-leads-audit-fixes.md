# Event Leads — Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps found in the 2026-09-04 re-audit of the Event Leads module: reconcile `supabase/schema.sql` with the deployed lead rollouts, add the two missing list indexes, harden the lead-list client against render cost as volume grows, normalise event-name matching, and fix one cosmetic 500.

**Architecture:** Five independent workstreams. Task 1 (schema.sql reconciliation) and Task 2 (index rollout) are DB-doc / SQL only — no app code. Tasks 3–6 are the client render-cost hardening, built the same way `src/lib/leads/list-state.ts` already is: pure logic extracted into `.ts` files that vitest (`environment: "node"`) can test, then wired into the `.tsx` components. Task 7 is a two-line route fix. Task 8 is the event-name normalisation (SQL + lib). Nothing here changes the lead RBAC model, the realtime protocol, or the `/api/leads` response shape.

**Tech Stack:** Next.js (App Router, `node_modules/next/dist/docs/` is the local reference — this is a forked Next, do not assume upstream behaviour), React 19, Supabase (Postgres + PostgREST + `getSupabaseAdmin()` service client), vitest (`environment: "node"`, no jsdom — component files cannot be unit-tested), Tailwind.

## Global Constraints

- **Reply language:** the repo's working language in comments and changelog is Vietnamese; match the surrounding file.
- **Changelog:** every logic change gets an entry in `agent-portal/changelog.md`, newest on top, following the existing format (`## YYYY-MM-DD — <area>: <summary>` then `- **Loại**: …` then bullets). UI-only / rename / test-only changes are explicitly excluded by that file's own header.
- **No auto Vercel deploy:** push to `origin` only. Do not push the `vercel` remote.
- **Migrations:** every rollout file under `supabase/rollouts/` must be **idempotent** (re-runnable as a no-op) and wrapped so a client that splits statements — the Supabase Studio SQL editor does — cannot leave a half-applied state. Follow the house style visible in `supabase/rollouts/2026-09-04-task-due-date-overdue.sql`: guard each `alter`/`create` with `if not exists` / `if exists` checks or `do $$ … end $$` blocks, and end the file with a `select … as <label>` verification query whose result a human reads.
- **schema.sql is canonical:** after the 2026-09-03 time-off white-screen incident (`fetchTimeOffDashboard` threw in a server component because code shipped ahead of a rollout), the team treats `supabase/schema.sql` as the single source of truth for "what the database looks like". A rollout that is applied to production but never folded into `schema.sql` is a latent version of that same incident. This plan's Task 1 exists to pay that debt down for the lead module.
- **Commits:** frequent, one per task-step group. Commit message language: match existing history (mix of English and Vietnamese `type(scope): summary` is fine). End every commit message with:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## Severity Assessment (the "how bad is each bug" the audit asked for)

Current production data volume, from the `queries.ts` / audit comments and the 2026-09-01 audit's production check: **~30–120 active leads**, ~30 of them Health. Every performance finding below is therefore **latent** today and rated on two axes: **now** (at ~120 leads) and **at design-target scale** (the `5.000 lead` figure the code comments in `realtime.ts` and `queries.ts` repeatedly cite — reachable in one event push).

| ID | Finding | File(s) | Severity now | Severity at 5k leads | Fix cost | Task |
|----|---------|----------|--------------|----------------------|----------|------|
| **A** | `supabase/schema.sql` is missing the entire post-2026-08-31 lead rollout surface: table `lead_assignment_weights`, column `lead_alert_settings.auto_assign_enabled`, indexes `leads_products_idx` (GIN), `leads_creator_request_unique_idx`, `leads_phone_no_event_unique_idx`, `lead_assignment_weights_active_idx`, named constraint `leads_products_valid`, functions `assign_leads_manual` / `assign_leads_round_robin` / `save_lead_assignment_weights` / `lead_sync_primary_product`, trigger `lead_sync_primary_product_trg`. | `supabase/schema.sql` | **MEDIUM** | MEDIUM | Low (mechanical) | 1 |
| **B** | Lead list has no `React.memo` on the row/cell components, no windowing, and the search box updates filter state on every keystroke with no debounce. `LeadsClient` rebuilds `alertsByLeadId`, `healthByLeadId`, `eventNames`, `displayedLeads` and every `*FilterOptions` array on every render; `LeadTable` rebuilds `statusById` / `interactionTypeById` / `optionsByColumn` / `statusChoices` / `assigneeChoices` / `pinnedOffsetByKey` on every render. | `LeadsClient.tsx`, `LeadTable.tsx` | **LOW** | **HIGH** | Medium | 3–6 |
| **C** | No index on `leads.status_id`; the default (all-products) list query `… where archived_at is null order by created_at desc` cannot use `leads_product_active_idx (product, created_at desc)` without a `product =` predicate, so it is a full scan + sort. | `supabase/rollouts/`, `supabase/schema.sql` | **LOW** (sub-ms on ~120 rows) | MEDIUM | Low | 2 |
| **D** | `resolveEventByName` matches with `ilike(name)` (a full-string case-insensitive compare) while the unique index is `lower(btrim(name))`. Internal whitespace differences (`"Health Fair"` vs `"Health  Fair"`) create two distinct events, splitting that event's row in the per-event report. The "hard error" path (a stored name with leading/trailing space that can be neither found nor created) is currently **unreachable** because every insert path trims. | `src/lib/leads/events.ts`, `supabase/rollouts/` | **LOW** | LOW | Low–Medium | 8 |
| **E** | `POST /api/leads/assign` returns HTTP 500 if the post-assignment `.select()` errors, even though `assign_leads_manual` already committed and the realtime broadcast is already scheduled. The client shows an error; a retry is a no-op that returns 404 "No active leads were found". Self-heals on refresh. | `src/app/api/leads/assign/route.ts:73-77` | **LOW** | LOW | Trivial | 7 |

**Not in this plan (deliberately):**
- **Virtualization / windowing of the lead table.** Real, but YAGNI at ~120 rows and it needs a dependency decision (`react-window` / `@tanstack/react-virtual` — neither is installed). Revisit when active leads pass ~500. Tasks 3–6 remove the per-keystroke *recompute* cost, which is the part that hurts first; windowing only becomes the bottleneck once the DOM node count (rows × columns) dominates.
- **Server-side list filtering / cursor pagination.** `fetchAllLeads` pages to completion and the client filters in memory — the same model the task board uses. Changing it is a redesign of `/api/leads`, `LeadsClient` state, and the realtime patch path. The 2026-09-01 audit's O3 already pushed the fallback poll to 5 minutes and made realtime patch-by-id (`7e86bd3`), which removes the routine cost. The initial-load payload stays O(active leads); accept it until volume forces the redesign.
- **B2 / O5 (duplicate "who can receive a lead" rule)** — already closed by `canBeAssignedLead()` since the 2026-09-01 audit.

---

## File Structure

**Task 1 — schema.sql reconciliation**
- Modify: `supabase/schema.sql` — insert the missing lead DDL into the existing lead section (functions after `log_lead_interaction_atomic` at ~line 6405; tables/indexes near the existing lead indexes at ~line 6240). One responsibility: mirror the deployed database.

**Task 2 — list index rollout**
- Create: `supabase/rollouts/2026-09-04-lead-list-indexes.sql` — two `create index if not exists`.
- Modify: `supabase/schema.sql` — same two indexes, beside the other lead indexes.

**Tasks 3–6 — lead list render cost**
- Create: `src/lib/leads/list-derivations.ts` — pure functions that build the per-render lookup maps and the displayed-row list, extracted from `LeadsClient`/`LeadTable` so vitest can pin them.
- Create: `src/lib/leads/list-derivations.test.ts`
- Create: `src/lib/leads/use-debounced-value.ts` — a 3-line hook (`.ts`, no JSX, so it is importable without a jsdom env even though it is a hook).
- Modify: `src/app/(authed)/tasks/leads/_components/LeadsClient.tsx` — wrap derivations in `useMemo`, handlers in `useCallback`, feed the search box through the debounce hook.
- Modify: `src/app/(authed)/tasks/leads/_components/LeadTable.tsx` — `memo()` the row and cell, hoist the lookup maps to `useMemo`.

**Task 7 — assign route**
- Modify: `src/app/api/leads/assign/route.ts:73-87`

**Task 8 — event name normalisation**
- Create: `supabase/rollouts/2026-09-04-lead-event-name-normalize.sql`
- Modify: `supabase/schema.sql` — the `lead_events_name_unique_idx` definition.
- Modify: `src/lib/leads/events.ts` — normalise the search term the same way.
- Create: `src/lib/leads/events.test.ts` (currently no test file for this module) OR add to an existing one if created.

---

### Task 1: Reconcile `supabase/schema.sql` with the deployed lead rollouts

**Files:**
- Modify: `supabase/schema.sql` (lead section, ~lines 6109–6410)

**Interfaces:**
- Consumes: the authoritative DDL text from `supabase/rollouts/2026-09-02-lead-auto-assign.sql`, `2026-09-02-lead-write-integrity.sql`, `2026-09-03-lead-multi-product.sql`, `2026-09-03-lead-weights-atomic.sql`.
- Produces: a `schema.sql` that, run against an empty database, yields the same lead schema production has. Later tasks add two more indexes on top.

**Background — exactly what is missing (verified 2026-09-04 by grepping `schema.sql`):**

| Object | Kind | Rollout it lives in | Notes |
|--------|------|---------------------|-------|
| `lead_assignment_weights` | table | `2026-09-02-lead-auto-assign.sql:14` | per-product distribution ratio + rotation cursor |
| `lead_assignment_weights_active_idx` | index | `2026-09-02-lead-auto-assign.sql:39` | |
| `lead_alert_settings.auto_assign_enabled` | column | `2026-09-02-lead-auto-assign.sql` | `boolean not null default false` — confirm exact line in the rollout |
| `leads_creator_request_unique_idx` | unique index | `2026-09-02-lead-write-integrity.sql:74` | idempotency for `POST /api/leads` |
| `leads_phone_no_event_unique_idx` | unique index | `2026-09-02-lead-write-integrity.sql:82` | duplicate-phone guard for `event_id IS NULL` leads |
| `leads_products_valid` | named constraint | `2026-09-03-lead-multi-product.sql:41` | `check (products <@ array['pc','health'])` — `schema.sql` currently has an **unnamed inline** equivalent on the column; replace with the named constraint so `drop constraint … if exists` in the rollout has a target |
| `leads_products_idx` | GIN index | `2026-09-03-lead-multi-product.sql:48` | `using gin (products)` — the index `queries.ts:192` comment claims exists |
| `lead_sync_primary_product` + `_trg` | function + trigger | `2026-09-03-lead-multi-product.sql` | keeps scalar `leads.product` = `products[1]` |
| `assign_leads_round_robin` | function | **latest def**: `2026-09-03-lead-multi-product.sql` (re-defined there after `2026-09-02-lead-auto-assign.sql`) | take the multi-product version |
| `assign_leads_manual` | function | `2026-09-02-lead-auto-assign.sql` | confirm no later redefinition |
| `save_lead_assignment_weights` | function | **latest def**: `2026-09-03-lead-weights-atomic.sql` (re-defined there) | take the atomic version |

`log_lead_interaction_atomic` is only defined in `2026-08-31-lead-final.sql` and is already in `schema.sql` — leave it.

- [ ] **Step 1: Produce a definitive diff of what production has vs. what `schema.sql` has**

Run each of these and record the count (0 = missing from schema.sql, confirming the table above):

```bash
cd agent-portal
for obj in lead_assignment_weights lead_assignment_weights_active_idx \
  leads_products_idx leads_creator_request_unique_idx leads_phone_no_event_unique_idx \
  assign_leads_manual assign_leads_round_robin save_lead_assignment_weights \
  lead_sync_primary_product lead_sync_primary_product_trg auto_assign_enabled leads_products_valid; do
  printf '%-38s ' "$obj"; grep -c "$obj" supabase/schema.sql
done
```

Expected: every line prints `0` except `auto_assign_enabled` and `leads_products_valid` which you should also confirm are `0`.

If any object is now non-zero (someone folded part of it in since this plan was written), skip that object in the steps below and note it in the commit message.

- [ ] **Step 2: Copy the table + its index + the column into the lead-tables block**

Open `supabase/schema.sql`. Find the end of the `lead_alert_settings` table definition and its seed (`insert into lead_alert_settings (product) values ('pc'), ('health') on conflict (product) do nothing;`, ~line 6222).

Immediately after that seed, before the lead-index comment block, paste — copied **verbatim** from `supabase/rollouts/2026-09-02-lead-auto-assign.sql` — the `create table if not exists lead_assignment_weights (…)` block and its `create index if not exists lead_assignment_weights_active_idx …`.

Then find the `lead_alert_settings` table body in `schema.sql` and add the column that `2026-09-02-lead-auto-assign.sql` adds (verify the exact spelling/default in that rollout — it is an `alter table lead_alert_settings add column if not exists auto_assign_enabled …`). In `schema.sql` it becomes an inline column in the `create table` body:

```sql
  -- Bật/tắt tự chia lead khi import, theo từng product. Xem 2026-09-02-lead-auto-assign.sql.
  auto_assign_enabled boolean not null default false,
```

- [ ] **Step 3: Add the three missing lead indexes + the named products constraint**

Find the existing lead index block in `schema.sql` (starts with the comment `-- Index bám đúng cách bảng được đọc…`, contains `leads_product_active_idx`, `leads_assigned_idx`, `leads_event_idx`, `lead_interactions_lead_idx`, `lead_assignment_history_lead_idx`, `leads_event_phone_unique_idx`).

Append to that block, verbatim from the rollouts:

```sql
-- Idempotency cho POST /api/leads (2026-09-02-lead-write-integrity.sql).
create unique index if not exists leads_creator_request_unique_idx
  on leads (created_by_email, client_request_id)
  where client_request_id is not null;

-- Chặn trùng số điện thoại cho lead KHÔNG thuộc event nào — partial unique index
-- vì `(event_id, phone)` không ràng buộc được hai dòng có event_id IS NULL
-- (2026-09-02-lead-write-integrity.sql).
create unique index if not exists leads_phone_no_event_unique_idx
  on leads (phone)
  where phone is not null and event_id is null and archived_at is null;

-- `products @> array[...]` cho bộ lọc product và pool theo product
-- (2026-09-03-lead-multi-product.sql).
create index if not exists leads_products_idx on leads using gin (products);
```

> Use the exact index bodies from the rollout files, not the paraphrase above, if they differ.

For `leads_products_valid`: in the `create table if not exists leads (…)` body, the `products` column currently reads:

```sql
  products text[] not null default '{}'::text[] check (
    products <@ array['pc', 'health']::text[]
  ),
```

Change it to drop the inline `check` and add a **named table constraint** after the column list (so it matches what `2026-09-03-lead-multi-product.sql` creates and what its `drop constraint if exists leads_products_valid` targets):

```sql
  products text[] not null default '{}'::text[],
```
…and in the constraint section of the `create table` (or immediately after it, as a separate `alter table … add constraint`):

```sql
  constraint leads_products_valid check (products <@ array['pc', 'health']::text[]),
```

- [ ] **Step 4: Add the four missing functions + the trigger**

Find where `log_lead_interaction_atomic` ends in `schema.sql` (after its `grant execute … to …` line, ~6405). After it, paste — verbatim, taking the **latest** definition where a function is defined twice:

1. `lead_sync_primary_product()` + `drop trigger if exists lead_sync_primary_product_trg …` + `create trigger lead_sync_primary_product_trg …` — from `2026-09-03-lead-multi-product.sql`.
2. `assign_leads_round_robin(…)` — from `2026-09-03-lead-multi-product.sql` (its later, multi-product-aware definition), **plus** its `revoke` / `grant` lines.
3. `assign_leads_manual(…)` — from `2026-09-02-lead-auto-assign.sql`, plus its `revoke` / `grant`.
4. `save_lead_assignment_weights(…)` — from `2026-09-03-lead-weights-atomic.sql` (the atomic version), plus its `revoke` / `grant`.

Keep them in dependency order: `lead_norm_email` (already in schema.sql at ~6109) is used by the round-robin RPC, so it must appear before — it already does.

- [ ] **Step 5: Verify the file parses and nothing else drifted**

```bash
cd agent-portal
# No syntax check tool is wired; do a structural sanity check instead.
grep -c "create or replace function assign_leads_round_robin" supabase/schema.sql   # expect 1
grep -c "create table if not exists lead_assignment_weights" supabase/schema.sql    # expect 1
grep -c "lead_sync_primary_product_trg" supabase/schema.sql                          # expect 2 (drop + create)
grep -c "leads_products_idx" supabase/schema.sql                                     # expect 1
node scripts/check-schema-drift.mjs 2>&1 | tail -5   # unrelated to leads today, but must still pass
```

Expected: the counts match; `check-schema-drift.mjs` output is unchanged from before this task (it only checks the time-off surface).

- [ ] **Step 6: Changelog + commit**

Add to `agent-portal/changelog.md` under a new dated heading:

```markdown
## 2026-09-04 — Leads: schema.sql bắt kịp 4 rollout đã deploy

- **Loại**: chore (đồng bộ schema canonical) — không đổi hành vi production.
- `supabase/schema.sql` thiếu toàn bộ mặt DDL của lead sau 2026-08-31: bảng
  `lead_assignment_weights`, cột `lead_alert_settings.auto_assign_enabled`, index
  `leads_products_idx` (GIN) / `leads_creator_request_unique_idx` /
  `leads_phone_no_event_unique_idx` / `lead_assignment_weights_active_idx`, ràng
  buộc có tên `leads_products_valid`, các hàm `assign_leads_manual` /
  `assign_leads_round_robin` (bản multi-product) / `save_lead_assignment_weights`
  (bản atomic) / `lead_sync_primary_product` và trigger của nó.
- Production đã có đủ qua rollout; đây là trả nợ cho nguyên tắc "schema.sql là
  nguồn sự thật" đã chốt sau sự cố time-off 2026-09-03. Dựng lại DB từ schema.sql
  trước thay đổi này sẽ thiếu bảng Distribute, RPC gán, trigger đồng bộ
  `product`, và mọi ràng buộc chống trùng.
```

```bash
cd agent-portal
git add supabase/schema.sql changelog.md
git commit -m "chore(leads): fold post-2026-08-31 lead rollouts into schema.sql

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Add the two missing lead-list indexes

**Files:**
- Create: `supabase/rollouts/2026-09-04-lead-list-indexes.sql`
- Modify: `supabase/schema.sql` (lead index block)

**Interfaces:**
- Consumes: nothing.
- Produces: index `leads_status_active_idx` and `leads_active_created_idx`. No app code reads these by name; they only change query plans for `fetchLeadsPage` in `src/lib/leads/queries.ts`.

**Why these two, from `src/lib/leads/queries.ts:184-198`:**
```ts
let query = supabase
  .from("leads")
  .select(LEAD_LIST_COLUMNS, filter.offset === 0 ? { count: "exact" } : {})
  .is("archived_at", null)
  .order("created_at", { ascending: false })
  .order("id", { ascending: true })
  .range(filter.offset, filter.offset + filter.limit - 1);
if (filter.product) query = query.contains("products", [filter.product]);   // uses leads_products_idx (GIN) — already exists
if (filter.ownerEmails) query = query.in("assigned_to_email", filter.ownerEmails);  // uses leads_assigned_idx — already exists
if (filter.eventId) query = query.eq("event_id", filter.eventId);            // uses leads_event_idx — already exists
if (filter.statusId) query = query.eq("status_id", filter.statusId);         // NO INDEX
```
- The default view (no product filter, a manager) is `archived_at is null ORDER BY created_at desc, id` → `leads_product_active_idx (product, created_at desc) where archived_at is null` cannot drive that ordering without `product =`. Add `leads_active_created_idx (created_at desc, id) where archived_at is null`.
- `filter.statusId` (the Status dropdown, and the alert query's `status_id.not.in.(…)` at `queries.ts:205`) has nothing. Add `leads_status_active_idx (status_id) where archived_at is null`.

- [ ] **Step 1: Write the rollout**

Create `supabase/rollouts/2026-09-04-lead-list-indexes.sql`:

```sql
-- =====================================================================
-- Hai index cho đường đọc chính của danh sách lead.
--
-- 1. Danh sách mặc định (không lọc product) sắp theo created_at desc. Index
--    `leads_product_active_idx (product, created_at desc)` không phục vụ được
--    nếu không có mệnh đề `product = …`, nên Postgres quét toàn bộ tập active
--    rồi sort. Ở vài trăm dòng không đáng kể; ở vài nghìn thì có.
-- 2. Bộ lọc Status (`?status_id=`) và mệnh đề `status_id not in (...)` của truy
--    vấn cảnh báo không có index nào.
--
-- Idempotent. `create index if not exists` chạy lại là no-op.
-- KHÔNG dùng `concurrently`: Supabase Studio bọc mỗi lần gửi trong một
-- transaction, và `create index concurrently` không chạy trong transaction.
-- =====================================================================

create index if not exists leads_active_created_idx
  on leads (created_at desc, id)
  where archived_at is null;

create index if not exists leads_status_active_idx
  on leads (status_id)
  where archived_at is null;

-- Kiểm chứng: cả hai phải xuất hiện.
select indexname
from pg_indexes
where tablename = 'leads'
  and indexname in ('leads_active_created_idx', 'leads_status_active_idx')
order by indexname;
```

- [ ] **Step 2: Mirror into schema.sql**

In `supabase/schema.sql`, append to the lead index block (the same block Task 1 Step 3 edited):

```sql
-- Danh sách mặc định: archived_at is null, sắp created_at desc
-- (2026-09-04-lead-list-indexes.sql).
create index if not exists leads_active_created_idx
  on leads (created_at desc, id)
  where archived_at is null;

-- Bộ lọc Status và mệnh đề status_id NOT IN của truy vấn cảnh báo
-- (2026-09-04-lead-list-indexes.sql).
create index if not exists leads_status_active_idx
  on leads (status_id)
  where archived_at is null;
```

- [ ] **Step 3: Verify**

```bash
cd agent-portal
grep -c "leads_active_created_idx" supabase/schema.sql   # expect 1
grep -c "leads_status_active_idx" supabase/schema.sql     # expect 1
```

- [ ] **Step 4: Changelog + commit**

```markdown
## 2026-09-04 — Leads: index cho danh sách mặc định và bộ lọc Status

- **Loại**: perf (chỉ số plan truy vấn) — cần chạy rollout
  `2026-09-04-lead-list-indexes.sql` trên production.
- `leads_active_created_idx (created_at desc, id) where archived_at is null` cho
  danh sách khi không lọc product; `leads_status_active_idx (status_id) where
  archived_at is null` cho bộ lọc Status và mệnh đề `status_id not in (...)` của
  truy vấn cảnh báo. Ở dữ liệu hiện tại (~120 lead) khác biệt chưa đo được; đây
  là chuẩn bị cho quy mô một đợt event.
```

```bash
cd agent-portal
git add supabase/rollouts/2026-09-04-lead-list-indexes.sql supabase/schema.sql changelog.md
git commit -m "perf(leads): add default-list and status-filter indexes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract the lead-list derivations into a testable `.ts` module

**Files:**
- Create: `src/lib/leads/list-derivations.ts`
- Create: `src/lib/leads/list-derivations.test.ts`

**Interfaces:**
- Consumes: `LeadRow`, `LeadStatus`, `LeadInteractionType` from `@/lib/leads/types`; `TableColumn`, `TableColumnOption` from `@/lib/table-config/types`; `resolveLeadAlerts` / `LeadAlert` from `./alerts`; `classifyLeadHealth` / `LeadHealth` from `./health`; `settingsForLead` / `LeadAlertSettingsByProduct` from `./overview`; `buildStatusById` from `./status-lookup`.
- Produces:
  - `buildLeadLookups(statuses: LeadStatus[], archivedStatuses: LeadStatus[], interactionTypes: LeadInteractionType[], columnOptions: TableColumnOption[]): LeadLookups`
    where `type LeadLookups = { statusById: Map<string, LeadStatus>; statusNameById: Map<string, string>; interactionTypeById: Map<string, LeadInteractionType>; optionsByColumn: Map<string, TableColumnOption[]> }`
  - `buildLeadBadges(leads: readonly LeadRow[], lookups: Pick<LeadLookups, "statusById">, alertSettings: LeadAlertSettingsByProduct): LeadBadges`
    where `type LeadBadges = { alertsByLeadId: Map<string, LeadAlert[]>; healthByLeadId: Map<string, LeadHealth>; healthCounts: Record<LeadHealth, number> }`
  - `collectEventNames(leads: readonly LeadRow[]): string[]` — distinct, sorted `localeCompare`.

These are the maps currently built inline at `LeadsClient.tsx:704-756` and `LeadTable.tsx:127-137`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/leads/list-derivations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildLeadLookups,
  buildLeadBadges,
  collectEventNames,
} from "./list-derivations";
import type { LeadRow, LeadStatus, LeadInteractionType } from "./types";
import type { LeadAlertSettingsByProduct } from "./overview";

const status = (over: Partial<LeadStatus>): LeadStatus => ({
  id: "s1", label: "New", color: null, position: 1, kind: "open", archived_at: null, ...over,
});

const lead = (over: Partial<LeadRow>): LeadRow => ({
  id: "l1", display_number: 1, product: "health", products: ["health"], event_id: null,
  full_name: "A", phone: null, email: null, assigned_to_email: null, assigned_at: null,
  assigned_by_email: null, status_id: null, first_contacted_at: null, last_contacted_at: null,
  contact_attempt_count: 0, next_follow_up_at: null, closed_at: null, created_by_email: "x",
  created_at: "2026-09-01T00:00:00Z", updated_by_email: null, updated_at: "2026-09-01T00:00:00Z",
  custom_values: {}, archived_at: null, event_name: null, interaction_history: [], ...over,
});

const settings: LeadAlertSettingsByProduct = {
  pc: { product: "pc", no_contact_hours: 24, stale_days: 3, max_attempts: 4 },
  health: { product: "health", no_contact_hours: 24, stale_days: 3, max_attempts: 4 },
};

describe("buildLeadLookups", () => {
  it("indexes active + archived statuses and keeps a label-only map", () => {
    const l = buildLeadLookups(
      [status({ id: "a", label: "New" })],
      [status({ id: "z", label: "Old", archived_at: "2026-01-01T00:00:00Z" })],
      [{ id: "t1", label: "Call", color: null, position: 1, counts_as_contact: true, archived_at: null } as LeadInteractionType],
      [{ id: "o1", column_id: "c1", label: "Yes", color: null, position: 1 } as never],
    );
    expect(l.statusById.get("a")?.label).toBe("New");
    expect(l.statusById.get("z")?.label).toBe("Old"); // archived still resolvable
    expect(l.statusNameById.get("a")).toBe("New");
    expect(l.statusNameById.has("z")).toBe(false);    // label map is active-only
    expect(l.interactionTypeById.get("t1")?.label).toBe("Call");
    expect(l.optionsByColumn.get("c1")).toHaveLength(1);
  });
});

describe("buildLeadBadges", () => {
  it("flags an assigned, never-contacted lead and buckets it once", () => {
    const rows = [
      lead({ id: "x", assigned_to_email: "a@x.co", assigned_at: "2026-08-01T00:00:00Z" }),
    ];
    const lookups = buildLeadLookups([], [], [], []);
    const badges = buildLeadBadges(rows, lookups, settings);
    expect(badges.alertsByLeadId.get("x")).toContain("never_contacted");
    expect(badges.healthByLeadId.get("x")).toBe("never_contacted");
    expect(badges.healthCounts.never_contacted).toBe(1);
    expect(badges.healthCounts.on_track).toBe(0);
  });

  it("health buckets partition the list (counts sum to length)", () => {
    const rows = [
      lead({ id: "1" }),
      lead({ id: "2", assigned_to_email: "a@x.co", assigned_at: "2026-08-01T00:00:00Z" }),
      lead({ id: "3", assigned_to_email: "b@x.co", assigned_at: new Date().toISOString() }),
    ];
    const badges = buildLeadBadges(rows, buildLeadLookups([], [], [], []), settings);
    const sum = Object.values(badges.healthCounts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(rows.length);
  });
});

describe("collectEventNames", () => {
  it("returns distinct trimmed names sorted", () => {
    const rows = [
      lead({ id: "1", event_name: "  Health Fair " }),
      lead({ id: "2", event_name: "Health Fair" }),
      lead({ id: "3", event_name: "Auto Expo" }),
      lead({ id: "4", event_name: null }),
    ];
    expect(collectEventNames(rows)).toEqual(["Auto Expo", "Health Fair"]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd agent-portal && npx vitest run src/lib/leads/list-derivations.test.ts`
Expected: FAIL — `Failed to resolve import "./list-derivations"`.

- [ ] **Step 3: Write `list-derivations.ts`**

Create `src/lib/leads/list-derivations.ts`. Move the logic verbatim from the component bodies — do not rewrite it:

```ts
import { resolveLeadAlerts, type LeadAlert } from "./alerts";
import {
  classifyLeadHealth,
  emptyLeadHealthCounts,
  type LeadHealth,
} from "./health";
import { settingsForLead, type LeadAlertSettingsByProduct } from "./overview";
import { buildStatusById } from "./status-lookup";
import type {
  LeadInteractionType,
  LeadRow,
  LeadStatus,
} from "./types";
import type { TableColumnOption } from "@/lib/table-config/types";

export type LeadLookups = {
  /** Active + archived: an archived status still labels an old row, and
   *  resolveLeadAlerts must see the real kind or it treats a closed lead as
   *  open. Same reasoning as LeadsClient.tsx:704. */
  statusById: Map<string, LeadStatus>;
  /** Active only — this feeds the sort's status-label comparator and the
   *  Status filter dropdown. */
  statusNameById: Map<string, string>;
  interactionTypeById: Map<string, LeadInteractionType>;
  optionsByColumn: Map<string, TableColumnOption[]>;
};

export function buildLeadLookups(
  statuses: LeadStatus[],
  archivedStatuses: LeadStatus[],
  interactionTypes: LeadInteractionType[],
  columnOptions: TableColumnOption[],
): LeadLookups {
  const statusById = buildStatusById(statuses, archivedStatuses);
  const statusNameById = new Map(statuses.map((s) => [s.id, s.label]));
  const interactionTypeById = new Map(
    interactionTypes.map((t) => [t.id, t]),
  );
  const optionsByColumn = new Map<string, TableColumnOption[]>();
  for (const option of columnOptions) {
    optionsByColumn.set(option.column_id, [
      ...(optionsByColumn.get(option.column_id) ?? []),
      option,
    ]);
  }
  return { statusById, statusNameById, interactionTypeById, optionsByColumn };
}

export type LeadBadges = {
  alertsByLeadId: Map<string, LeadAlert[]>;
  healthByLeadId: Map<string, LeadHealth>;
  healthCounts: Record<LeadHealth, number>;
};

export function buildLeadBadges(
  leads: readonly LeadRow[],
  lookups: Pick<LeadLookups, "statusById">,
  alertSettings: LeadAlertSettingsByProduct,
): LeadBadges {
  const alertsByLeadId = new Map<string, LeadAlert[]>();
  const healthByLeadId = new Map<string, LeadHealth>();
  const healthCounts = emptyLeadHealthCounts();
  for (const lead of leads) {
    const status = lead.status_id
      ? lookups.statusById.get(lead.status_id) ?? null
      : null;
    const forLead = settingsForLead(alertSettings, lead);
    alertsByLeadId.set(lead.id, resolveLeadAlerts(lead, status, forLead));
    const bucket = classifyLeadHealth(lead, status, forLead);
    healthByLeadId.set(lead.id, bucket);
    healthCounts[bucket] += 1;
  }
  return { alertsByLeadId, healthByLeadId, healthCounts };
}

export function collectEventNames(leads: readonly LeadRow[]): string[] {
  return [
    ...new Set(
      leads
        .map((lead) => lead.event_name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort((a, b) => a.localeCompare(b));
}
```

> Check the real signatures of `classifyLeadHealth`, `emptyLeadHealthCounts`, `settingsForLead`, `buildStatusById`, `resolveLeadAlerts` in their source files and adjust the calls if they differ from the above. `resolveLeadAlerts(lead, status, settings, now?)` — the 4th arg defaults to `new Date()`, leave it defaulted so badges stay live.

- [ ] **Step 4: Run the test**

Run: `cd agent-portal && npx vitest run src/lib/leads/list-derivations.test.ts`
Expected: PASS (3 files? no — 1 file, all `it` green). If a signature mismatch surfaces, fix `list-derivations.ts` and re-run.

- [ ] **Step 5: Commit**

```bash
cd agent-portal
git add src/lib/leads/list-derivations.ts src/lib/leads/list-derivations.test.ts
git commit -m "refactor(leads): extract list lookup/badge derivations into a testable module

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Add a debounced-value hook and wire the lead search box through it

**Files:**
- Create: `src/lib/leads/use-debounced-value.ts`
- Create: `src/lib/leads/use-debounced-value.test.ts`
- Modify: `src/app/(authed)/tasks/leads/_components/LeadsClient.tsx`

**Interfaces:**
- Produces: `useDebouncedValue<T>(value: T, delayMs: number): T` — returns `value` after it has stopped changing for `delayMs`. Also export the pure core `debounceReducer` is unnecessary; instead export nothing else.
- The hook uses `useState` + `useEffect` only. It is a `.ts` file (no JSX) so it imports fine; but it still cannot be unit-tested under `environment: "node"` without React test utils. Test the **timing contract** with a tiny non-React helper instead (below), and keep the hook itself trivial enough to read.

- [ ] **Step 1: Write the hook**

Create `src/lib/leads/use-debounced-value.ts`:

```ts
import { useEffect, useState } from "react";

/**
 * Trả về `value` sau khi nó ngừng đổi trong `delayMs`. Ô Search của danh sách
 * lead gọi setState mỗi lần gõ; nếu không hoãn, mỗi ký tự kéo theo một lần
 * filterLeads + sortLeads + render lại toàn bảng. Ở vài nghìn lead đó là khựng
 * thấy được mỗi phím.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
```

- [ ] **Step 2: Wire it into `LeadsClient`**

In `src/app/(authed)/tasks/leads/_components/LeadsClient.tsx`:

Add the import near the other `@/lib/leads/*` imports:
```ts
import { useDebouncedValue } from "@/lib/leads/use-debounced-value";
```

The search box already writes to `filters.search` (line ~975-978). Keep that — the input must stay responsive. Add a debounced copy and use it only where filtering happens. Immediately before `const displayedLeads = (() => {` (line ~771):

```ts
  // Ô input vẫn cập nhật filters.search tức thì (người dùng phải thấy chữ mình
  // gõ); chỉ việc LỌC mới hoãn lại.
  const debouncedSearch = useDebouncedValue(filters.search, 200);
  const effectiveFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch],
  );
```

Then change `filterLeads(leads, filters, healthByLeadId)` inside `displayedLeads` to `filterLeads(leads, effectiveFilters, healthByLeadId)`.

Leave `activeLeadFilterCount(filters)` and the toolbar's `filters.search` bindings as-is — the count and the clear-button should react to the raw value.

- [ ] **Step 3: Verify build + existing tests**

```bash
cd agent-portal
npx tsc --noEmit 2>&1 | tail -5
npx vitest run src/lib/leads 2>&1 | tail -10
```
Expected: `No errors found`; all lead tests pass.

- [ ] **Step 4: Manual check**

```bash
# From the run skill or `npm run dev`; open /tasks/leads, type quickly in Search.
# Expected: characters appear with no lag; the "N of M leads" count updates a
# beat after you stop typing, not on every keystroke.
```

- [ ] **Step 5: Changelog + commit**

```markdown
## 2026-09-04 — Leads: hoãn lọc theo ô Search

- **Loại**: perf (client).
- Ô Search vẫn hiện ký tự tức thì nhưng việc lọc + sắp xếp + render lại bảng
  hoãn 200ms sau phím cuối. Ở ~120 lead không cảm nhận được; ở quy mô một đợt
  event thì đây là khác biệt giữa gõ mượt và khựng từng phím.
```

```bash
cd agent-portal
git add src/lib/leads/use-debounced-value.ts src/app/(authed)/tasks/leads/_components/LeadsClient.tsx changelog.md
git commit -m "perf(leads): debounce the lead-list search filter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Memoise the derivations in `LeadsClient` and stabilise its handlers

**Files:**
- Modify: `src/app/(authed)/tasks/leads/_components/LeadsClient.tsx`

**Interfaces:**
- Consumes: `buildLeadLookups`, `buildLeadBadges`, `collectEventNames` from `@/lib/leads/list-derivations` (Task 3).
- Produces: nothing new; this task only wraps existing render-body work in `useMemo` / `useCallback` so `<LeadTable>`'s props stop changing identity on every keystroke.

- [ ] **Step 1: Replace the inline derivations with memoised calls**

In `LeadsClient.tsx`, add the import:
```ts
import {
  buildLeadLookups,
  buildLeadBadges,
  collectEventNames,
} from "@/lib/leads/list-derivations";
```

Delete the inline blocks at ~lines 704-756:
```ts
const statusById = buildStatusById(statuses, archivedStatuses);
const statusNameById = new Map(statuses.map((status) => [status.id, status.label]));
const eventNames = [ ...new Set( leads.map(...) ) ].sort(...);
// ...
const alertsByLeadId = new Map( leads.map((lead) => [ ... ]) );
const healthByLeadId = new Map( leads.map((lead) => [ ... ]) );
const healthCounts = emptyLeadHealthCounts();
for (const bucket of healthByLeadId.values()) healthCounts[bucket] += 1;
```

Replace with:
```ts
  const lookups = useMemo(
    () => buildLeadLookups(statuses, archivedStatuses, interactionTypes, columnOptions),
    [statuses, archivedStatuses, interactionTypes, columnOptions],
  );
  const { statusById, statusNameById } = lookups;

  // alerts + health chỉ phụ thuộc leads và alertSettings — KHÔNG phụ thuộc
  // filters, nên tách khỏi đường gõ Search. `alertSettings` là prop tĩnh; `now`
  // bên trong resolveLeadAlerts vẫn là thời điểm render nên badge vẫn tươi.
  const { alertsByLeadId, healthByLeadId, healthCounts } = useMemo(
    () => buildLeadBadges(leads, lookups, alertSettings),
    [leads, lookups, alertSettings],
  );

  const eventNames = useMemo(() => collectEventNames(leads), [leads]);
```

Remove now-unused imports (`buildStatusById`, `emptyLeadHealthCounts`, `resolveLeadAlerts`, `classifyLeadHealth`, `settingsForLead` — check each; `settingsForLead` and `resolveLeadAlerts` may still be referenced elsewhere in the file, only remove if `tsc` says unused).

- [ ] **Step 2: Memoise the filter-option arrays and `displayedLeads`**

The `assigneeFilterOptions` / `statusFilterOptions` / `eventFilterOptions` / `healthFilterOptions` arrays (~lines 716-769) and `displayedLeads` (~771) are rebuilt every render. Wrap them:

```ts
  const statusFilterOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: "All statuses" },
      ...statuses.map((s) => ({ value: s.id, label: s.label })),
    ],
    [statuses],
  );
  const eventFilterOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: "All events" },
      ...eventNames.map((name) => ({ value: name, label: name })),
    ],
    [eventNames],
  );
  const assigneeFilterOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: "All assignees" },
      { value: UNASSIGNED_FILTER, label: "Unassigned" },
      ...assigneeOptions,
    ],
    [assigneeOptions],
  );
  const healthFilterOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: `All leads (${leads.length})` },
      ...LEAD_HEALTH_BUCKETS.filter(
        (bucket) => healthCounts[bucket] > 0 || filters.health === bucket,
      ).map((bucket) => ({
        value: bucket,
        label: `${LEAD_HEALTH_LABEL[bucket]} (${healthCounts[bucket]})`,
      })),
    ],
    [leads.length, healthCounts, filters.health],
  );

  const displayedLeads = useMemo(() => {
    const matched = filterLeads(leads, effectiveFilters, healthByLeadId);
    if (!sortKey) return matched;
    return sortLeads(matched, sortKey, sortDir, {
      statusLabel: (id) => (id ? statusNameById.get(id) ?? null : null),
      personLabel: (email) => personLabel(email, nameByEmail),
    });
  }, [leads, effectiveFilters, healthByLeadId, sortKey, sortDir, statusNameById, nameByEmail]);
```

(`effectiveFilters` comes from Task 4. If Tasks are done out of order, use `filters` and fold in the debounce later.)

- [ ] **Step 3: Wrap the handlers passed to `<LeadTable>` in `useCallback`**

`patchLead`, `assignLead`, `toggleLead`, `toggleSort`, `updateLead`, and the inline `onSelectVisible` / `onFollowUpNeeded` / `onOpenLead` arrows are recreated every render. `<LeadTable>` (Task 6) will be `memo`-wrapped, so these must be stable.

Convert the `function patchLead(...)` / `function assignLead(...)` / `function toggleLead(...)` / `function updateLead(...)` / `function toggleSort(...)` declarations to `const … = useCallback(async (…) => { … }, [deps])`. Determine deps from the body:
- `toggleLead`: `[]` (only uses `setSelected` updater form).
- `toggleSort`: `[sortKey, sortDir]`.
- `updateLead`: `[activeAlert]` (calls `patchLeadsByIdRef` — a ref, not a dep).
- `patchLead`: `[leads, sourceId, activeAlert, updateLead]`.
- `assignLead`: `[sourceId, applyReturnedLeads?]` — `applyReturnedLeads` is itself defined in render; wrap it too, deps `[]` (refs only) — verify.

For the inline arrows in the `<LeadTable … />` JSX (`onFollowUpNeeded={(lead, statusId) => setFollowUpPrompt({ lead, statusId })}`, `onSelectVisible={(checked) => setSelected(checked ? … : …)}`, `onOpenLead={setSelectedLead}`), hoist to `useCallback`:
```ts
  const handleFollowUpNeeded = useCallback(
    (lead: LeadRow, statusId: string) => setFollowUpPrompt({ lead, statusId }),
    [],
  );
  const handleSelectVisible = useCallback(
    (checked: boolean) =>
      setSelected(checked ? new Set(displayedLeadsRef.current.map((l) => l.id)) : new Set()),
    [],
  );
```
`handleSelectVisible` needs the *current* `displayedLeads` without taking it as a dep (or it changes every filter). Add a ref:
```ts
  const displayedLeadsRef = useRef(displayedLeads);
  useEffect(() => { displayedLeadsRef.current = displayedLeads; });
```
`onOpenLead={setSelectedLead}` is already stable (a `useState` setter) — leave it.

- [ ] **Step 4: Verify**

```bash
cd agent-portal
npx tsc --noEmit 2>&1 | tail -5
npx eslint "src/app/(authed)/tasks/leads/_components/LeadsClient.tsx" 2>&1 | tail -5
npx vitest run src/lib/leads 2>&1 | tail -5
```
Expected: no TS errors (watch for `react-hooks/exhaustive-deps` eslint warnings — fix the dep arrays rather than suppressing), lint clean, tests pass.

- [ ] **Step 5: Commit**

```bash
cd agent-portal
git add "src/app/(authed)/tasks/leads/_components/LeadsClient.tsx"
git commit -m "perf(leads): memoise list derivations and stabilise LeadTable handlers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `memo()` the lead row and cell; hoist `LeadTable`'s lookup maps

**Files:**
- Modify: `src/app/(authed)/tasks/leads/_components/LeadTable.tsx`

**Interfaces:**
- Consumes: the now-stable props from Task 5 (`alertsByLeadId`, `onPatchLead`, `onAssignLead`, `onToggleLead`, `onOpenLead`, `onSort` all stable identities).
- Produces: nothing new.

**Precedent:** `src/app/(authed)/sales-dashboard/health/HealthSalesPoliciesInformationTable.tsx:406` — `const PoliciesTableBody = memo(function PoliciesTableBody({...}) {...})`. Same shape here.

- [ ] **Step 1: Hoist the per-render maps in `LeadTable` to `useMemo`**

At the top of `LeadTable` (lines 127-152) these are rebuilt every render:
```ts
const statusById = new Map(statuses.map((status) => [status.id, status]));
const interactionTypeById = new Map(interactionTypes.map((type) => [type.id, type]));
const optionsByColumn = new Map<string, TableColumnOption[]>();
for (const option of columnOptions) { ... }
const statusChoices = [ { value: "", label: "No status" }, ...statuses.map(...) ];
const assigneeChoices = [ { value: "", label: "Unassigned" }, ...assignees.map(...) ];
```
Wrap each in `useMemo` keyed on its inputs (`[statuses]`, `[interactionTypes]`, `[columnOptions]`, `[statuses]`, `[assignees, nameByEmail]`). Also `pinnedOffsetByKey` and `minWidth` (lines 155-161): `useMemo(..., [columns, staticColumnWidth])`.

Add `import { useMemo } from "react";` (currently only `useRef` is imported).

- [ ] **Step 2: Extract `LeadRow` and wrap it in `memo`**

`LeadRow` (line 319) and `LeadDataCell` (line 401) are already module-level functions. Wrap both:
```ts
const LeadRow = memo(function LeadRow({ ... }: { ... }) { ... });
const LeadDataCell = memo(function LeadDataCell({ ... }: { ... }) { ... });
```
Add `memo` to the `react` import.

The `onPatch` / `onAssign` / `onToggle` / `onOpen` props passed into `<LeadRow>` from the `leads.map(...)` in `LeadTable` (lines 228-246) are **built inside the map callback** — new identities per render, which defeats `memo`. Fix by moving the per-row wiring into `LeadRow` itself: pass the row-agnostic callbacks (`onPatchLead(id, patch)`, `onAssignLead(id, email)`, `onToggleLead(id)`, `onOpenLead(lead)`) plus `lead`, and let `LeadRow` close over them with `useCallback`:

```ts
// in LeadTable's map:
<LeadRow
  lead={lead}
  columns={columns}
  status={status}
  statuses={statusById}
  interactionTypeById={interactionTypeById}
  optionsByColumn={optionsByColumn}
  nameByEmail={nameByEmail}
  statusChoices={statusChoices}
  assigneeChoices={assigneeChoices}
  isManager={isManager}
  canEdit={leadIsInScope(lead, editableOwnerEmails)}
  alerts={alertsByLeadId.get(lead.id) ?? EMPTY_ALERTS}
  selected={selected.has(lead.id)}
  pinnedOffsetByKey={pinnedOffsetByKey}
  onToggleLead={onToggleLead}
  onOpenLead={onOpenLead}
  onPatchLead={onPatchLead}
  onFollowUpNeeded={onFollowUpNeeded}
  onAssignLead={onAssignLead}
/>
```

Inside `LeadRow`, reconstruct the local handlers:
```ts
  const handleOpen = useCallback(() => onOpenLead(lead), [onOpenLead, lead]);
  const handleToggle = useCallback(() => onToggleLead(lead.id), [onToggleLead, lead.id]);
  const handleAssign = useCallback(
    (email: string | null) => onAssignLead(lead.id, email),
    [onAssignLead, lead.id],
  );
  const handlePatch = useCallback(
    (patch: Record<string, unknown>) => {
      // moved verbatim from LeadTable.tsx:230-245 — the scheduled-status /
      // follow-up-date interception.
      const nextStatusId = patch.status_id;
      if (
        typeof nextStatusId === "string" &&
        nextStatusId &&
        statuses.get(nextStatusId)?.kind === "scheduled" &&
        !lead.next_follow_up_at
      ) {
        onFollowUpNeeded(lead, nextStatusId);
        return Promise.resolve();
      }
      return onPatchLead(lead.id, patch);
    },
    [onPatchLead, onFollowUpNeeded, lead, statuses],
  );
```
`lead` is a stable identity between renders **only when the row did not change** — which is exactly the condition `memo` needs, and `LeadsClient` produces new `LeadRow` objects only for rows that actually changed (`patchLeadsById` / `updateLead` `.map` replace just the touched row). So `[…, lead]` deps are correct: an untouched row keeps its object identity → all its `useCallback`s stay stable → `memo` skips it.

Update the `LeadRow` prop type to match (replace `onToggle`/`onOpen`/`onPatch`/`onAssign` with `onToggleLead`/`onOpenLead`/`onPatchLead`/`onFollowUpNeeded`/`onAssignLead`), and thread `onFollowUpNeeded` from `LeadTableProps` (it is already a prop, line 97) down instead of it being consumed only in the map.

- [ ] **Step 3: Verify the row-identity assumption holds**

Read `LeadsClient.tsx` `patchLeadsById` (line 323-342), `updateLead` (line 536-554), and the realtime `reload` (`setLeads(refreshedLeads)` at line 269). Confirm:
- `patchLeadsById` / `updateLead` / `applyReturnedLeads` produce a **new array** with **new objects only for changed ids** (they use `current.map(lead => lead.id === id ? {...} : lead)`) — ✅ untouched rows keep identity.
- `reload()` (full refresh, line 269 `setLeads(refreshedLeads)`) replaces **every** row object → every `LeadRow` re-renders. This is acceptable: full reload is the 5-minute fallback or an explicit user action, not a hot path.

Write this finding as a comment above the `memo(LeadRow)` so the next reader knows why the deps are `[…, lead]` and not destructured primitives.

- [ ] **Step 4: Verify build + lint + tests + manual**

```bash
cd agent-portal
npx tsc --noEmit 2>&1 | tail -5
npx eslint "src/app/(authed)/tasks/leads/_components/LeadTable.tsx" 2>&1 | tail -5
npx vitest run 2>&1 | tail -5
```
Expected: clean, all ~1130 tests pass.

Manual (via the `run` skill or `npm run dev`):
```
Open /tasks/leads. In React DevTools Profiler, record while typing one character
in Search. Before this task: every LeadRow re-renders. After: only LeadRow
instances whose data changed (none, for a search keystroke) re-render — the
profiler shows the table body as "did not render".
```

- [ ] **Step 5: Changelog + commit**

```markdown
## 2026-09-04 — Leads: bảng danh sách bỏ render thừa

- **Loại**: perf (client).
- `LeadRow` / `LeadDataCell` bọc `memo`; các map tra cứu trong `LeadTable`
  (`statusById`, `optionsByColumn`, `assigneeChoices`, `pinnedOffsetByKey`…) và
  các phép suy diễn trong `LeadsClient` (`alertsByLeadId`, `healthByLeadId`,
  `displayedLeads`, các mảng option) chuyển sang `useMemo`; handler truyền xuống
  bảng chuyển sang `useCallback`. Trước đây mỗi phím gõ vào Search render lại
  toàn bộ N dòng × ~15 ô; giờ chỉ dòng có dữ liệu đổi mới render.
- Chưa thêm windowing: ở ~120 lead số node DOM chưa phải nút thắt. Xem lại khi
  vượt ~500 lead hoạt động.
```

```bash
cd agent-portal
git add "src/app/(authed)/tasks/leads/_components/LeadTable.tsx" changelog.md
git commit -m "perf(leads): memo the lead row/cell and hoist LeadTable lookups

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Stop `POST /api/leads/assign` returning 500 after a committed assignment

**Files:**
- Modify: `src/app/api/leads/assign/route.ts:69-88`

**Interfaces:**
- Consumes: nothing new.
- Produces: same response shape; on a post-commit read failure it now returns `200` with `{ assigned, leads: [] }` instead of `500`.

**Current code (lines 69-88):**
```ts
  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId, assignedIds); });
  const { data: updated, error: afterError } = await supabase
    .from("leads")
    .select(LEAD_AFTER_SELECT)
    .in("id", assignedIds);
  if (afterError) return NextResponse.json({ error: afterError.message }, { status: 500 });
  return NextResponse.json({
    assigned: assignedIds.length,
    leads: (updated ?? []).map((row) => { ... }),
  });
```
The RPC already committed and `after()` already scheduled the broadcast. Returning 500 makes the client show an error and retry; the retry's RPC finds nothing to reassign and the route returns 404 "No active leads were found" (line 65-67) — a worse, more confusing message for a state that is actually fine.

- [ ] **Step 1: Write the failing test**

There is no route test file for assign. Add one focused on the reconciliation branch — but the route needs `auth()` and a Supabase client, which the repo's other route tests mock. Check how `src/app/api/**/route.test.ts` (e.g. tasks) mock `@/auth` and `@/lib/supabase`. If route tests are not the norm in this repo (grep: `find src/app/api -name '*.test.ts'`), **skip the test** and rely on Step 3's reasoning + manual check — note the skip in the commit message. Do not invent a mocking harness that does not exist elsewhere.

If route tests do exist, model this one on the nearest sibling:
```ts
it("returns 200 with the assigned count when the post-commit re-read fails", async () => {
  // arrange: RPC returns [{ lead_id: "l1" }], then .select().in() returns { error }
  // act: POST
  // assert: res.status === 200; body.assigned === 1; body.leads === []
});
```

- [ ] **Step 2: Change the branch**

```ts
  const sourceId = readLeadMutationSourceId(request);
  after(async () => { await broadcastLeadsChanged(sourceId, assignedIds); });

  // Trả về chính những dòng vừa đổi để màn hình vá tại chỗ. RPC đã commit và
  // broadcast đã lên lịch — nếu lượt đọc lại này hỏng, việc gán KHÔNG hỏng, nên
  // đừng trả 500. Client không có `leads` thì rơi về `reload()` (đường đã có,
  // xem LeadsClient.assignLead / assignSelected).
  const { data: updated, error: afterError } = await supabase
    .from("leads")
    .select(LEAD_AFTER_SELECT)
    .in("id", assignedIds);
  if (afterError) {
    return NextResponse.json({ assigned: assignedIds.length, leads: [] });
  }
  return NextResponse.json({
    assigned: assignedIds.length,
    leads: (updated ?? []).map((row) => {
      const lead = row as unknown as LeadRow & { lead_events?: { name?: string | null } | null };
      const { lead_events, ...rest } = lead;
      return { ...rest, event_name: lead_events?.name?.trim() || null };
    }),
  });
```

Confirm the client handles `leads: []` — `LeadsClient.assignLead` (line 645-653): `if (returned.length > 0) applyReturnedLeads(returned); else { setSelectedLead(...); await reloadRef.current(); }` — ✅ it already falls back to a full reload. `assignSelected` (line 686-688): `if (returned.length > 0) applyReturnedLeads(returned); else await reload();` — ✅.

- [ ] **Step 3: Verify**

```bash
cd agent-portal
npx tsc --noEmit 2>&1 | tail -5
npx vitest run src/app/api/leads src/lib/leads 2>&1 | tail -5
```

- [ ] **Step 4: Changelog + commit**

```markdown
## 2026-09-04 — Leads: gán lead không còn trả 500 sau khi đã commit

- **Loại**: fix (mã lỗi HTTP).
- `POST /api/leads/assign` đọc lại các dòng vừa gán để client vá tại chỗ. Nếu
  lượt đọc lại đó lỗi, RPC `assign_leads_manual` vốn ĐÃ commit và broadcast đã
  lên lịch — nhưng route trả 500, client báo lỗi rồi thử lại, lần thử lại không
  còn gì để gán nên trả 404 "No active leads were found". Nay trả 200 với
  `leads: []`; client rơi về `reload()` như đường đã có sẵn.
```

```bash
cd agent-portal
git add src/app/api/leads/assign/route.ts changelog.md
git commit -m "fix(leads): assign route returns 200 (not 500) when the post-commit re-read fails

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Normalise event-name matching so internal whitespace does not split an event

**Files:**
- Create: `supabase/rollouts/2026-09-04-lead-event-name-normalize.sql`
- Modify: `supabase/schema.sql` (the `lead_events_name_unique_idx` definition)
- Modify: `src/lib/leads/events.ts`
- Create: `src/lib/leads/events.test.ts`

**Interfaces:**
- Produces: `normalizeEventName(raw: string): string` from `src/lib/leads/events.ts` — collapses internal whitespace runs to one space and trims. `resolveEventByName` uses it for both the lookup term and the inserted value; the DB unique index and the search predicate both key on the same normalised form.

**Current mismatch (`src/lib/leads/events.ts:23-61`):** search is `.ilike("name", escapeLikePattern(name))` — a full-string case-insensitive compare that does **not** collapse internal spaces. The unique index (`2026-08-31-lead-final.sql:274`, mirrored in `schema.sql`) is `create unique index lead_events_name_unique_idx on lead_events (lower(btrim(name))) where archived_at is null` — `btrim` trims ends only. So `"Health Fair"` and `"Health  Fair"` are two index keys and two events; the per-event report (`summarizeLeads` → `byEvent`) then reports that one event as two rows.

- [ ] **Step 1: Write the failing test**

Create `src/lib/leads/events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeEventName, escapeLikePattern } from "./events";

describe("normalizeEventName", () => {
  it("collapses internal whitespace and trims", () => {
    expect(normalizeEventName("  Health   Fair \t2026 ")).toBe("Health Fair 2026");
    expect(normalizeEventName("Health Fair")).toBe("Health Fair");
  });
  it("leaves an already-clean name untouched", () => {
    expect(normalizeEventName("Auto Expo")).toBe("Auto Expo");
  });
});

describe("escapeLikePattern", () => {
  it("escapes LIKE metacharacters", () => {
    expect(escapeLikePattern("50% Off_Fair")).toBe("50\\% Off\\_Fair");
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `cd agent-portal && npx vitest run src/lib/leads/events.test.ts`
Expected: FAIL — `normalizeEventName` is not exported.

- [ ] **Step 3: Add `normalizeEventName` and use it in `resolveEventByName`**

In `src/lib/leads/events.ts`:
```ts
/**
 * Chuẩn hoá tên sự kiện: gộp mọi chuỗi khoảng trắng thành một dấu cách và cắt
 * hai đầu. Index duy nhất là `lower(btrim(name))` — `btrim` chỉ cắt đầu/cuối,
 * nên "Health Fair" và "Health  Fair" hiện là hai sự kiện, và báo cáo theo sự
 * kiện tách đôi đúng con số đó. Chuẩn hoá cả lúc TÌM và lúc GHI để hai người gõ
 * cùng một cái tên với khoảng cách khác nhau vẫn về một dòng.
 */
export function normalizeEventName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}
```

In `resolveEventByName`, change line 28 from `const name = rawName.trim();` to:
```ts
  const name = normalizeEventName(rawName);
```
The rest (the `escapeLikePattern(name)` → `.ilike("name", pattern)` search, the insert of `name`, the retry) then all operate on the normalised form. The `.ilike` still won't match legacy rows that have internal doubled spaces, which is why Step 4 backfills them.

- [ ] **Step 4: Write the rollout — backfill + a normalising trigger**

Create `supabase/rollouts/2026-09-04-lead-event-name-normalize.sql`:

```sql
-- =====================================================================
-- Tên sự kiện: gộp khoảng trắng trong tên về một dấu cách.
--
-- `lead_events_name_unique_idx` key theo `lower(btrim(name))` — `btrim` chỉ cắt
-- hai đầu. "Health Fair" và "Health  Fair" lọt qua thành hai dòng, và báo cáo
-- theo sự kiện tách đôi con số của cùng một sự kiện.
--
-- 1. Trigger chuẩn hoá khi ghi (nguồn sự thật ở DB, không chỉ ở route).
-- 2. Backfill các dòng đang có khoảng trắng thừa. Nếu việc gộp làm hai dòng
--    trùng nhau, gộp lead của dòng mới hơn về dòng cũ hơn rồi archive dòng mới.
--
-- Idempotent.
-- =====================================================================

create or replace function lead_event_normalize_name()
returns trigger
language plpgsql as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  return new;
end $$;

drop trigger if exists lead_event_normalize_name_trg on lead_events;
create trigger lead_event_normalize_name_trg
  before insert or update of name on lead_events
  for each row execute function lead_event_normalize_name();

do $$
declare
  dup record;
  keep_id uuid;
begin
  -- Gộp trùng do khoảng trắng: giữ dòng tạo trước, chuyển lead + archive dòng sau.
  for dup in
    select lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) as norm,
           array_agg(id order by created_at) as ids
    from lead_events
    where archived_at is null
    group by 1
    having count(*) > 1
  loop
    keep_id := dup.ids[1];
    update leads set event_id = keep_id
      where event_id = any (dup.ids[2:array_length(dup.ids, 1)]);
    update lead_events set archived_at = now()
      where id = any (dup.ids[2:array_length(dup.ids, 1)]);
  end loop;

  -- Chuẩn hoá phần còn lại (trigger lo các lần ghi sau).
  update lead_events
  set name = btrim(regexp_replace(name, '\s+', ' ', 'g'))
  where name <> btrim(regexp_replace(name, '\s+', ' ', 'g'));
end $$;

-- Kiểm chứng: không còn tên có khoảng trắng thừa, không còn norm-trùng active.
select
  (select count(*) from lead_events
     where name <> btrim(regexp_replace(name, '\s+', ' ', 'g'))) as unnormalized_rows,
  (select count(*) from (
     select 1 from lead_events where archived_at is null
     group by lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
     having count(*) > 1
   ) d) as active_norm_duplicates;
```

Expected verification result: both columns `0`.

- [ ] **Step 5: Mirror the trigger into schema.sql**

In `supabase/schema.sql`, right after the `create unique index … lead_events_name_unique_idx …` line (~6232), add the `lead_event_normalize_name()` function + `drop trigger … / create trigger lead_event_normalize_name_trg …` verbatim from the rollout. (The one-off backfill `do $$ … end $$` block does **not** go in schema.sql — schema.sql describes structure, not data migrations.)

- [ ] **Step 6: Run tests + build**

```bash
cd agent-portal
npx vitest run src/lib/leads/events.test.ts 2>&1 | tail -5   # PASS
npx tsc --noEmit 2>&1 | tail -5
npx vitest run src/lib/leads 2>&1 | tail -5
```

- [ ] **Step 7: Changelog + commit**

```markdown
## 2026-09-04 — Leads: chuẩn hoá tên sự kiện, hết tách đôi vì khoảng trắng

- **Loại**: fix (toàn vẹn dữ liệu) — cần chạy rollout
  `2026-09-04-lead-event-name-normalize.sql`.
- `resolveEventByName` tìm bằng `ilike` (so khớp cả chuỗi) trong khi index duy
  nhất key theo `lower(btrim(name))`. "Health Fair" và "Health  Fair" thành hai
  sự kiện; báo cáo theo sự kiện tách đôi con số. Nay có `normalizeEventName` gộp
  khoảng trắng ở route, một trigger làm việc đó ở DB, và rollout gộp các sự kiện
  đã bị tách (chuyển lead về dòng cũ hơn, archive dòng mới).
```

```bash
cd agent-portal
git add supabase/rollouts/2026-09-04-lead-event-name-normalize.sql supabase/schema.sql \
  src/lib/leads/events.ts src/lib/leads/events.test.ts changelog.md
git commit -m "fix(leads): normalise event-name whitespace so one event stays one row

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Post-plan: run the SQL rollouts on production

Tasks 2 and 8 create rollout files. They are **not** applied by merging — run them by hand in the Supabase SQL editor, in this order, reading each file's trailing `select … ` verification result:

1. `supabase/rollouts/2026-09-04-lead-list-indexes.sql` — expect two index names back.
2. `supabase/rollouts/2026-09-04-lead-event-name-normalize.sql` — expect `unnormalized_rows = 0`, `active_norm_duplicates = 0`.

Task 1 changes **only `schema.sql`** — nothing to run; production already has those objects.

If PostgREST later reports a column/table as missing right after a run, issue `notify pgrst, 'reload schema';` once and retry (its schema cache lags — the note in `scripts/check-schema-drift.mjs` explains this).

---

## Self-Review

**Spec coverage** — the audit's five findings (A–E in the severity table) each map to a task: A→1, B→3+4+5+6, C→2, D→8, E→7. The two explicitly-deferred items (virtualization, server-side filtering) are recorded in "Not in this plan" with the reason and the trigger condition for revisiting.

**Placeholder scan** — every code step carries the actual code or the actual DDL. The two places that say "verify the exact line in the rollout" (Task 1 Step 2, `auto_assign_enabled` default; Task 8 index body) are pointing at a specific file+object to copy verbatim, not deferring a decision — the rollout files are the source of truth and must be read, not guessed.

**Type consistency** — `LeadLookups` / `LeadBadges` shapes defined in Task 3 are consumed with the same field names in Tasks 5 and 6 (`statusById`, `statusNameById`, `alertsByLeadId`, `healthByLeadId`, `healthCounts`). `useDebouncedValue(value, delayMs)` (Task 4) is called with `(filters.search, 200)` in Task 5. `normalizeEventName` (Task 8) — single call site changed in the same task.

**Known soft spots for the implementer:**
- Task 3's `list-derivations.ts` calls five helpers (`classifyLeadHealth`, `emptyLeadHealthCounts`, `settingsForLead`, `buildStatusById`, `resolveLeadAlerts`) whose signatures were read but may have optional params not shown — the step says to check and adjust.
- Task 6's `memo` correctness rests entirely on `LeadsClient` producing new `LeadRow` objects only for changed rows. Task 6 Step 3 is a dedicated verification step for exactly that; if `reload()` or a future change starts replacing the whole array on a hot path, the memo stops helping (it does not break correctness).
- Task 7's test may be skipped if the repo has no route-test harness — that is called out in the step, not hidden.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-04-event-leads-audit-fixes.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
