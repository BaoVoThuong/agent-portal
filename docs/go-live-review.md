# Go-Live Review - Task Management Portal

**Review date:** 2026-07-19  
**Reviewer stance:** Senior Engineering Manager, Product Manager, Technical Architect, QA Lead, Operations Manager, Data Analyst.  
**Review posture:** Assume the system will fail unless the workflow, data integrity, auditability, scale path, and operational ownership prove otherwise.

## Executive Verdict

The task module is usable for day-to-day task execution, and the foundation is stronger than an ordinary CRUD board: it has stage-cycle tracking, assignment-cycle tracking, overdue events, comments, attachments, soft-delete for tasks/comments, configurable SLA/reminders, and role-scoped access. That is good.

But as a Go-Live system intended to measure workload and staff performance, it is not complete yet. The biggest remaining risk is not UI polish. The biggest risk is business decisions being made from incomplete or biased data: no acceptance tracking, no first response tracking, no working-hours calendar, no team/department snapshot, no admin audit log, no historical reporting surface, and several special write paths still lack version guards.

Several earlier hard blockers were already fixed in the current worktree:

- Notification `detail` is now persisted.
- Account email edit / hard-delete is blocked when the email is referenced by task or registration data.
- Generic task PATCH now has optimistic locking.
- `task_activity.type` now has a database CHECK constraint.

Do not treat those as deployed until the migration/code are shipped and verified in production.

---

# 1. Business Flow Review

## Current Flow

```text
Create task
  -> Backlog if unassigned
  -> Todo if assigned
  -> In Progress
  -> Waiting
  -> Done / Cancel
  -> QC reviewed
  -> Reopen with reason if needed
  -> Archive via delete action
```

## Flow Assessment

The operational happy path works. A manager/admin can create, assign, move, review, reopen, and archive. Agent/assistant can work inside agent scope. CS can work assigned tasks. The workflow is understandable for a small team.

The measurement flow is incomplete. There is no explicit acceptance/acknowledgement step. "Todo" currently means both "assigned but not yet accepted" and "accepted but not started". That makes acceptance delay and first response impossible to measure. "Waiting" is overloaded: it can mean external wait, blocked, dependency wait, customer delay, or missing info. Cancel has no reason. Priority/category changes are audited as activity, but not materialized into robust counters.

## Dead-End / Stuck Risks

- A task can be moved to `waiting` before it has ever started. This is allowed by invariant logic. It may be valid for some businesses, but it corrupts cycle-time assumptions.
- Reopen and overdue-unlock write paths are not version-guarded. Two users can perform conflicting special actions near-simultaneously.
- If a task's agent group changes after assignment, a task may remain visible/workable in surprising ways depending on assignee, participant, and agent-owner scope.
- Notifications are in-app only. Offline users may miss overdue/QC events.
- If GitHub Actions cron secrets are missing or the workflow fails, overdue/due-soon/stale/QC-stale detection stops unless someone notices workflow failure.

## Duplicate Action Risks

- Reminder cron has per-task marker fields, which reduces duplicate reminders.
- Comment/mention notifications can still burst; no throttle or dedupe key exists.
- Reopen/overdue-unlock lack idempotency keys and version guards.
- Assignment via overview uses an RPC with `expected_updated_at`, which is good.

## Impossible / Ambiguous States

- `todo` with old `todo_started_at` means "stuck todo", but not "accepted".
- `waiting` can be "blocked", "waiting customer", "waiting carrier", or "dependency".
- `done_reviewed_at` works as QC verified, but there is no separate `verified` status.
- `tasks.assignee_email` and `task_assignees` can drift if any future writer forgets to mirror both.

## Recommended Business Flow

For Go Live next week, keep the current statuses to avoid blast radius, but add tracking actions/fields as soon as possible:

```text
Created
  -> Backlog
  -> Assigned/Todo
  -> Accepted
  -> In Progress
  -> Waiting External / Blocked
  -> Done
  -> QC Verified
  -> Archived

Exceptional paths:
  Todo -> Rejected with reason -> Backlog/Reassigned
  In Progress -> Blocked with reason/dependency
  In Progress -> Cancelled with reason
  Done/Cancel -> Reopened with reason -> Todo
```

Do not add many visible statuses immediately unless the team is trained. Add hidden timestamps/reason fields first. Then decide whether `accepted`, `blocked`, and `verified` deserve first-class statuses.

---

# 2. Task Lifecycle

## Current Lifecycle

```text
backlog -> todo -> in_progress -> waiting -> done/cancel
done/cancel -> reopen -> todo
in_progress overdue -> overdue-unlock with reason -> todo
done/cancel -> QC reviewed
```

## Status Review

| Status | Keep? | Review |
|---|---:|---|
| `backlog` | Yes | Needed for unassigned queue. |
| `todo` | Yes | Needed, but currently mixes assigned/unaccepted/accepted. |
| `in_progress` | Yes | Core work state. |
| `waiting` | Yes, but split later | Too broad for analytics. Add waiting reason/type. |
| `done` | Yes | Work completion. |
| `cancel` | Yes | Needed, but must require reason. |
| `accepted` | Add as action first | Needed for acceptance delay. Could be timestamp not status. |
| `blocked` | Add as type first | Needed to separate true blocker from external waiting. |
| `verified` | Add as derived state first | `done_reviewed_at` already supports this. |
| `rejected` | Optional | Needed only if assignees can reject bad assignment. |
| `expired` | No for now | Not natural for CS work unless tasks have contractual expiry. |
| `auto_closed` | No for now | Dangerous without human review. |

## Recommended Lifecycle

```text
backlog
  -> todo              (assigned_at captured)
  -> accepted          (accepted_at captured, same visible Todo column optional)
  -> in_progress       (started_at / first_response_at captured)
  -> waiting           (waiting_type + waiting_reason)
  -> in_progress
  -> done              (completed_at/closed_at)
  -> verified          (done_reviewed_at)
  -> archived

cancel(reason) can happen from backlog/todo/in_progress/waiting.
reopen(reason) can happen from done/cancel/verified.
reject(reason) should return to backlog or assigner queue if business wants it.
```

## Lifecycle Issue 1 - Missing Accept/Acknowledge

- **Severity:** High
- **Module:** Task lifecycle / `tasks`, `transitions.ts`
- **Current Logic:** Assignment moves the task into `todo`; there is no `accepted_at`.
- **Problem:** The system cannot distinguish "not seen yet" from "accepted but not started".
- **Impact:** Acceptance SLA and staff responsiveness cannot be measured.
- **Example Scenario:** A CS has 10 Todo tasks. CEO asks who accepts tasks fastest. The database has no answer.
- **Root Cause:** Lifecycle optimized for board movement, not accountability.
- **Recommendation:** Add `accepted_at`, `accepted_by_email`, `acceptance_due_at`, and an Accept action. Keep visible status as Todo initially.
- **Alternative:** Treat first comment or first move to In Progress as acceptance, but that is a weak proxy.
- **Estimated Effort:** Medium.
- **Risk:** Medium.
- **Priority:** P1.

## Lifecycle Issue 2 - Waiting Is Too Ambiguous

- **Severity:** High
- **Module:** Task lifecycle / analytics
- **Current Logic:** `waiting` is one generic status.
- **Problem:** Waiting could be customer delay, carrier delay, missing info, dependency, or internal blocker.
- **Impact:** Bottleneck analysis will blame the wrong team/person.
- **Example Scenario:** Team A has high waiting time. Without reason, CEO cannot know whether CS is slow or customers/carriers are blocking work.
- **Root Cause:** No `waiting_type`, `waiting_reason`, or dependency model.
- **Recommendation:** Add `waiting_type`, `waiting_reason`, `blocked_by_task_id`, and `waiting_owner`.
- **Alternative:** Require a structured comment when moving to Waiting.
- **Estimated Effort:** Medium.
- **Risk:** Medium.
- **Priority:** P1.

## Lifecycle Issue 3 - Cancel Has No Reason

- **Severity:** High
- **Module:** Task lifecycle / task closure
- **Current Logic:** Task can reach `cancel`; `closed_at` is captured, but no cancel reason.
- **Problem:** Cancellation analytics are unusable.
- **Impact:** You cannot distinguish duplicate tasks, invalid work, customer cancellation, agent error, or staff inability.
- **Example Scenario:** 30% of tasks are cancelled. Business cannot explain why.
- **Root Cause:** Close state has no reason taxonomy.
- **Recommendation:** Add `cancel_reason_code`, `cancel_reason_note`, `cancelled_by_email`.
- **Alternative:** Force a final comment, but structured fields are better.
- **Estimated Effort:** Small-Medium.
- **Risk:** Medium.
- **Priority:** P1.

## Lifecycle Issue 4 - Special Actions Lack Version Guard

- **Severity:** High
- **Module:** `/api/tasks/[id]/reopen`, `/api/tasks/[id]/overdue-unlock`
- **Current Logic:** Generic PATCH has optimistic locking, Overview assignment uses an atomic RPC, but reopen/overdue-unlock still read then write without `expected_updated_at`.
- **Problem:** A stale reopen/unlock can overwrite a fresher status/action.
- **Impact:** Corrupted status history, duplicated reason events, wrong stage-cycle closures.
- **Example Scenario:** CS unlocks overdue while admin marks task done. Last write wins unexpectedly.
- **Root Cause:** Versioning added to generic PATCH but not all mutation endpoints.
- **Recommendation:** Require `expected_updated_at` on every task mutation endpoint, or move all state transitions to DB functions with row locks.
- **Alternative:** Add idempotency key per special action.
- **Estimated Effort:** Small-Medium.
- **Risk:** Medium.
- **Priority:** P0/P1 before Go Live if concurrent usage is expected.

---

# 3. Permission Review

## Effective Roles Observed

The codebase currently has:

- Admin / manager signal: Admin role + `task.manage`.
- Agent / assistant: worker/manage-like access within agent scope through `agent_members.is_assistant`.
- CS / staff: `task.work`, assigned tasks, participant visibility, agent-member visibility.
- Reporter: can edit content on tasks they created.
- Participant: can view/comment when mentioned or explicitly added.

## Permission Matrix

| Action | Admin | Agent Owner | Assistant | CS Assignee | CS Team Member | Reporter | Participant |
|---|---:|---:|---:|---:|---:|---:|---:|
| View all tasks | Yes | No | No | No | No | No | No |
| View scoped task | Yes | Yes | Yes | Yes | Yes if agent task has assignee | Yes if participant/reporter route grants | Yes |
| Create task | Yes | Yes for own agent | Yes for assisted agent | No | No | If also agent scope | No |
| Edit title/desc/category/priority/agent | Yes | Yes | Yes | No | No | Yes | No |
| Assign/reassign | Yes | Yes | Yes | No | No | No | No |
| Move status | Yes | Yes | Yes | Yes | No | No | No |
| Overdue unlock | Yes | Yes | Yes | Yes if assignee | No | No | No |
| Reopen | Yes | Yes | Yes | Yes if assignee | No | No | No |
| QC review done/cancel | Yes | Yes | Yes | No | No | No | No |
| Delete/archive task | Yes | Yes | Yes | No | No | No | No |
| Comment | Yes if visible | Yes | Yes | Yes | Yes if visible | Yes if visible | Yes |
| Mention | Yes if can comment | Yes | Yes | Yes | Yes | Yes | Yes |
| Upload task attachment | Yes | Yes | Yes | No unless comment attachment | Reporter yes | No | Own comment attachment |
| Manage categories/SLA/reminders | Yes | No | No | No | No | No | No |
| Account/role management | Dedicated permissions | No | No | No | No | No | No |

## Permission Strengths

- Server and client use the same capability resolver for many task decisions.
- Admin view requires Admin role, not merely `task.manage`, reducing accidental global view.
- Backlog is manager-only.
- Agent owner/assistant scope is explicit.

## Permission Gaps

## Permission Issue 1 - Permission Set Is Too Coarse For Audit-Sensitive Actions

- **Severity:** Medium
- **Module:** RBAC / `PERMISSIONS`
- **Current Logic:** Task permissions are mostly `task.manage` and `task.work`.
- **Problem:** Editing priority/category/agent, assigning, QC review, archive, and SLA settings are not separately permissioned.
- **Impact:** Hard to delegate safely. A user who should assign may also edit priority/category.
- **Example Scenario:** Team lead should reassign tasks but not change SLA-impacting priority/category.
- **Root Cause:** Permission model grew from product surface, not risk actions.
- **Recommendation:** Add granular permissions: `task.assign`, `task.edit_content`, `task.change_priority`, `task.review_qc`, `task.archive`, `task.settings_manage`, `task.export`.
- **Alternative:** Keep coarse roles for launch but document role templates strictly.
- **Estimated Effort:** Medium.
- **Risk:** Medium.
- **Priority:** P2.

## Permission Issue 2 - Admin Mutations Lack Audit

- **Severity:** High
- **Module:** `api/admin/**`
- **Current Logic:** Account, role, SLA, reminder, category changes are not written to an admin audit log.
- **Problem:** No accountability for permission changes or metric-affecting setting edits.
- **Impact:** Compliance and trust gap.
- **Example Scenario:** Someone changes Urgent SLA from 60 to 600 minutes before a report.
- **Root Cause:** Task audit exists; admin audit does not.
- **Recommendation:** Add `admin_audit_log(actor_email, action, target_table, target_id, before, after, created_at, request_id)`.
- **Alternative:** Use external audit provider/Sentry breadcrumbs, but DB log is still needed.
- **Estimated Effort:** Medium.
- **Risk:** High if skipped.
- **Priority:** P1.

---

# 4. Database Review

## Strengths

- `tasks` has soft archive via `archived_at`.
- Comments have soft delete and edit history.
- Attachments are private signed URLs.
- Stage history exists in `task_stage_cycles`.
- Assignment history exists in `task_assignment_cycles`.
- Overdue history exists in `task_overdue_events`.
- SLA rules and reminder settings live in DB.
- Core enum checks exist for statuses/priorities/notification/activity types.
- Search has trigram indexes.
- RLS is enabled across tables, while server uses service role deliberately.

## Database Issue 1 - Identity Is Email String, Not Stable User ID

- **Severity:** Critical long-term, Medium after current hard-delete/email-edit guards
- **Module:** Schema / task people references
- **Current Logic:** `tasks.assignee_email`, `agent_email`, `reporter_email`, comments, notifications, cycles, agent members all use text email.
- **Problem:** Email is mutable business data being used as identity.
- **Impact:** Historical KPI and ownership can split or orphan if any bypass appears.
- **Example Scenario:** Employee changes email domain. History stays on old email unless every table is migrated.
- **Root Cause:** No stable `portal_account.id` FK on task actor fields.
- **Recommendation:** Add stable user reference columns while preserving email snapshots: `assignee_user_id`, `agent_user_id`, `reporter_user_id`, `actor_user_id`; keep `*_email_snapshot`.
- **Alternative:** Maintain immutable email policy forever, but that is operationally brittle.
- **Estimated Effort:** Large.
- **Risk:** High.
- **Priority:** P2, but design now.

## Database Issue 2 - Dual Assignee Source Of Truth

- **Severity:** Medium
- **Module:** `tasks.assignee_email` + `task_assignees`
- **Current Logic:** Both exist. App mirrors the first assignee to `tasks.assignee_email`.
- **Problem:** Any missed writer creates data drift.
- **Impact:** Board visibility, analytics, and assignment history may disagree.
- **Example Scenario:** A task has two junction assignees but legacy column points to one; reports count only the primary.
- **Root Cause:** Migration from single to multi-assignee is incomplete.
- **Recommendation:** Pick one source. Preferred: `task_assignees` is source of truth; replace constraints with trigger/materialized primary assignee if needed.
- **Alternative:** Drop multi-assignee support.
- **Estimated Effort:** Medium.
- **Risk:** Medium.
- **Priority:** P2.

## Database Issue 3 - Missing Version Column

- **Severity:** Medium
- **Module:** `tasks`
- **Current Logic:** Optimistic locking uses `updated_at`.
- **Problem:** Timestamp equality is okay but less explicit than a monotonically increasing `version`.
- **Impact:** Harder to reason about concurrency, especially across DB functions and background jobs.
- **Example Scenario:** Two updates in the same timestamp precision window behave unexpectedly.
- **Root Cause:** No explicit versioning model.
- **Recommendation:** Add `version integer not null default 1`, increment through all mutation endpoints/functions.
- **Alternative:** Continue using `updated_at`, but enforce it on every mutation endpoint.
- **Estimated Effort:** Medium.
- **Risk:** Medium.
- **Priority:** P2.

## Database Issue 4 - Missing `updated_by`, `archived_by`, `deleted_by`

- **Severity:** Medium
- **Module:** `tasks`, `task_comments`, `task_attachments`, settings tables
- **Current Logic:** Some audit is in `task_activity`; task row has no `updated_by`, archive has no actor, comments delete with `deleted_at` only.
- **Problem:** Operational triage cannot quickly identify the last modifier/deleter without reconstructing activity.
- **Impact:** Support and accountability slow down.
- **Example Scenario:** Task disappeared from board because archived; row only has `archived_at`, not who archived it.
- **Root Cause:** Partial audit design.
- **Recommendation:** Add `updated_by_email`, `archived_by_email`, `deleted_by_email` where applicable.
- **Alternative:** Ensure every mutation writes `task_activity` with enough metadata and build audit viewer.
- **Estimated Effort:** Small-Medium.
- **Risk:** Medium.
- **Priority:** P2.

## Database Issue 5 - Reporting Layer Missing

- **Severity:** High
- **Module:** Historical tables / analytics
- **Current Logic:** Rich data is captured, but overview uses live rows and last-7-day done rows in app memory.
- **Problem:** Historical performance reporting is not surfaced.
- **Impact:** CEO/manager analytics need raw SQL, not product UX.
- **Example Scenario:** "Show completion-time trend by CS over 6 months" is not available in-app.
- **Root Cause:** Capture and exposure were built separately; exposure not done.
- **Recommendation:** Add SQL views/materialized views for daily/person/team/category metrics.
- **Alternative:** Export to BI tool first.
- **Estimated Effort:** Large.
- **Risk:** High for business goal.
- **Priority:** P1.

## Database Issue 6 - Cron Predicate Indexes Are Incomplete

- **Severity:** Medium at scale
- **Module:** `tasks`, cron
- **Current Logic:** There are general status/archive indexes; cron filters by `status`, `archived_at`, `*_started_at`, `*_reminded_at`, `closed_at`, `done_reviewed_by_email`.
- **Problem:** Large task volumes will scan too much.
- **Impact:** Cron latency and DB load grow sharply.
- **Example Scenario:** 100k open tasks, cron every 15 minutes, multiple scans.
- **Root Cause:** Indexes were designed for board, not background reminder scans.
- **Recommendation:** Add partial indexes for open active reminders:
  - `(status, in_progress_at) where archived_at is null`
  - `(status, todo_started_at, todo_reminded_at) where archived_at is null`
  - `(status, waiting_started_at, waiting_reminded_at) where archived_at is null`
  - `(status, closed_at, qc_reminded_at) where archived_at is null and done_reviewed_by_email is null`
  - `(last_activity_at, stale_reminded_at) where archived_at is null and status in (...)`
- **Alternative:** Materialize reminder candidates.
- **Estimated Effort:** Small.
- **Risk:** Medium.
- **Priority:** P2, P1 if volume jumps.

---

# 5. Tracking Capability

This is the most important section. Current DB can support live workload triage, but it cannot yet support fair, complete performance measurement.

## What The Current DB Can Answer

- Current open tasks per person.
- Current stage mix per person.
- Priority mix per person.
- Current SLA exposure for In Progress work.
- Current overdue count / was-overdue count.
- Done count in last 24h/7d.
- Stage duration once tasks move through statuses.
- Assignment duration through `task_assignment_cycles`.
- Overdue event duration/reason through `task_overdue_events`.
- Reopen events through `task_activity.type = task_reopened`.
- Comments and attachments history.
- QC review timestamp through `done_reviewed_at`.

## What The Current DB Cannot Answer Reliably

- Who accepts tasks fastest.
- Who ignores assignments.
- First response time.
- Blocked vs external waiting vs dependency waiting.
- Why tasks are cancelled.
- Why tasks are rejected.
- How much delay is caused by agent/customer/carrier/internal team.
- Staff working hours vs wall-clock hours.
- Idle time.
- Fair team comparison across weekends/holidays.
- Estimate vs actual.
- Velocity/burndown/burnup.
- Department/team performance unless team is derived indirectly from agent groups.
- Client/project bottleneck unless client/project fields are modeled.

## Tracking To Add Immediately

| Tracking | Field/Event | Why |
|---|---|---|
| Assignment time | `task_assignment_cycles.assigned_at` exists | Already good. |
| Acceptance time | `accepted_at`, `accepted_by_email` | Measures responsiveness. |
| First response | `first_response_at`, `first_response_by_email`, derive from comment/status if needed | Measures engagement. |
| First start | `in_progress_at` exists | Already exists. |
| Stage durations | `task_stage_cycles` exists | Already good. |
| Waiting reason | `waiting_type`, `waiting_reason`, `waiting_owner` | Explains bottlenecks. |
| Blocked duration | `blocked_at`, `blocked_reason`, `blocked_by_task_id`, or blocked events | Separates dependency from normal waiting. |
| Review duration | `closed_at -> done_reviewed_at` exists | Already derivable. |
| Reopen reason | `task_activity.meta.reason` exists | Good, but materialize count later. |
| Reassign count | materialized counter + activity | Better analytics. |
| Priority changed count | materialized counter + activity | Detect metric gaming / urgency churn. |
| Due/SLA changed count | add if due date/deadline returns | Detect scope change. |
| Cancel reason | `cancel_reason_code`, `cancel_reason_note` | Explains waste. |
| Reject reason | `reject_reason_code`, `reject_reason_note` | If Reject is added. |
| Estimate | `estimate_minutes` or `estimate_points` | Needed for velocity. |
| Actual effort | derive from cycles + optional manual time | Needed for estimate accuracy. |
| Working calendar | org/team/user calendar tables | Fair SLA. |
| Team snapshot | `team_id_snapshot`, `department_id_snapshot` on task/cycle | Historical org analytics. |
| Client/project | `client_id`, `project_id` or domain entity | Client/project bottleneck. |
| Manual override | `manual_override_reason`, actor | Explain altered SLA/status. |
| Notification delivery | `delivered_at`, `channel`, `failure_reason` | Ops reliability. |

## Tracking Issue - Performance Measurement Will Be Biased

- **Severity:** High
- **Module:** Tracking / analytics
- **Current Logic:** Most measurement is stage/status time, not acceptance/response/working-time adjusted.
- **Problem:** Fast workers who accept late vs slow workers who accept early cannot be distinguished.
- **Impact:** Performance ratings may be unfair.
- **Example Scenario:** CS A accepts immediately but waits on customer. CS B ignores tasks for 2 days then finishes quickly. Current metrics can misread both.
- **Root Cause:** Missing event granularity.
- **Recommendation:** Add acceptance, response, waiting reason, working calendar, and team snapshots before using metrics for compensation/performance decisions.
- **Alternative:** Use current metrics only as operational triage, not performance judgment.
- **Estimated Effort:** Medium-Large.
- **Risk:** High.
- **Priority:** P1.

---

# 6. Workload Analytics

## KPI Capability Matrix

| KPI | Current DB? | Reliability | Missing Data |
|---|---:|---:|---|
| Task/person | Yes | Good | Finish assignee source migration. |
| Task/week/month | Yes | Medium | Reporting views. |
| Average completion time | Yes | Medium | Need reporting views; define completion. |
| Average review time | Yes | Good | Use `closed_at -> done_reviewed_at`. |
| Average waiting time | Yes | Medium | Waiting reason/type missing. |
| Average blocked time | No | None | Blocked state/type/dependency. |
| Average response time | No | None | `first_response_at`. |
| Lead time | Yes | Medium | `created_at -> closed_at`, but business calendar missing. |
| Cycle time | Yes | Medium | Need canonical lifecycle and reporting. |
| WIP | Yes | Good | Current live only. |
| Backlog | Yes | Good | Current live only. |
| Velocity | No | None | Estimate/iteration/sprint model. |
| Burn down/up | No | None | Iteration + estimate. |
| Throughput | Yes | Medium | Reporting views. |
| Task aging | Yes | Good | Business calendar missing. |
| Distribution by priority | Yes | Good | Already has priority. |
| Distribution by team | Partial | Weak | Team entity/snapshot. |
| Distribution by department | No | None | Department entity/snapshot. |
| Distribution by assignee | Yes | Medium | Dual assignee source risk. |
| Distribution by category | Yes | Good | Category exists. |
| Distribution by client | Partial | Weak | Need client/project model, currently title/agent only. |
| Distribution by project | No | None | Project entity. |
| Overdue rate | Yes | Medium | Business calendar missing; overdue once-only semantics must be accepted. |
| Reopen rate | Yes | Medium | Activity event exists; materialized count recommended. |
| Reject rate | No | None | Reject action. |
| Approval/QC time | Yes | Good | `closed_at -> done_reviewed_at`. |
| Manager load | Partial | Weak | Need assignment/review ownership and reporting. |
| Reviewer load | Partial | Medium | `done_reviewed_by_email`; need pending QC queue. |
| Department load | No | None | Department model. |

## Analytics Issue - Overview Is A Live Operations Dashboard, Not A Performance Dashboard

- **Severity:** High
- **Module:** Overview / analytics
- **Current Logic:** Overview aggregates current active tasks and recent done tasks in application memory.
- **Problem:** It cannot show long-term trends, seasonality, team comparisons, or historical bottlenecks.
- **Impact:** CEO and managers cannot use the app alone for 6-month performance review.
- **Example Scenario:** "Why did July throughput drop?" There is no trend dashboard.
- **Root Cause:** Missing rollup/reporting layer.
- **Recommendation:** Build daily rollups:
  - `task_daily_person_metrics`
  - `task_daily_team_metrics`
  - `task_daily_category_metrics`
  - `task_sla_breach_daily`
  - `task_qc_daily`
- **Alternative:** Connect Metabase/Looker to read-only SQL views first.
- **Estimated Effort:** Large.
- **Risk:** High for analytics promise.
- **Priority:** P1.

---

# 7. Notification Review

## Current Channels

- In-app notification table.
- Realtime ping to open tabs.
- Bell fetch limit 30.
- No email, push, Slack, digest, pagination, per-user preferences, or retention.

## Current Implemented Notification Map

| Notification | Admin | Agent/Assistant | CS/Assignee | Trigger |
|---|---|---|---|---|
| `assigned` | If assigned | If assigned | New assignee | Create, assign, reassign |
| `unassigned` | If removed | If removed | Old assignee | Remove/reassign |
| `mentioned` | If mentioned | If mentioned | If mentioned | Comment mention |
| `commented` | If participant/reporter/agent | If participant/reporter/agent | Assignee/participant | New comment |
| `due_soon` | No | No | Assignee | SLA due-soon cron |
| `overdue` | No | No | Assignee | First SLA breach |
| `overdue_reminder` | No | No | Assignee | Repeat SLA breach reminder |
| `sla_escalated` | Urgent/high overdue | Urgent/high due soon/overdue | No, unless also agent/admin | SLA escalation |
| `todo_reminder` | No | No | Assignee | Todo stale by setting |
| `waiting_reminder` | No | No | Assignee | Waiting stale by setting |
| `stale` | No | No | Assignee | No recent activity |
| `qc_needed` | If admin is QC owner | Agent owner/assistant | No | Done/Cancel needs QC |
| `qc_stale` | If admin is QC owner | Agent owner/assistant | No | Done/Cancel QC overdue |
| `qc_reviewed` | If reporter/assignee | If reporter/assignee | Assignee/reporter | QC checked |
| `reopened` | If assignee | If assignee | Assignee | Reopen Done/Cancel |
| `cancelled` | If reporter/assignee | If reporter/assignee | Assignee/reporter | Task cancelled |
| `overdue_unlocked` | Yes | Agent owner/assistant | No, unless admin/agent | Overdue continuation reason logged |
| `attachment_added` | If related | If agent owner/assistant | Assignee/reporter | Task-level attachment |
| `backlog_attention` | Yes | Agent owner/assistant | No | Urgent/high backlog task has no assignee |

No Accept/Reject notifications are proposed because the current product has no Accept/Reject state.
No priority/category/agent-changed or system-setting notifications are proposed for this release per product scope.

## Notification Issue 1 - In-App Only Is Not Enough For Escalations

- **Severity:** Medium-High
- **Module:** Notifications
- **Current Logic:** Notifications are persisted and shown in-app; no email/Slack/push.
- **Problem:** Offline users miss urgent events.
- **Impact:** Overdue/QC issues may age silently.
- **Example Scenario:** Agent is not logged in; QC-stale notification waits unseen.
- **Root Cause:** No external delivery channel.
- **Recommendation:** Add email for critical SLA/QC events after in-app behavior is stable: urgent/high SLA escalated, overdue unlocked, QC stale.
- **Alternative:** Slack webhook to admin/ops channel first.
- **Estimated Effort:** Medium.
- **Risk:** Medium.
- **Priority:** P2, P1 for escalation-heavy launch.

## Notification Issue 2 - Bell Is Capped At 30 With No Pagination

- **Severity:** Medium
- **Module:** `/api/tasks/notifications`
- **Current Logic:** GET returns latest 30 notifications.
- **Problem:** Older unread notifications can become unreachable in the UI.
- **Impact:** Busy users lose context.
- **Example Scenario:** Admin receives 80 reminder notifications overnight; important older QC item falls off.
- **Root Cause:** No pagination/load-more.
- **Recommendation:** Add cursor pagination and unread filter.
- **Alternative:** Auto-mark low-priority reminder digest as grouped rows.
- **Estimated Effort:** Small-Medium.
- **Risk:** Medium.
- **Priority:** P2.

## Notification Issue 3 - No Preferences, Digest, Or Throttle

- **Severity:** Medium
- **Module:** Notification product
- **Current Logic:** All notification types are global behavior.
- **Problem:** Reminder/comment spam will cause users to ignore the bell.
- **Impact:** Critical events lose attention.
- **Example Scenario:** A task with a comment storm generates many notifications.
- **Root Cause:** No preference model or anti-spam policy.
- **Recommendation:** Add `notification_preferences`, per-type channel, quiet hours, digest grouping, burst throttle.
- **Alternative:** Hard-code low-priority reminder family into daily digest.
- **Estimated Effort:** Medium-Large.
- **Risk:** Medium.
- **Priority:** P2.

---

# 8. Setting Review

## Current Settings

- SLA rules by priority/category.
- Reminder thresholds: due soon, todo, overdue reminder, waiting, stale, QC.
- Dashboard filter defaults.
- Account/password settings.

## Setting Strengths

- SLA and reminder values are in DB, not only hard-coded.
- Defaults are seeded idempotently.
- Board users can read SLA rules for consistent countdown display.

## Setting Gaps

## Setting Issue 1 - Global Reminder Settings Are Too Coarse

- **Severity:** Medium
- **Module:** `task_reminder_settings`
- **Current Logic:** One global row.
- **Problem:** Different teams/categories may need different reminder cadence.
- **Impact:** Either some teams get spammed or some get reminders too late.
- **Example Scenario:** Urgent insurance call tasks need 15-minute nudges; low priority data cleanup does not.
- **Root Cause:** Settings are global.
- **Recommendation:** Add scope columns: `organization_id`, `team_id`, `category_id`, `priority`, with fallback hierarchy.
- **Alternative:** Keep global for launch; add per-category/priority reminder overrides first.
- **Estimated Effort:** Medium.
- **Risk:** Medium.
- **Priority:** P2.

## Setting Issue 2 - Settings Lack Audit And Effective Date

- **Severity:** High
- **Module:** SLA/reminder/admin settings
- **Current Logic:** Setting row updates in place with `updated_at`.
- **Problem:** Reports cannot know what SLA/reminder policy was active historically unless the task snapshot captured it.
- **Impact:** Trend changes can be misinterpreted.
- **Example Scenario:** Overdue rate drops because SLA changed, not because work improved.
- **Root Cause:** No settings audit/version/effective period.
- **Recommendation:** Add settings audit log and `effective_from/effective_to` policy versioning.
- **Alternative:** Snapshot every applied SLA/reminder policy onto task/cycle rows.
- **Estimated Effort:** Medium.
- **Risk:** High for analytics.
- **Priority:** P1.

---

# 9. Error Handling

## Current Strengths

- Most APIs return clear 400/401/403/404/409/500.
- Generic task PATCH now handles conflict.
- Client has optimistic rollback for generic PATCH.
- Overview assign rolls back and refetches on conflict.
- Attachment upload has max file size.

## Error Handling Gaps

## Error Issue 1 - Conflict Handling Is Not Uniform

- **Severity:** High
- **Module:** Task mutation endpoints
- **Current Logic:** Generic PATCH and assign RPC have conflict protection; reopen/overdue-unlock do not.
- **Problem:** Users can still lose updates on special actions.
- **Impact:** Data inconsistency and confusing UI.
- **Example Scenario:** User opens stale drawer and reopens a task already updated by another actor.
- **Root Cause:** Optimistic locking not centralized.
- **Recommendation:** All mutations must accept `expected_updated_at`.
- **Alternative:** DB transition functions with row locks.
- **Estimated Effort:** Small-Medium.
- **Risk:** Medium.
- **Priority:** P1.

## Error Issue 2 - Offline / Retry Strategy Is Basic

- **Severity:** Medium
- **Module:** UI/network
- **Current Logic:** Failed patch shows error and reverts.
- **Problem:** No retry queue, offline indicator, or unsaved draft protection.
- **Impact:** Mobile/spotty network users lose typed comments/form edits.
- **Example Scenario:** User writes long comment, network fails, text may be lost unless component preserves draft.
- **Root Cause:** No offline UX policy.
- **Recommendation:** Preserve drafts locally, add retry button for failed mutations, show conflict modal with refresh.
- **Alternative:** Minimal "copy before refresh" warning for launch.
- **Estimated Effort:** Medium.
- **Risk:** Medium.
- **Priority:** P2.

## Error States To QA Before Go Live

- Empty board for each role.
- Empty backlog.
- No categories configured.
- No SLA rule for category/priority.
- User loses permission mid-session.
- Task archived while drawer open.
- Comment deleted while user replies.
- Attachment deleted while preview/sign URL is open.
- Conflict on move/status edit.
- Cron secret missing.
- GitHub workflow secret missing.
- Supabase outage.
- Storage upload failure after DB insert or before DB insert.

---

# 10. Edge Cases

## People / Org

- User leaves company.
- Admin deactivates user with open tasks.
- Admin tries hard-delete user with history.
- Email typo correction after tasks exist.
- Agent owner account deactivated.
- Assistant removed from agent group.
- CS removed from group while assigned to tasks.
- Last admin deactivation.
- Role downgraded while user has board open.
- Google login user without portal account.

## Task

- Backlog task accidentally assigned with no category.
- Non-backlog without assignee.
- Multi-assignee task where primary assignee differs from junction.
- Task moved to Waiting before In Progress.
- Task moved from Backlog directly to In Progress.
- Done task reopened repeatedly.
- Cancelled task reopened.
- Overdue task completed without overdue-unlock.
- Overdue-unlock reason too vague.
- Priority changed after task starts.
- Category changed after SLA snapshot.
- Agent changed while assignees not in new team.
- Task archived while someone edits it.
- Task search result for archived task.

## Time / SLA

- Friday 5pm task goes overdue during weekend.
- Daylight saving time for US users.
- User timezone differs from server timezone.
- Clock skew between client and server.
- SLA setting changed mid-task.
- Cron delayed by GitHub Actions.
- Cron retried after partial failure.
- Due-soon sent after task already overdue.

## Comments / Attachments

- Deleted comment with child replies.
- Mention in deleted comment.
- Attachment uploaded to comment then comment deleted.
- File type spoofed by browser MIME.
- Very large image or Excel file.
- Signed URL expires while user previews.
- Storage delete succeeds but DB delete fails.
- DB insert succeeds but storage upload fails.

## Notifications

- Duplicate assignment notification.
- Reminder spam.
- Mention storm.
- Notification for archived task.
- Notification actor deleted/deactivated.
- More than 30 unread notifications.
- User muted a type but critical event should still notify.

## Concurrency

- Two admins assign same backlog task.
- Admin edits priority while CS changes status.
- CS moves task while cron flags overdue.
- Reopen while QC review happens.
- Overdue-unlock while Done happens.
- Attachment delete while another user opens it.
- Comment edit while notification reads comment body.

---

# 11. Security Review

## Security Strengths

- Auth required for app routes.
- Service-role DB access is server-side.
- RLS enabled for tables.
- Board visibility checks exist for task/comment/attachment routes.
- Login rate limiting exists: 5 failed attempts / 15 minutes.
- Password hash uses bcrypt.
- React rendering lowers XSS risk by default.
- Search escapes ILIKE wildcards.
- File attachments use private bucket and signed URLs.

## Security Issue 1 - Cron Secret Still Accepted In Query String

- **Severity:** Medium
- **Module:** `/api/cron/check-overdue`, `/api/cron/sync-data`
- **Current Logic:** Authorization header or `?secret=` accepted.
- **Problem:** Query secrets leak into logs, browser history, referrers, and monitoring URLs.
- **Impact:** Secret exposure risk.
- **Example Scenario:** Someone copies cron URL with secret into a ticket.
- **Root Cause:** Convenience compatibility.
- **Recommendation:** Accept only `Authorization: Bearer ...` after rollout.
- **Alternative:** Allow query secret only in non-production.
- **Estimated Effort:** Small.
- **Risk:** Medium.
- **Priority:** P2.

## Security Issue 2 - No API Rate Limit For Task/Notification Mutations

- **Severity:** Medium
- **Module:** Task/comment/notification APIs
- **Current Logic:** Login has rate limit; task APIs do not.
- **Problem:** Authenticated user can spam comments, mentions, uploads, notification marks.
- **Impact:** Notification abuse, DB growth, storage cost.
- **Example Scenario:** Compromised CS account mentions all users repeatedly.
- **Root Cause:** No per-user mutation throttle.
- **Recommendation:** Add rate limit per actor/action, especially comments, mentions, uploads, search.
- **Alternative:** Start with WAF/Vercel rate limit if available.
- **Estimated Effort:** Medium.
- **Risk:** Medium.
- **Priority:** P2.

## Security Issue 3 - File Upload Type Policy Is Too Permissive

- **Severity:** Medium
- **Module:** Attachments/storage
- **Current Logic:** Max size is 15MB; MIME is inferred but bucket `allowedMimeTypes` is null.
- **Problem:** Any file type can be uploaded if under size.
- **Impact:** Malware/content abuse risk.
- **Example Scenario:** User uploads executable renamed as harmless file.
- **Root Cause:** No allow-list enforcement at storage bucket/API.
- **Recommendation:** Enforce allowed MIME/extension server-side and storage bucket-side; consider AV scanning for production.
- **Alternative:** Disable risky file types and only allow pdf/images/csv/xlsx/txt.
- **Estimated Effort:** Small-Medium.
- **Risk:** Medium.
- **Priority:** P1/P2 depending customer exposure.

## Security Issue 4 - No Admin Audit Log

- **Severity:** High
- **Module:** Admin APIs/security
- **Current Logic:** Admin changes are not audited.
- **Problem:** Permission escalation, account changes, and SLA manipulation have no durable trail.
- **Impact:** No accountability after incident.
- **Example Scenario:** Account Manager grants Admin to personal account.
- **Root Cause:** Missing admin audit table/service.
- **Recommendation:** Add admin audit before expanding admin user base.
- **Alternative:** Temporarily restrict admin access to one/two trusted users and log via external system.
- **Estimated Effort:** Medium.
- **Risk:** High.
- **Priority:** P1.

---

# 12. Performance Review

## Current Strengths

- Small data volume should perform fine.
- Task search has trigram indexes.
- Board query filters archived tasks.
- Overview does parallel DB fetches.
- Notification enrichment batches task/actor/comment lookup for latest 30.

## Performance Risks

## Performance Issue 1 - Overview Aggregates In App Memory

- **Severity:** Medium now, High at scale
- **Module:** `fetchTaskOverview`
- **Current Logic:** Loads all active/backlog tasks and recent done tasks, then aggregates in app memory.
- **Problem:** At 100k tasks this becomes slow and memory-heavy.
- **Impact:** Admin overview becomes unreliable exactly when needed most.
- **Example Scenario:** Admin opens Overview Monday morning; request times out.
- **Root Cause:** No server-side rollups/materialized views.
- **Recommendation:** Move workload metrics to SQL views/materialized daily/live rollups.
- **Alternative:** Paginate CS rows and pre-filter by team.
- **Estimated Effort:** Large.
- **Risk:** High at scale.
- **Priority:** P2 before large rollout.

## Performance Issue 2 - Reminder Cron Has N+1 Assignee Fetch

- **Severity:** Medium
- **Module:** `/api/cron/check-overdue`
- **Current Logic:** Each candidate task fetches assignees separately.
- **Problem:** Thousands of candidate tasks create thousands of DB round trips.
- **Impact:** Timeouts and DB connection pressure.
- **Example Scenario:** 20k stale tasks trigger 20k assignee queries.
- **Root Cause:** Per-task fan-out.
- **Recommendation:** Batch all candidate task IDs, fetch assignees once, process in chunks.
- **Alternative:** Store denormalized active assignees on task rollup.
- **Estimated Effort:** Medium.
- **Risk:** Medium.
- **Priority:** P2.

## Performance Issue 3 - Notifications Are Unbounded

- **Severity:** Medium
- **Module:** `task_notifications`
- **Current Logic:** Table grows forever; GET latest 30.
- **Problem:** Long-term table growth hurts reads and storage.
- **Impact:** Bell slows, unread counts slow.
- **Example Scenario:** 100k users x reminders = millions of rows/month.
- **Root Cause:** No retention/partition/pagination.
- **Recommendation:** Add retention policy, partition by month if needed, cursor pagination, composite indexes by recipient/type/read/date.
- **Alternative:** Archive old read notifications to cold table.
- **Estimated Effort:** Medium.
- **Risk:** Medium.
- **Priority:** P2.

---

# 13. Observability

## Must Add / Verify

- Application error tracking: Sentry or equivalent.
- Cron heartbeat table: `job_runs(job_name, started_at, finished_at, status, counts, error)`.
- Alert when task reminder cron has no successful run in >30 minutes.
- Alert when sync-data cron fails.
- Notification delivery log if email/Slack is added.
- Admin audit log.
- Slow query logging.
- Build/deploy health check.
- `/api/health` endpoint checking app, DB, storage, auth env.
- Business dashboard for overdue count, QC stale count, unassigned backlog, stuck Todo/Waiting.

## Observability Issue - No Durable Cron Heartbeat

- **Severity:** High
- **Module:** Cron/Ops
- **Current Logic:** GitHub Actions calls reminder cron every 15 minutes; failure is visible in GitHub Actions but not inside product DB.
- **Problem:** Product cannot tell whether overdue detection is healthy.
- **Impact:** SLA/reminder system can silently stop.
- **Example Scenario:** GitHub secret is missing after environment migration; no overdue reminders fire.
- **Root Cause:** Cron runs do not write heartbeat or alert state.
- **Recommendation:** Add `job_runs` table and write success/failure summary for every cron. Alert on stale heartbeat.
- **Alternative:** Configure GitHub Actions failure notification to Slack/email immediately.
- **Estimated Effort:** Small-Medium.
- **Risk:** High.
- **Priority:** P1 before Go Live.

---

# 14. Go Live Checklist

## Database

- [ ] Apply latest schema migration to staging.
- [ ] Apply latest schema migration to production.
- [ ] Verify `task_activity_type_check` exists.
- [ ] Verify `task_notifications_type_check` includes all live notification types.
- [ ] Verify account delete/email edit guard in production.
- [ ] Backup production DB before launch.
- [ ] Test restore from backup.
- [ ] Confirm RLS enabled on all public tables.
- [ ] Confirm service role key exists only server-side.
- [ ] Run seed/default data idempotently.
- [ ] Verify no orphan non-backlog task with missing assignee account.
- [ ] Verify no task with `status <> backlog` and no effective assignee.

## Migration / Rollback

- [ ] Have rollback script or restore plan.
- [ ] Validate migration on copy of production data.
- [ ] Record expected migration duration.
- [ ] Freeze schema changes during launch window.
- [ ] Prepare manual SQL checks for task counts before/after.

## Permission

- [ ] Define final role templates: Admin, Agent/Assistant, CS.
- [ ] Verify each role can only see intended tasks.
- [ ] Verify Agent/Assistant cannot see global admin overview unless intended.
- [ ] Verify CS cannot create/assign/global-view.
- [ ] Verify last-admin protection.
- [ ] Verify account deactivation flow.

## Notification

- [ ] Trigger assigned notification.
- [ ] Trigger mention notification.
- [ ] Trigger comment notification.
- [ ] Trigger due-soon notification via cron.
- [ ] Trigger overdue notification via cron.
- [ ] Trigger overdue-unlocked notification and confirm reason is visible.
- [ ] Trigger QC-stale notification.
- [ ] Verify bell sound duration is 5s.
- [ ] Verify more than 30 notifications does not hide critical unread items, or accept risk.

## Cron / Scheduler

- [ ] Verify `.github/workflows/task-reminders.yml` runs manually.
- [ ] Verify `TASK_CRON_URL` points to production `/api/cron/check-overdue`.
- [ ] Verify `TASK_CRON_SECRET` matches production `CRON_SECRET`.
- [ ] Verify `/api/cron/sync-data` schedule.
- [ ] Add alert on GitHub Actions failure.
- [ ] Add or schedule cron heartbeat.

## QA / UAT

- [ ] Admin: create task backlog, assign, move, QC, archive.
- [ ] Agent/Assistant: create for own agent, assign own group, QC.
- [ ] CS: move assigned task, comment, upload own comment attachment, overdue unlock.
- [ ] Conflict: two users edit same task; confirm 409/refresh behavior.
- [ ] Reopen with reason.
- [ ] Cancel with current limitation documented.
- [ ] Search permission boundaries.
- [ ] Attachment permission boundaries.
- [ ] Mobile/responsive task board.
- [ ] Empty states for all roles.

## Security

- [ ] Rotate secrets before Go Live.
- [ ] Verify no secret in client bundle.
- [ ] Verify cron uses Authorization header in GitHub workflow.
- [ ] Review allowed upload types.
- [ ] Add task/comment/upload/search rate limits or accept launch risk.
- [ ] Restrict Admin role to minimum people.

## Performance / Scale

- [ ] Load test board with realistic task volume.
- [ ] Load test overview with worst-case active task count.
- [ ] Load test notification bell with thousands of notifications.
- [ ] Run cron against staging data with production-like volume.
- [ ] Capture p95/p99 route timings.
- [ ] Add missing indexes if p95 is high.

## Operations

- [ ] Create incident owner list.
- [ ] Create launch-day support channel.
- [ ] Document manual SQL triage queries.
- [ ] Document how to disable cron safely.
- [ ] Document how to deactivate/offboard user.
- [ ] Document known limitations: no acceptance metric, no working-hours calendar, no admin audit yet.

---

# 15. Summary Tables

## 1. Must Fix Before Go Live

| Priority | Issue | Current Status |
|---|---|---|
| P0 | Notification `detail` dropped | Fixed in worktree; deploy/migrate/verify. |
| P0 | Hard-delete account orphaning task history | Fixed in worktree by blocking referenced delete; deploy/verify. |
| P0 | Email edit detaches task history | Fixed in worktree by blocking referenced email edit; deploy/verify. |
| P0/P1 | Version guard missing on special task actions | Not fixed: add to reopen and overdue-unlock. |
| P1 | Cron heartbeat/failure alert | Not fixed: add workflow alert or DB heartbeat. |
| P1 | File upload allow-list | Not fixed: enforce MIME/extension if external users can upload. |
| P1 | Admin audit log | Not fixed: at least restrict admin changes and log launch manually. |
| P1 | Production migration verification | Must do before launch. |

## 2. Can Fix After Go Live

| Issue | Timing |
|---|---|
| Historical reporting module | Start week 1. |
| Accept/first-response tracking | Week 1/month 1 depending management KPI urgency. |
| Waiting/block reason taxonomy | Month 1. |
| Working-hours calendar | Month 1-3. |
| Notification digest/preferences | Month 1. |
| Assignee source-of-truth cleanup | 3 months. |
| Stable user_id migration | 3-6 months. |
| Per-team settings | 3 months. |
| Velocity/estimate model | 3 months. |

## 3. Tracking To Add Immediately

| Tracking | Why |
|---|---|
| `accepted_at`, `accepted_by_email` | Acceptance delay. |
| `first_response_at` | Responsiveness. |
| `waiting_type`, `waiting_reason`, `waiting_owner` | Bottleneck accuracy. |
| `cancel_reason_code`, `cancel_reason_note` | Cancellation analysis. |
| `blocked_by_task_id` | Dependency analysis. |
| `team_id_snapshot`, `department_id_snapshot` | Historical org analytics. |
| `reassign_count`, `priority_changed_count`, `reopen_count` | Robust KPI. |
| `estimate_minutes` | Velocity/estimate accuracy. |
| `updated_by_email`, `archived_by_email` | Audit/support. |
| `job_runs` | Cron health. |

## 4. Notifications To Add

| Notification | Recipient |
|---|---|
| SLA escalation for urgent/high due-soon | Agent owner/assistant. |
| SLA escalation for urgent/high overdue | Agent owner/assistant + admin. |
| QC reviewed | Assignee + reporter. |
| Task cancelled | Assignee + reporter, excluding QC owners already receiving `qc_needed`. |
| Attachment added | Assignee + reporter + agent owner/assistant. |
| Urgent/high backlog attention | Admin + agent owner/assistant. |
| Reassign old-assignee removal | Old assignee receives `unassigned`. |

## 5. Notifications To Remove Or Gather

Do not remove critical notifications. Gather/throttle:

- Todo reminders.
- Waiting reminders.
- Stale reminders.
- Repeated overdue reminders.
- Comment bursts on the same task.
- Mention bursts from the same actor.

## 6. CEO Dashboard

- Company throughput trend.
- Overdue rate trend.
- SLA breach trend by team/category/priority.
- Average lead/cycle time trend.
- WIP vs capacity.
- Backlog aging.
- Top bottleneck stages.
- Team comparison: on-time %, reopen rate, waiting time.
- Workload distribution by department/team/person.
- Forecast risk: tasks likely to miss SLA.

## 7. Manager Dashboard

- Per-CS workload table.
- Overloaded/free staff.
- Unassigned queue with SLA/category/agent.
- Overdue and due-soon queue.
- QC-stale queue.
- Stuck Todo/Waiting.
- Reassign/reopen rate by person.
- Done count 24h/7d/30d.
- Category/priority mix.
- Team capacity recommendation.

## 8. Team Lead Dashboard

- Team-only workload.
- Who is overloaded/idle.
- Tasks aging by stage.
- Waiting reasons.
- Blocked tasks.
- QC pending for team agents.
- First response/acceptance time.
- Weekly throughput.
- Reopened tasks requiring coaching.

## 9. Staff Dashboard

- My open work.
- My due-soon/overdue.
- My Todo aging.
- My Waiting tasks and required follow-up.
- My completed tasks 24h/7d/30d.
- My average cycle time.
- My reopen/QC pass rate.
- My mentions/comments needing reply.
- Transparent comparison to team median, not punitive ranking.

## 10. KPI Computable From Current DB

- Current task/person.
- Current WIP.
- Current backlog.
- Task/category/priority/assignee distribution.
- Open task aging.
- Done in last 24h/7d.
- Completion duration with caveats.
- Stage duration with caveats.
- Waiting duration, but no reason.
- Review/QC duration.
- Overdue count/rate with wall-clock caveat.
- Reopen count from activity.
- Assignment duration.
- Manager/reviewer load partially.

## 11. KPI Not Computable Yet

| KPI | Missing Data |
|---|---|
| Acceptance delay | `accepted_at`. |
| First response time | `first_response_at`. |
| True blocked time | blocked status/type/dependency. |
| Reject rate | reject action/reason. |
| Cancel reason distribution | cancel reason. |
| Working-hours adjusted SLA | working calendar. |
| Idle time | work schedule + assignment/acceptance model. |
| Velocity | estimate + iteration/sprint. |
| Burn down/up | estimate + iteration/sprint. |
| Department load | department entity/snapshot. |
| Team historical performance | team snapshot at task/cycle time. |
| Client/project bottleneck | client/project entity. |
| Estimate accuracy | estimate and actual effort model. |

## 12. Design Decisions I Do Not Agree With

| Decision | Why |
|---|---|
| Email-as-identity | Mutable value should not be FK substitute. |
| Dual assignee storage | Drift risk and analytics ambiguity. |
| No acceptance/first response tracking | Blocks fair performance measurement. |
| Waiting as one generic status | Bottleneck data becomes vague. |
| Admin changes without audit | Security and metric trust gap. |
| Live overview as analytics substitute | Good operations view, not historical BI. |
| Global-only reminder settings | Teams/categories need different cadence. |
| In-app-only critical notification | Offline escalation risk. |
| Wall-clock SLA only | Unfair over weekends/holidays. |

## 13. Technical Debt To Record

- Legacy `tasks.assignee_email`.
- No stable `user_id` task references.
- No admin audit log.
- No working-hours calendar.
- No notification preference/digest/pagination.
- Overview aggregates in app memory.
- Cron N+1 fan-out.
- Partial optimistic locking.
- No explicit transition matrix.
- No settings version/effective-period history.
- No job heartbeat.
- Attachment bucket allows all MIME types.

## 14. Biggest Post-Go-Live Risks

1. Metrics look precise but are missing acceptance/response/waiting reason/working calendar, causing unfair performance judgment.
2. Cron/reminder failure goes unnoticed and overdue/QC detection stops.
3. Admin setting/permission changes are not auditable.
4. Overview works at small scale but slows badly at high task volume.
5. Notification fatigue causes users to ignore important events.
6. Dual assignee source drifts under future changes.
7. Email identity model creates long-term migration pain.

## 15. Roadmap

### 1 Week

- Deploy and verify current P0 fixes.
- Add version guard to reopen and overdue-unlock.
- Add cron heartbeat or GitHub Actions failure alert to Slack/email.
- Enforce attachment MIME/extension allow-list.
- Add minimal admin audit for account/role/SLA/reminder changes.
- Run staging UAT for Admin, Agent/Assistant, CS.
- Run migration dry-run and backup/restore test.

### 1 Month

- Add acceptance and first-response tracking.
- Add cancel/waiting/block reason taxonomy.
- Add read-only analytics SQL views.
- Add notification pagination and unread filters.
- Add critical email notifications.
- Add settings audit/versioning.
- Add manager historical dashboard v1.

### 3 Months

- Add team/department entity and snapshots.
- Add working-hours calendar.
- Batch cron queries and add reminder indexes.
- Clean up assignee source of truth.
- Add notification preferences/digest.
- Add estimate model and velocity dashboard if business wants capacity planning.

### 6 Months

- Migrate task people references to stable `user_id`.
- Add materialized rollups and partition large history/notification tables.
- Add CEO dashboard.
- Add per-team/per-category settings.
- Add dependency graph.
- Add full observability stack: tracing, slow query, job queue, retry/dead-letter.
