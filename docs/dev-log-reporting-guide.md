# Agent Portal Dev Log Reporting Guide

Use this guide whenever the user asks for an Agent Portal daily report, dev log, or a summary of commits for a specific date.

## How to prepare the report

1. Use the requested report date in the `Asia/Ho_Chi_Minh` timezone (`+07:00`). The report date is the day being reported, not necessarily the commit date: work completed during 22/08 may be recorded in the 23/08 report.
2. Inspect every commit selected for the report, including its message, body, changed files, and relevant diff. Do not describe functionality based only on the commit title.
3. Group related commits under one parent task instead of listing every commit as a separate task.
4. Describe each task with 2–4 concise bullets focused on user-facing outcomes or meaningful technical improvements.
5. Put the short commit hash or hashes after the task description.
6. Mention tests or build verification only when there is evidence that they were run successfully.
7. Clearly distinguish implemented work from documentation or future implementation plans.

## Where to record completed work

- Write completed daily entries in `docs/dev-log.md`, with the newest report date first.
- Track commits that have not been reported in `docs/dev-log-backlog.md`; do not mix the backlog table into the daily report file.
- After a commit is added to a daily report, remove the same hash from `docs/dev-log-backlog.md` in the same change.
- Add the entry after the task is complete and place the commit hash immediately after its description.
- Do not add a `Commit date` line; use the commit hash for traceability when needed.
- Keep `changelog.md` focused on logic changes; it is not the daily manager-facing report.

## Required format

```md
# [Agent Portal Dev Log] — DD/MM/YYYY

### 1. [Task name]

- [Main change or outcome]
- [Second meaningful change]

Commit: `abc1234`

### 2. [Task name]

- [Main change or outcome]
- [Second meaningful change]
- [Optional third change]

Commits: `abc1234`, `def5678`

Verification: [Include only verified build/test results.]
```

## Writing style

- Write in clear, professional Vietnamese suitable for sending directly to a manager.
- Keep enough detail to explain what was delivered, but avoid implementation-level details, error codes, file statistics, or long technical explanations unless specifically requested.
- Prefer task names such as “Nâng cấp CS Task Detail” over raw commit messages.
- Do not produce only a one-line summary or an ungrouped commit list.
