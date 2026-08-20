# Agent Portal Dev Log Reporting Guide

Use this guide whenever the user asks for an Agent Portal daily report, dev log, or a summary of commits for a specific date.

## How to prepare the report

1. Use the exact requested calendar date in the `Asia/Ho_Chi_Minh` timezone (`+07:00`). Do not include commits after midnight unless explicitly requested.
2. Inspect every commit in that date range, including its message, body, changed files, and relevant diff. Do not describe functionality based only on the commit title.
3. Group related commits under one parent task instead of listing every commit as a separate task.
4. Describe each task with 2–4 concise bullets focused on user-facing outcomes or meaningful technical improvements.
5. Put the short commit hash or hashes after the task description.
6. Mention tests or build verification only when there is evidence that they were run successfully.
7. Clearly distinguish implemented work from documentation or future implementation plans.

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
