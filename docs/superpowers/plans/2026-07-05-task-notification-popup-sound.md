# Plan — Always-on popup + sound for task notifications

Spec: `docs/superpowers/specs/2026-07-05-task-notification-popup-sound-design.md`

1. `src/lib/tasks/sound.ts` (new) — `playNotificationChime()`: lazily create
   a shared `AudioContext` on first call; two short `OscillatorNode` tones
   (e.g. 880Hz → 1175Hz, ~90ms each, quick gain-envelope so it doesn't click);
   if `AudioContext` is `suspended` (autoplay policy), try `resume()`, and if
   it's still not `running`, return without throwing.
2. `NotificationBell.tsx`:
   - Remove the `document.hidden` condition around the native `Notification`
     call in `load()` — fire it for every item in `fresh`, same loop that
     already pushes toasts.
   - Call `playNotificationChime()` once per `load()` invocation when
     `fresh.length > 0` (not once per item).
   - Add a one-time `pointerdown` listener (mount effect) that calls
     `getAudioContext().resume()` (or just calls `playNotificationChime`'s
     init path silently) to prime playback under the autoplay policy — reuse
     the existing `ref`/outside-click effect area for placement, no new DOM.
3. Manual check (dev server): trigger a notification (comment/mention/assign
   on another account) and confirm a toast, an OS popup, and a chime all fire
   even with the tab focused.
4. No automated test for audio (jsdom has no real `AudioContext`) — guard
   `playNotificationChime` to no-op if `AudioContext` is undefined so
   existing/future jsdom-based tests of `NotificationBell` don't crash.
5. `npm run typecheck`, `npm run build`.
6. Commit.
