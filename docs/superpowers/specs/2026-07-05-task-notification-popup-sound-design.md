# Task Board — Always-on Popup + Sound for Notifications

Date: 2026-07-05
Branch: `main`
Status: Approved (delegated — user asked for design + implementation, no review round)

## Current state (already built, `NotificationBell.tsx`)

- In-app "Messenger-style" toast stack, top-right, 7s auto-dismiss — always
  fires on a new notification, regardless of focus.
- Native OS `Notification` popup — but **only** when `document.hidden` (tab
  not focused/visible). Permission requested once on mount if `default`.
- No sound anywhere.

## Ask

"Không chỉ có noti trong chuông mà còn pop up ra ngoài màn hình + có sound."
Read as: (a) the OS-level popup should not be gated on tab visibility — fire
it any time a new notification lands, so it's visible even if the user is in
another app/window; (b) add an audible cue.

**Out of scope (explicit call, revisit only if asked):** true Web Push (a
notification that arrives while the browser itself is fully closed) needs a
service worker, VAPID keys, and a push-subscription table — a much bigger
change than "make the existing popup fire more often." Not building it now.

## Decisions

- Drop the `document.hidden` gate on the native `Notification` call in
  `NotificationBell.tsx` — fire it for every fresh, unread notification the
  same way the toast does (still requires the OS permission the app already
  requests).
- Sound: synthesize a short two-tone chime with the Web Audio API
  (`OscillatorNode`) instead of shipping a binary asset — no new file, no
  license/attribution concerns, trivial to tweak. One helper,
  `playNotificationChime()` in a new `src/lib/tasks/sound.ts`, called once per
  `load()` cycle when `fresh.length > 0` (one chime per batch, not per item,
  so a burst of 5 notifications doesn't fire 5 overlapping tones).
- Respect the browser's autoplay policy: `AudioContext` must be created/resumed
  after a user gesture. First click anywhere in the app (existing `mousedown`
  listener pattern already in the bell) primes a shared `AudioContext`; if it's
  still suspended when a chime is due, skip the sound silently (no error, no
  retry) rather than throwing.
- No mute toggle in this pass (not requested); easy to add later per-user if
  it turns out noisy.

### Files
- `src/lib/tasks/sound.ts` (new) — `playNotificationChime()`, lazy shared
  `AudioContext`.
- `src/app/(authed)/_components/NotificationBell.tsx` — remove the
  `document.hidden` condition; call `playNotificationChime()` once when
  `fresh.length > 0`; prime the `AudioContext` on first pointerdown.

No schema change, no new API route.
