<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Daily development reports

When the user asks for an Agent Portal daily dev log or a report based on commits, read and follow `docs/dev-log-reporting-guide.md`.

## Slack bot reads this schema

A separate private repo (`eps-slack-bot`) reads these tables directly with a read-only role: `portal_account` (id, email, name, is_active, agent_id, position_id, manager_id, created_at), `positions`, `roles`, `user_roles`, `role_permissions`, `permissions`, `agent_members`, `enrollment_option_sets`, `enrollment_options`, `table_column`, `table_column_option`, `slack_bot_users`. It also calls `POST /api/enrollment/import/dry-run`. When you rename or drop any of these columns, or change that route's request/response, update the bot too. Spec: `docs/superpowers/specs/2026-11-14-slack-support-bot-design.md`.
