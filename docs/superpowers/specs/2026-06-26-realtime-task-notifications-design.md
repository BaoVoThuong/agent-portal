# Realtime Task Notifications — Design

Date: 2026-06-26
Branch: `feat/task-board`
Status: Approved (design)

## Overview

Make task notifications appear **instantly** as a Messenger-style toast while an
agent has the app open (foreground or background tab), instead of only showing up
in the bell dropdown on the next 20s poll. Delivery uses **Supabase Realtime
Broadcast** as a content-free "ping": the server pings a per-user channel when a
notification is created, and the browser then fetches the actual content through
the existing NextAuth-guarded API.

## Goals

- New notifications pop a toast within ~1s while the app is open in any tab.
- All three notification types pop: `assigned`, `mentioned`, `commented`.
- Bell badge + dropdown list update at the same time.
- No regression to the privacy model (browser never reads tables directly).
- Graceful fallback to polling when realtime is unavailable or unconfigured.

## Non-goals

- Web Push / OS notifications when the app is fully closed (no service worker /
  VAPID). Native `Notification` while a tab is merely backgrounded is already
  handled by the bell and is out of scope for this change.
- Realtime for any data other than notifications.
- Changing how notifications are *created* (assignment/comment logic unchanged).

## Constraints (why Broadcast)

- Auth is **NextAuth**, not Supabase Auth → the browser has no Supabase user JWT,
  so RLS policies keyed on `auth.*` cannot identify the user.
- The app reaches Supabase **only via the service-role key on the server**; RLS is
  on with no anon policies, so the anon key cannot read tables.
- Deployed on **Vercel serverless** → long-lived server connections (SSE, a
  server-held Realtime subscription) are unreliable.

Broadcast sidesteps all three: the server pings statelessly over REST (service
key), the browser joins a public channel with the anon key (no table reads), and
the channel carries no content (so no RLS/JWT is needed).

## Architecture & data flow

1. A task event inserts notification rows server-side via `insertNotifications`
   (unchanged).
2. After a successful insert, the server calls `broadcastNotif(recipientEmails)`,
   which POSTs to the Supabase Realtime broadcast REST endpoint
   (`POST {SUPABASE_URL}/realtime/v1/api/broadcast`) with one message per distinct
   recipient: `{ topic: notifTopic(email), event: "new", payload: {} }`.
3. On mount the bell calls `GET /api/tasks/notifications` (NextAuth-guarded). The
   response now also includes the caller's `topic`.
4. The bell builds a browser Supabase **anon** client and subscribes to that
   topic's `"new"` broadcast event.
5. On a ping, the bell runs its existing `load()` → refetches notifications →
   dedups via `seenIds` → pops a toast for each fresh unread item (all types) and
   updates the badge/list. No content travels over the channel.
6. **Polling is kept** but relaxed to **60s** as a reconcile/safety net; realtime
   handles instant delivery.

## Components & interfaces

- `src/lib/tasks/realtime.ts` (server) — already sketched:
  - `notifTopic(email: string): string` — `"notif-" + HMAC_SHA256(email.lower,
    AUTH_SECRET).hex.slice(0,32)`. Deterministic, unguessable.
  - `broadcastNotif(recipientEmails: string[]): Promise<void>` — no-op if env
    missing or list empty; dedups recipients; best-effort POST wrapped in
    try/catch so it never breaks the calling request.
- `src/lib/tasks/notifications.ts` — `insertNotifications` awaits
  `broadcastNotif(rows.map(r => r.recipient_email))` after the DB insert succeeds.
- `src/app/api/tasks/notifications/route.ts` — GET response gains
  `topic: notifTopic(email)` alongside `notifications` and `unread`.
- `src/lib/supabase-browser.ts` (client) — `getBrowserSupabase(): SupabaseClient |
  null`, memoized; returns `null` when `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent.
- `src/app/(authed)/_components/NotificationBell.tsx` — store `topic` from
  `load()`; an effect subscribes to the broadcast when `topic` + browser client
  exist, calls `load()` on ping, and `removeChannel` on cleanup/topic change.
  Poll interval → 60s.

## Security

- Channel topic = `HMAC-SHA256(email, AUTH_SECRET)` → cannot be derived from an
  email alone (no existing env beyond `AUTH_SECRET`, which is already present).
- Broadcast payload is empty — only a "something changed" signal. All content is
  fetched through the NextAuth-guarded API as today.
- The anon key only authorizes joining the Realtime socket; RLS still denies any
  table read with it. No new RLS policy or minted JWT.

## Graceful degradation

- Missing `NEXT_PUBLIC_SUPABASE_ANON_KEY` or a socket failure → no subscription;
  the retained 60s polling still surfaces notifications. The feature activates
  automatically once the env vars are present. Nothing breaks before configuration.

## Prerequisites (user action)

- Add to `.env.local` and Vercel:
  - `NEXT_PUBLIC_SUPABASE_URL` (= existing `SUPABASE_URL`)
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase → Settings → API)
- No SQL / RLS changes. Broadcast works without enabling table replication.

## Testing

- Unit (`realtime.ts`):
  - `notifTopic` is deterministic for the same email and differs across emails;
    output is case-insensitive on the email.
  - `broadcastNotif` is a no-op when env is missing or the recipient list is
    empty. (Extract a pure `buildBroadcastMessages(emails)` helper to assert the
    message array shape without network I/O.)
- Existing `notifications.test.ts` (`resolveCommentRecipients`) stays green.
- Manual:
  - Assign a task to user B → user B's open tab shows a toast within ~1s; bell
    badge increments.
  - Remove the anon key → behavior falls back to polling (toast within ≤60s).
  - Two tabs of the same user each receive the toast (acceptable).

## Edge cases

- Broadcast best-effort: a failed ping never fails the PATCH/comment request.
- Dedup via `seenIds` prevents a double toast when both a ping and a poll land.
- `removeChannel` on unmount / topic change avoids leaked subscriptions.
- A notification for a task the recipient cannot view: toast still shows (key +
  title come from their own notification rows); clicking opens nothing if the task
  isn't in their list — already handled by the drawer's null-guard.

## Rollout

1. Land code with polling fallback intact (safe to deploy before env is set).
2. Add the two `NEXT_PUBLIC_*` env vars locally + on Vercel.
3. Verify realtime manually; polling remains as the safety net.
