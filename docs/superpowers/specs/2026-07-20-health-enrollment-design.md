# Health Enrollment — Design Spec

**Status:** Approved (design), pending spec review
**Date:** 2026-07-20
**Author:** Bao Vo + Claude
**Related:** Sibling module to Health Customer Service (`tasks`). Data grounded in the real Slack List "Khang Nguyen — ACA 2026" (200-record crawl at `tfw_list_crawler/tfw_list_raw.csv`).

---

## 1. Goal

A new **Health Enrollment** module (`/enrollment`) that mirrors the Health Customer Service collaboration experience (comments, mentions, attachments, activity, notifications, realtime, QC, search) but replaces the kanban board with a **Slack-Lists-style table**, because the pipeline has ~14 stages that would overflow a horizontal board. All dropdown fields are **admin-configurable option sets** (like Categories in CS). CS / Agent / Admin share the same access in v1; role permissions come later.

### 1.1 Two programs, one module

The module hosts **two structurally identical enrollment programs** as separate tabs:

- **Health ACA Enroll** — the ACA pipeline described throughout this spec (seeded from the real Slack data).
- **Medicare Enroll** — an identical structure (same tables, same columns, same collaboration + QC + due behavior), but its **own** option sets (Medicare has different stages, carriers, plans).

They share one schema, one set of components, and one set of API routes, discriminated by a `program` value (`aca` | `medicare`). Everything below applies to **both** programs unless a section says otherwise; the only per-program difference is the **content of the option sets** and which records/config each tab shows.

## 2. Non-goals (v1)

- Role-based permission differences (everyone with board access sees & edits the same).
- Priority-based SLA (enrollment has no priority; deadline is a single Due Date).
- Grouped-by-stage / kanban view (flat table only; grouping is a later enhancement).
- Migrating/importing the existing Slack data (separate one-off task; not part of this build).
- Merging enrollment collaboration tables with CS (explicitly deferred — see Architecture).

## 3. Architecture decision — Approach A (separate tables)

Enrollment gets its **own tables** for records **and** collaboration (comments, activity, attachments, notifications, option sets). We do **not** touch the live CS (`tasks`) tables.

- **Why:** CS is going live next week. A polymorphic `entity_type`/`entity_id` refactor of the shared comments/activity/notifications tables would modify live CS code and schema — unacceptable risk during go-live week. Data integrity and not breaking CS outrank DRY here.
- **Reuse happens at the library + component layer**, not the table layer: pure helpers (`people.ts` label formatting, mention parsing, date/time formatting) and UI components (comment thread, activity feed, attachment panel, mention picker, detail-drawer shell) are parameterized to accept an entity context, so the enrollment module wires them to its own API routes and tables.
- **Tech debt (recorded):** duplicated collaboration schema across two modules. Post-go-live, once CS is stable, evaluate consolidating to a polymorphic `collab_*` layer. Tracked in `docs/go-live-review.md` tech-debt section.

## 4. Data model

### 4.1 `enrollment_records`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `program` | text | `aca` \| `medicare` — which tab owns the record; every list/filter/notify query is scoped by it |
| `client_name` | text | nullable (some rows blank in source) |
| `fub_link` | text | Follow-Up-Boss URL |
| `due_date` | date | drives due-soon / overdue |
| `stage_id` | uuid fk → `enrollment_options` | the pipeline stage |
| `carrier_id` | uuid fk → `enrollment_options` | nullable |
| `platform_id` | uuid fk → `enrollment_options` | nullable |
| `consent_id` | uuid fk → `enrollment_options` | nullable |
| `payment_status_id` | uuid fk → `enrollment_options` | nullable |
| `aca_status_id` | uuid fk → `enrollment_options` | ACA account status ("AC" column) |
| `pcp_2025` | text | free text |
| `pcp_2026` | text | free text |
| `caller_email` | text | people ref (CS who called/created) |
| `responsible_enroll_email` | text | people ref (person who enrolls) |
| `qc_checked_by_email` | text | set when reviewed |
| `qc_checked_at` | timestamptz | |
| `due_soon_notified_at` | timestamptz | reminder throttle |
| `overdue_notified_at` | timestamptz | reminder throttle |
| `overdue_reminded_at` | timestamptz | repeat throttle |
| `closed_at` | timestamptz | set when entering a terminal stage |
| `created_by_email` / `created_at` | text / timestamptz | audit |
| `updated_by_email` / `updated_at` | text / timestamptz | audit; `updated_at` used for optimistic-lock (`expected_updated_at`) |
| `archived_at` | timestamptz | soft delete |

All option FKs are `on delete restrict` (an option in use cannot be hard-deleted — archive instead). `caller_email`/`responsible_enroll_email` have **no** FK to accounts (people may be out-of-pool), matching the CS `task_assignees` decision.

### 4.2 Option-set config (generalized "Categories")

`enrollment_option_sets`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `program` | text | `aca` \| `medicare` — option sets are per-program, so each tab configures its own |
| `key` | text | `stage` \| `carrier` \| `platform` \| `consent` \| `payment_status` \| `aca_status`; unique **per program** (`unique(program, key)`) |
| `label` | text | display name ("Stage", "Carrier"…) |
| `is_stage` | boolean | the `stage` set is special: ordered pipeline + terminal flags |

> Because option sets are program-scoped, ACA and Medicare each get their own Stage/Carrier/etc. lists — an admin editing Medicare stages never touches ACA. The `aca_status` set is ACA-specific; Medicare may leave it empty or the admin can repurpose it (its column stays nullable).

`enrollment_options`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `set_id` | uuid fk → `enrollment_option_sets` | |
| `label` | text | e.g. "5-Ready to enroll", "Oscar HMO" |
| `color` | text | hex/palette token, like CS category color |
| `position` | int | sort order within the set |
| `is_terminal` | boolean | stage-set only: `10-DONE`, `11-Terminated` = terminal |
| `triggers_qc` | boolean | stage-set only: `10-DONE` = true |
| `archived_at` | timestamptz | hide from pickers, keep referential integrity |

**Seed data — ACA program** (from the real Slack list):

- **Stage** (ordered): `1-Need quote`, `2-Quoted`, `3-Waiting for Confirmation`, `4-Need documents`, `5-Ready to enroll`, `6-Enrolled`, `7-1st payment done`, `8-Need assign PCP`, `9-Assigned PCP/Get ID Card`, `10-DONE` *(terminal, triggers QC)*, `11-Terminated` *(terminal)*, plus off-pipeline: `Need call to renewal`, `Can't Contact`, `Can not get ID card`. Colors approximated from the Slack pills.
- **Carrier**: Oscar HMO, Oscar EPO, CHC 019, CHC Select, CHC Premier, Ambetter EPO, Ambetter HMO, UHC, UHC Sanitas, BCBS Advantage, BCBS Myblue, BCBS, Kaiser, Christus, Molina, Community First, Wellpoint, Sentara, BSW, Providence, + "Other".
- **Platform**: MyMFG, HSP, Other.
- **Consent**: Yes, Not Yet.
- **Payment status**: Auto pay, $0, Selfpay, Need make manually, Need auto pay.
- **ACA status**: Need to create ACA account, Created - Waiting for verify, Created - Need information to verify, ACA account done.

**Seed data — Medicare program:** we don't yet have real Medicare stage/carrier lists. To make the tab usable on day one, seed Medicare's option sets by **cloning the ACA sets as an editable starting template** (same keys, same UI), then let an admin rename/reorder/replace them to the real Medicare pipeline. No records are cloned — only the config scaffolding. *(Open item: if the real Medicare stages are known before build, seed those directly instead — see §11.)*

### 4.3 History / audit

`enrollment_stage_history` — one row per stage change:

| Column | Type |
|---|---|
| `id` | uuid pk |
| `record_id` | uuid fk → `enrollment_records` |
| `from_option_id` / `to_option_id` | uuid nullable |
| `changed_by_email` | text |
| `changed_at` | timestamptz |

This powers time-in-stage, stage aging, throughput, and bottleneck analytics (the tracking gap flagged in the go-live review). People changes (caller / responsible-enroll reassignment) are captured in the generic `enrollment_activity` feed.

### 4.4 Collaboration tables (own copies)

- `enrollment_comments` (+ reply threading, edit snapshot in `enrollment_comment_edits`) — mirror CS.
- `enrollment_activity` — status/field/people changes.
- `enrollment_attachments`.
- `enrollment_notifications` (+ `type` CHECK constraint; reuse CS notification types where meaningful: `mentioned`, `commented`, `assigned`, `due_soon`, `overdue`, `overdue_reminder`, `qc_needed`, `qc_stale`, `reopened`; add `stage_changed` if we notify on stage moves — TBD in plan).

## 5. Primary view — Slack-Lists-style table

- **Two top-level tabs: `Health ACA Enroll` and `Medicare Enroll`.** Each tab is the same table, scoped to its `program`; switching tabs swaps records, the option-set config, and the filters' option lists. The active tab is reflected in the URL (e.g. `/enrollment/aca`, `/enrollment/medicare`) so links and refreshes land on the right program.
- Horizontal-scrolling table; every configurable field is a **colored pill** editable **inline** (click → dropdown of that program's active options).
- Columns (default order): Client Name, Stage, Caller, Responsible Enroll, Payment status, Carrier, ACA status, Consent, Platform, PCP 2025, PCP 2026, Due Date, FUB Link, Comments count.
- Column header sort; default sort by `updated_at` desc (with due-soon surfaced).
- Filters row (reusing the CS filter pattern): Stage, Caller, Responsible Enroll, Carrier, Payment, ACA, Consent, Platform, Overdue toggle, date range, + free-text search across client name and comments. Match count shown. "Clear all".
- Row click → **detail drawer** mirroring `TaskDetailDrawer`: left = comments / activity / attachments tabs; right rail = enrollment fields (all inline-editable) + Due Date + QC panel.
- "New enrollment" dialog: Client Name, FUB Link, Stage, Carrier, Platform, Consent, Payment, ACA, PCP fields, Caller, Responsible Enroll, Due Date.

## 6. Deadline / overdue (no priority SLA)

- Each record has an optional `due_date`.
- A cron (or extension of the existing overdue cron) emits `due_soon` before the due date and `overdue` after, throttled via the `*_notified_at` / `overdue_reminded_at` columns.
- Recipients: `caller_email` and `responsible_enroll_email`.
- Overdue does **not** lock the record (no unlock-reason flow in v1 — there's no in-progress SLA concept; overdue is purely a Due-Date signal). Revisit if needed.

## 7. QC

- When a record's stage moves to a `triggers_qc` stage (`10-DONE`), it needs QC.
- QC panel in the detail drawer: `Mark QC checked` (sets `qc_checked_by/at`) or `Reopen` (moves stage back, requires a reason recorded in activity).
- `qc_needed` notification to the responsible-enroll owner + admin/agent (mirror CS recipient logic); `qc_stale` reminder via cron if a DONE record sits un-QC'd past a configurable threshold.
- Terminal `11-Terminated` closes the record without QC.

## 8. Access (v1)

- Anyone who can access the enrollment board sees and edits all records (CS = Agent = Admin).
- Configuration screens (option-set editor) are Admin-only at the API layer even though the board itself is shared — mirrors CS where category/SLA GET is open but mutations are admin-gated. (Cheap to enforce now, avoids a later data-integrity retrofit.)
- Role scoping is a v2 concern; the actor/capability layer is structured so it can be added without reshaping data.

## 9. Analytics enabled by this design

From `enrollment_records` + `enrollment_stage_history` + `enrollment_activity`:

- Records per Caller / per Responsible Enroll / per week / per month.
- Average time in each stage; stage aging; current WIP per stage.
- Throughput (records reaching `10-DONE` per period); Terminated rate.
- Bottleneck detection (which stage accumulates the most aged records).
- Overdue rate against Due Date; QC turnaround (`qc_checked_at − entered-DONE`).
- Carrier / Platform / Payment distribution.

## 10. File structure (planned)

```
supabase/schema.sql                      # + enrollment_* tables, seed option sets
src/app/(authed)/enrollment/page.tsx
src/app/(authed)/enrollment/_components/  # EnrollmentTable, EnrollmentRow, InlinePill,
                                          #   EnrollmentDetailDrawer, NewEnrollmentDialog,
                                          #   OptionSetManager, EnrollmentToolbar/Filters
src/app/api/enrollment/route.ts           # list + create
src/app/api/enrollment/[id]/route.ts      # patch (optimistic lock) + soft delete
src/app/api/enrollment/[id]/comments/...  # mirror CS
src/app/api/enrollment/[id]/activity/route.ts
src/app/api/enrollment/[id]/attachments/...
src/app/api/enrollment/option-sets/route.ts  # list + admin mutate
src/app/api/enrollment/notifications/...
src/app/api/cron/check-enrollment-due/route.ts
src/lib/enrollment/                       # types, queries, options, filtering, history,
                                          #   notifications, access — mirroring src/lib/tasks
```

Shared/parameterized from CS: `src/lib/tasks/people.ts` (or a promoted shared `people.ts`), mention parsing, formatting; UI shells (CommentThread, ActivityFeed, AttachmentPanel, mention picker) refactored to accept an entity context or duplicated thinly if refactor risk is high (decided per-component in the plan).

## 11. Open questions for plan phase

- Notify on every stage change, or only on key transitions (ready-to-enroll, DONE, Terminated)? (Default: only key + mentions/comments, to avoid spam.)
- Reuse the single overdue cron vs a dedicated enrollment cron? (Default: dedicated route, invoked by the same scheduler.)
- Promote `people.ts` to a shared location vs duplicate? (Default: promote, it's pure.)
