# Comment Emoji and Reactions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two things the CS team asked for on comments — an emoji picker in the composer, and Slack-style emoji reactions on a posted comment.

**Architecture:** The picker is pure client work in the existing composer. Reactions add one table, atomic `PUT`/`DELETE` mutations, one lightweight authenticated canonical-read endpoint, and a reaction bar in `CommentItem`. The thread paints comments first and hydrates reactions through that endpoint after render, keeping reaction latency out of the task-detail critical path. Reactions broadcast a **content-free ping** on a dedicated shared topic — not customer data and not the task room's `changed` event, which triggers a full task-detail reload in every open drawer. Reactions create **no** notification and **no** activity row.

**Tech Stack:** Next.js 16.2.4 App Router, React client components, Supabase/PostgREST, Tailwind v4, vitest 2.1.9.

## Revision note

This is the post-implementation revision. A final runtime review replaced raw reaction payloads with authenticated canonical reads, moved validation/write/read into an atomic RPC, normalized email identity, and serialized optimistic writes per comment. Those corrections close races that static typechecks and the original helper tests could not detect.

## Scope

**In:** an emoji picker button in the comment composer; add/remove emoji reactions on comments in the **CS task drawer only**.

**Out — decisions, not omissions:**

- **In-app GIF/meme search** (Slack's `/giphy`). Needs an external API key, sends browser requests to a third party from a tool holding customer PII, and its content filters are not reliable enough for something attached to a customer file. Largely redundant too: `gif`, `png`, `jpg`, `jpeg` and `webp` are already accepted attachment types (`src/lib/tasks/attachments.ts:3-15`), so a meme can be attached to a comment today.
- **Reactions in Enrollment.** `CommentThread` is shared — `EnrollmentClient.tsx:86` imports it and `:3192` renders it with `apiBase="/api/enrollment"`. Enrollment has no reactions table, no reactions route, and uses `enrollmentRoomTopic` rather than `taskRoomTopic`. Reactions are therefore gated behind an explicit off-by-default prop. Mirroring them into Enrollment is a follow-up plan.
- **The edit-comment box.** `EditCommentForm` (`CommentThread.tsx:1754-1990`) is a separate component with no `caretRef` — its own `pick()` at `:1837-1863` uses `setTimeout` + `setSelectionRange`. The Task 1 snippet will not compile there. Composer-only is deliberate.

**Already possible with no code at all**, worth telling the team first: `task_comments.body` is `text`, so typed Unicode emoji already save and render. The OS picker is `⌃⌘Space` on macOS, `Win + .` on Windows. Task 1 only removes the need to leave the keyboard.

## Global Constraints

- **UI copy is English only.** Code comments may stay Vietnamese; anything a user reads may not.
- **Test harness cannot render components.** `vitest.config.ts:12-16` is `environment: "node"`, `include: ["src/**/*.test.ts"]` — no jsdom, `.tsx` not collected. Every test step targets a plain `.ts` module. Do not plan component tests; they will not run.
- **Reactions must never notify.** No `insertNotifications`, no `resolveCommentRecipients`, no `task_activity` row. This is the reason the feature is worth building — see below — and it is the thing most likely to be "fixed" later by someone who thinks it was an oversight. Say so in the route file.
- **No new npm dependency.** No emoji library exists in `package.json` and this plan does not add one. `lucide-react@^1.16.0` already ships the `Smile` icon.
- **`changelog.md` gets an entry** covering Tasks 2-4.
- **Do not commit or push without being asked.** Each is a separate request and the remote must be named: `origin` is BaoVoThuong/agent-portal, `vercel` is the separate repo eps-portal.vercel.app deploys from.

## Why reactions reduce noise rather than adding to it

Acknowledging a comment today means writing "ok" or "đã nhận". Each such comment runs `resolveCommentRecipients` (`src/lib/tasks/notifications.ts:40-77`), which fans out to mentions, assignees, participants, the reporter and the agent.

**Source of the numbers:** a production snapshot taken 2026-08-18 against the live Supabase project via PostgREST — 529 `task_notifications` rows, of which 357 (67%) were type `commented`, across 24 tasks with 165 comments, i.e. ~2.2 notifications per comment. These figures **cannot be reproduced from this repository**; treat them as a dated measurement, and re-run the count before quoting them as current.

A 👍 replaces that comment with zero notifications. That is the whole argument, and it only holds if the no-notification rule is absolute.

## Verified starting state

Re-checked at `e87f3e7`. The first draft had four wrong citations here; these are correct.

| Thing | Where |
|---|---|
| `task_comments` — the eight base columns, **plus `client_request_id uuid`** added separately | `supabase/schema.sql:1943-1953` and `:1956` |
| No reactions or emoji table exists anywhere | grep of `supabase/schema.sql` and `src/` |
| `COMMENT_COLUMNS` (value as quoted in the first draft, line was wrong) | `src/lib/tasks/detail.ts:62-63` |
| Composer toolbar — **three** buttons: Attach, Cancel, Send | `CommentThread.tsx:2336` (row), Attach at `:2349-2357` |
| Composer textarea | `CommentThread.tsx:2270` |
| `pick()` — the mention-insert function Task 1 mirrors | `CommentThread.tsx:2106-2130` |
| Caret-restore effect — **no dependency array**, runs every render, guards on `caretRef.current != null` | `CommentThread.tsx:2029-2036` |
| `CommentItem` | `CommentThread.tsx:1327` |
| Real comment-route authorization — `loadActorAndTask` + `canViewResolved` | `src/app/api/tasks/[id]/comments/route.ts:27-74` |
| Standalone version of the same check, easier to copy | `src/app/api/tasks/[id]/comments/[cid]/edits/route.ts:17-67` |
| Soft delete — sets `deleted_at` and blanks `body`; **no row is ever deleted** | `supabase/schema.sql:2534-2536` |
| RLS applied by a central `protected_tables` loop, not per-table grants in `schema.sql` | `supabase/schema.sql:5489-5548`, documented at `:4536` |
| `useAnchoredMenu` — positioning, Escape, outside-click only; no roles, no roving focus | `src/app/(authed)/tasks/_components/use-anchored-menu.ts:19-127` |

---

### Task 1: Emoji picker in the composer

**Files:**
- Create: `src/lib/tasks/emoji.ts`
- Test: `src/lib/tasks/emoji.test.ts`
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx` — `Composer` only

**Interfaces:**
- Produces: `QUICK_EMOJI: readonly string[]`, `insertAtCaret()`. Tasks 3 and 4 reuse `QUICK_EMOJI`.

**The trap in this file.** The composer shares one textarea with the `@mention` system: `textRef` (`:2014`), `caretRef` (`:2024`), `draftMentions` (`:2018`), `activeMentionRef`, `mentionPosition` (`:2020`), and `rebaseMentions(previousText, nextText, mentions)` (`src/lib/tasks/mention-draft.ts:96-125`), which diffs by common prefix/suffix and shifts stored offsets. `encodeMentions` then **silently drops** any mention whose slice no longer reads `@label`. So inserting an emoji before an existing mention without rebasing does not throw — it posts the comment with the tag missing or pointing at the wrong text.

`pick()` at `:2106-2130` is the complete correct sequence. Note its last four lines:

```tsx
    caretRef.current = start + token.length;
    activeMentionRef.current = null;
    setQuery(null);
    setMentionPosition(null);
```

**Those last three are not optional.** If the @-menu is open (rendered at `:2290-2298` when `query !== null && mentionPosition`) and the user inserts an emoji, leaving that state alive means `activeMentionRef.current` still holds pre-insert `{start, end}`, and the next `pick()` splices at stale offsets and corrupts the body.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/emoji.test.ts
import { describe, expect, it } from "vitest";
import { insertAtCaret, QUICK_EMOJI } from "./emoji";

describe("QUICK_EMOJI", () => {
  it("offers a small, duplicate-free shortlist", () => {
    expect(QUICK_EMOJI.length).toBeGreaterThan(0);
    expect(new Set(QUICK_EMOJI).size).toBe(QUICK_EMOJI.length);
  });

  it("contains no variation selectors", () => {
    // U+FE0F survives a round trip through some clients and not others. An
    // emoji that arrives without it fails the server allowlist and 400s.
    for (const emoji of QUICK_EMOJI) expect(emoji).not.toContain("️");
  });
});

describe("insertAtCaret", () => {
  it("inserts at the caret and reports the new caret", () => {
    // "👍" is 2 UTF-16 code units.
    expect(insertAtCaret("hello world", 5, "👍")).toEqual({
      text: "hello👍 world",
      caret: 7,
    });
  });

  it("appends when the caret sits at the end", () => {
    expect(insertAtCaret("ok", 2, "🎉")).toEqual({ text: "ok🎉", caret: 4 });
  });

  it("replaces a selection rather than splitting it", () => {
    expect(insertAtCaret("hello world", 0, "👋", 5)).toEqual({
      text: "👋 world",
      caret: 2,
    });
  });

  it("clamps a caret past the end", () => {
    // "✅" is U+2705 — ONE code unit, unlike the emoji above.
    expect(insertAtCaret("hi", 99, "✅")).toEqual({ text: "hi✅", caret: 3 });
  });

  it("clamps a negative caret", () => {
    expect(insertAtCaret("hi", -3, "✅")).toEqual({ text: "✅hi", caret: 1 });
  });

  it("measures the caret in UTF-16 code units, not code points", () => {
    // selectionStart counts code units; measuring in code points would land
    // the caret inside a surrogate pair.
    expect(insertAtCaret("", 0, "👍").caret).toBe(2);
    expect(insertAtCaret("", 0, "✅").caret).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/tasks/emoji.test.ts`
Expected: FAIL — `Failed to resolve import "./emoji"`.

- [ ] **Step 3: Implement**

```ts
// src/lib/tasks/emoji.ts

/**
 * Deliberately short and hard-coded: a full set means a new dependency and a
 * search index for a feature whose job is to save a keyboard shortcut. Typed
 * Unicode emoji already work — task_comments.body is plain text.
 *
 * The type is `readonly string[]`, NOT `as const`. A const-asserted literal
 * tuple makes `QUICK_EMOJI.includes(someString)` a TS2345 error, and the
 * server route in Task 4 validates exactly that way.
 *
 * No emoji here carries U+FE0F. Variation selectors survive some clients and
 * not others, so an allowlist keyed on the composed form rejects what a user
 * actually sent.
 */
export const QUICK_EMOJI: readonly string[] = [
  "👍", "🙏", "✅", "🎉", "🔥", "👀", "💯", "😄",
  "😅", "😍", "🤔", "😭", "🚀", "👏", "🙌", "😊",
];

/**
 * Caret offsets come from textarea.selectionStart, which counts UTF-16 code
 * units. String indexes and .length are in the same unit, so they agree;
 * anything code-point-based would not.
 *
 * A textarea always reports selectionStart <= selectionEnd (direction lives in
 * selectionDirection), but the clamp handles a reversed pair anyway.
 */
export function insertAtCaret(
  text: string,
  caret: number,
  insertion: string,
  selectionEnd?: number,
): { text: string; caret: number } {
  const start = Math.min(Math.max(0, caret), text.length);
  const end = Math.min(Math.max(start, selectionEnd ?? start), text.length);
  return {
    text: text.slice(0, start) + insertion + text.slice(end),
    caret: start + insertion.length,
  };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/lib/tasks/emoji.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Wire the button into `Composer`**

Add a `Smile` button beside Attach at `:2349`. Give the popover its **own** `useAnchoredMenu()` instance — the file already uses that hook for the comment overflow menu, and sharing one instance would make the two menus fight over `isOpen`.

```tsx
  function insertEmoji(emoji: string) {
    const el = taRef.current;
    const currentText = el?.value ?? text;
    const caret = el?.selectionStart ?? currentText.length;
    const selectionEnd = el?.selectionEnd ?? caret;
    const { text: next, caret: nextCaret } = insertAtCaret(
      currentText,
      caret,
      emoji,
      selectionEnd,
    );
    // Mention offsets are absolute; inserting before one shifts it, and
    // encodeMentions drops any mention whose slice no longer matches.
    setDraftMentions(rebaseMentions(currentText, next, draftMentions));
    setText(next);
    textRef.current = next;
    caretRef.current = nextCaret;
    // Same teardown pick() does. Without it, an open @-menu keeps stale
    // offsets and the next pick() splices at the wrong place.
    activeMentionRef.current = null;
    setQuery(null);
    setMentionPosition(null);
    emojiMenu.setIsOpen(false);
  }
```

The caret-restore effect at `:2029-2036` has no dependency array — it runs after every render and acts whenever `caretRef.current != null`. Setting `caretRef.current` is therefore enough; do not add a `setTimeout`.

- [ ] **Step 6: Accessibility**

The trigger needs `aria-haspopup="dialog"`, `aria-expanded`, and a real label ("Insert emoji") — an icon-only button announces as nothing. Each emoji button needs an `aria-label` naming it, since a screen reader otherwise reads the raw Unicode name or skips it. `useAnchoredMenu` gives Escape and outside-click; it does **not** give roving arrow-key focus, and that is acceptable for a 16-item grid as long as every item is tab-reachable.

- [ ] **Step 7: Verify by hand**

`npm run dev`, open a task:
1. Type `hello world`, caret after `hello`, insert 👍 — lands mid-text, caret after it, typing continues cleanly.
2. Type `@Someone hi`, caret at position **0**, insert 🎉, post. **The mention must still resolve to the same person.** This is what breaks without `rebaseMentions`, and it is the step most likely to be skipped.
3. Type `@Some` so the mention menu is open, then insert an emoji, then finish picking a person from the menu. **The body must not be mangled** — this is the `activeMentionRef` reset.
4. Select a word, pick an emoji — the selection is replaced.
5. Post an emoji comment and reload — it renders.

- [ ] **Step 8: Commit**

```bash
git add src/lib/tasks/emoji.ts src/lib/tasks/emoji.test.ts \
        "src/app/(authed)/tasks/_components/CommentThread.tsx"
git commit -m "feat(comments): add an emoji picker to the composer"
```

---

### Task 2: Reactions table and soft-delete cleanup

**Files:**
- Create: `supabase/rollouts/2026-08-20-comment-reactions.sql`
- Create: `supabase/rollouts/2026-08-20-comment-reactions-test.sql`
- Modify: `supabase/schema.sql` — table DDL near `task_comments`, `protected_tables` array at `:5489`, and `delete_task_comment_atomic` at `:2500`

**No `task_id` column.** The first draft had one, justified as "fetch every reaction on a task in one query" — but the loader queries by the comment ids it just fetched, so it is never used, and an independent FK to `tasks` cannot prove the reaction's comment actually belongs to that task. Two sources of truth for one relationship, one of them unenforceable. The unique index already leads with `comment_id`, so a separate `comment_id` index would also be redundant.

**Soft delete means `on delete cascade` never fires.** `delete_task_comment_atomic` does `update task_comments set deleted_at = v_now, body = ''` (`schema.sql:2534-2536`). The FK stays intact and reaction rows survive forever. They are invisible — `loadComments` filters `.is("deleted_at", null)` (`detail.ts:117`) — which is exactly why this leak would go unnoticed.

- [ ] **Step 1: Write the rollout**

```sql
-- supabase/rollouts/2026-08-20-comment-reactions.sql
-- Emoji reactions on task comments. Idempotent; safe to re-run.

create table if not exists public.task_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.task_comments(id) on delete cascade,
  reactor_email text not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  -- One reaction per person per emoji per comment. PUT relies on this via
  -- `on conflict do nothing`, which is what makes the add idempotent.
  unique (comment_id, reactor_email, emoji)
);
-- No separate comment_id index: the unique index above already leads with it.

alter table public.task_comment_reactions enable row level security;
revoke all on table public.task_comment_reactions
  from public, anon, authenticated;
grant all on table public.task_comment_reactions to service_role;

-- Soft delete leaves the comment row in place, so the cascade never runs.
-- Clean reactions up inside the same transaction that retires the comment.
create or replace function delete_task_comment_atomic(
  -- COPY THE EXISTING SIGNATURE VERBATIM from supabase/schema.sql:2500.
  -- Do not retype it from memory; a changed signature creates a second
  -- overload and the app keeps calling the old one.
) returns ... language plpgsql security definer set search_path = public as $$
begin
  -- ... existing body unchanged, and immediately after the row is retired:
  delete from public.task_comment_reactions where comment_id = p_comment_id;
  -- ... rest of the existing body unchanged.
end;
$$;
```

**Read `delete_task_comment_atomic` in full before editing it.** It also blanks `body`, touches the parent, and returns a specific shape. Preserve all of it; add one `delete` statement.

- [ ] **Step 2: Write the rollout test**

Most dated rollouts here have a `-test.sql` companion (`2026-08-11-sheet-sync-atomic-test.sql`, `2026-08-13-aca-overview-schema-test.sql`). Existence checks alone would not have caught the soft-delete leak.

```sql
-- supabase/rollouts/2026-08-20-comment-reactions-test.sql
-- Read-only-ish: creates a scratch task and comment, then removes them.
-- Supabase Studio does not display `raise notice`, so results come back as a
-- table. Expected: 4 rows, ok = true.
```

Cover four things: the table exists; a duplicate `(comment_id, reactor_email, emoji)` insert violates the unique constraint; a second insert with `on conflict do nothing` is a no-op rather than an error; and **soft-deleting a comment with reactions leaves zero reaction rows behind**.

- [ ] **Step 3: Mirror into `schema.sql`**

Add the table DDL after the `task_comments` block, apply the same `delete_task_comment_atomic` change, and add `'task_comment_reactions'` to the `protected_tables` array at `:5489-5539`.

**Do not copy the `revoke`/`grant` statements into `schema.sql`.** That file contains no per-table grants anywhere; RLS is applied centrally by the loop at `:5489-5548`, documented at `:4536`. The first draft claimed the sheet-sync tables as precedent — they were never mirrored into `schema.sql` at all, so there is no precedent to follow.

- [ ] **Step 4: Run both files in Supabase Studio**

Rollout first, then the test. Expected: 4 rows, `ok` all `true`.

---

### Task 3: Grouping logic and lazy reaction hydration

**Files:**
- Create: `src/lib/tasks/reactions.ts`
- Test: `src/lib/tasks/reactions.test.ts`
- Modify: `src/lib/tasks/detail.ts` — `CommentWithAttachments`
- Modify: `src/lib/tasks/detail-cache.ts`
- Test: `src/lib/tasks/detail-cache.test.ts`

**Grouping happens on the client, not the server.** `reactedByMe` is viewer-specific, and `detail-cache` is a shared in-memory cache — putting a per-viewer flag in it means whoever fetched first decides what everyone sees. `currentEmail` is already a `CommentThread` prop (`:385`) and a `CommentItem` prop (`:1331`), so the canonical endpoint returns raw rows and the component groups them. This also needs no `currentEmail` threading through `loadTaskDetail`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/reactions.test.ts
import { describe, expect, it } from "vitest";
import { groupReactions } from "./reactions";

const rows = [
  { comment_id: "c1", emoji: "🎉", reactor_email: "b@x.com" },
  { comment_id: "c1", emoji: "👍", reactor_email: "a@x.com" },
  { comment_id: "c1", emoji: "👍", reactor_email: "b@x.com" },
  { comment_id: "c2", emoji: "👍", reactor_email: "b@x.com" },
];

describe("groupReactions", () => {
  it("groups by comment then emoji with counts", () => {
    const grouped = groupReactions(rows, "a@x.com");
    expect(grouped.get("c1")).toEqual([
      { emoji: "👍", count: 2, reactedByMe: true, reactors: ["a@x.com", "b@x.com"] },
      { emoji: "🎉", count: 1, reactedByMe: false, reactors: ["b@x.com"] },
    ]);
  });

  it("marks reactedByMe case-insensitively", () => {
    expect(groupReactions(rows, "A@X.COM").get("c1")?.[0].reactedByMe).toBe(true);
  });

  it("keeps comments separate", () => {
    expect(groupReactions(rows, "b@x.com").get("c2")).toEqual([
      { emoji: "👍", count: 1, reactedByMe: true, reactors: ["b@x.com"] },
    ]);
  });

  it("breaks count ties by QUICK_EMOJI order, not row order", () => {
    // Row order out of PostgREST is not guaranteed stable across fetches, so
    // a tie broken by insertion order lets the bar reshuffle under the cursor.
    const tied = [
      { comment_id: "c1", emoji: "🎉", reactor_email: "a@x.com" },
      { comment_id: "c1", emoji: "👍", reactor_email: "b@x.com" },
    ];
    expect(groupReactions(tied, "").get("c1")?.map((g) => g.emoji)).toEqual([
      "👍",
      "🎉",
    ]);
  });

  it("sorts higher counts first regardless of QUICK_EMOJI order", () => {
    const weighted = [
      { comment_id: "c1", emoji: "🎉", reactor_email: "a@x.com" },
      { comment_id: "c1", emoji: "🎉", reactor_email: "b@x.com" },
      { comment_id: "c1", emoji: "👍", reactor_email: "c@x.com" },
    ];
    expect(groupReactions(weighted, "").get("c1")?.map((g) => g.emoji)).toEqual([
      "🎉",
      "👍",
    ]);
  });

  it("tolerates an empty viewer email", () => {
    expect(groupReactions(rows, "").get("c1")?.[0].reactedByMe).toBe(false);
  });

  it("returns an empty map for no rows", () => {
    expect(groupReactions([], "a@x.com").size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/tasks/reactions.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Implement**

```ts
// src/lib/tasks/reactions.ts
import { QUICK_EMOJI } from "./emoji";

export type ReactionRow = {
  comment_id: string;
  emoji: string;
  reactor_email: string;
};

export type ReactionGroup = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  /** Raw emails. Render through nameOf() — never show these directly. */
  reactors: string[];
};

const EMOJI_ORDER = new Map(QUICK_EMOJI.map((emoji, index) => [emoji, index]));

export function groupReactions(
  rows: readonly ReactionRow[],
  currentEmail: string | null | undefined,
): Map<string, ReactionGroup[]> {
  const me = (currentEmail ?? "").trim().toLowerCase();
  const byComment = new Map<string, Map<string, ReactionGroup>>();
  for (const row of rows) {
    const byEmoji = byComment.get(row.comment_id) ?? new Map();
    byComment.set(row.comment_id, byEmoji);
    const group = byEmoji.get(row.emoji) ?? {
      emoji: row.emoji,
      count: 0,
      reactedByMe: false,
      reactors: [],
    };
    group.count += 1;
    group.reactors.push(row.reactor_email);
    if (me && row.reactor_email.trim().toLowerCase() === me) {
      group.reactedByMe = true;
    }
    byEmoji.set(row.emoji, group);
  }
  const out = new Map<string, ReactionGroup[]>();
  for (const [commentId, byEmoji] of byComment) {
    out.set(
      commentId,
      [...byEmoji.values()].sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        // Ties resolve by the fixed picker order. Relying on insertion order
        // would inherit PostgREST's row order, which is not stable.
        return (
          (EMOJI_ORDER.get(a.emoji) ?? Number.MAX_SAFE_INTEGER) -
          (EMOJI_ORDER.get(b.emoji) ?? Number.MAX_SAFE_INTEGER)
        );
      }),
    );
  }
  return out;
}
```

`reactors` order still follows the query, so give the query an explicit `.order("created_at", { ascending: true })` in Step 5.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/lib/tasks/reactions.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Keep reactions out of `loadComments`**

Make the field **optional** on `CommentWithAttachments` (`detail.ts:23-27`):

```ts
  reactions?: ReactionRow[];
```

A required field breaks `groupCommentAttachments`'s return, the `includeAttachments === false` return, the `Comment` type, and every optimistic row built in `post()`.

Do **not** query `task_comment_reactions` from `loadComments`. A read-only production benchmark on a task with 34 active comments measured comments at p95 464ms with the inline reaction query versus 363ms without it. Median impact was small because files and reactions ran in parallel, but the slower branch still controlled the tail and kept the entire comment skeleton visible.

After comments paint, `CommentThread` fetches `/api/tasks/{id}/comment-reactions` and applies the canonical rows. The same endpoint handles realtime pings. Patch reaction rows into an existing warm detail cache instead of invalidating the whole entry; keep its original `storedAt` so a reaction refresh cannot make task fields or signed URLs look newly fresh.

- [ ] **Step 6: Test cache patching**

Cover both a whole-task canonical snapshot and a single-comment mutation response. The task snapshot must clear reactions for cached comments omitted from the response, the single-comment patch must leave every other comment unchanged, and neither helper may refresh the cache age.

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit && npx vitest run
```
Expected: clean; suite grows by 15.

---

### Task 4: Route, realtime and UI

**Files:**
- Create: `src/app/api/tasks/[id]/comments/[cid]/reactions/route.ts`
- Create: `src/app/api/tasks/[id]/comment-reactions/route.ts`
- Create: `src/lib/tasks/reaction-access.ts`
- Modify: `src/lib/tasks/detail-cache.ts` — preserve warm detail while reactions change
- Test: `src/lib/tasks/detail-cache.test.ts`
- Modify: `src/lib/tasks/realtime.ts` — a reaction broadcast helper
- Modify: `src/lib/tasks/realtime-topics.ts` — the shared server/browser topic
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx` — `CommentItem`, the room handler, a new `reactionsEnabled` prop
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` — pass `reactionsEnabled`

- [ ] **Step 1: `PUT` to add, `DELETE` to remove — not a toggle**

A toggling `POST` is race-prone and non-idempotent. Keep explicit idempotent `PUT` and `DELETE`, but execute both through `set_task_comment_reaction_atomic`: it locks the active comment, mutates the row, and returns the canonical snapshot in one transaction. This is required because a separate “comment exists” read followed by an insert can race a soft-delete and create a reaction after deletion.

Both verbs:
- **Authorize with the full existing rule set.** Copy `loadActorAndTask` + `canViewResolved` from `src/app/api/tasks/[id]/comments/route.ts:27-74`, or the standalone version at `[cid]/edits/route.ts:17-67`. It is not just `canViewTask` — it also runs `actorSeesAllTasks`, `isTaskParticipant`, `isTaskAssignee` and `fetchAgentsForCs`. The first draft cited lines 1-16, which are imports; copying those literally yields a route with **no** authorization.
- Validate `emoji` against `QUICK_EMOJI`. Never accept arbitrary strings — this renders into everyone's thread.
- The atomic RPC verifies that the comment belongs to `params.id`, locks it, and rejects soft-deleted comments. Do not reintroduce a check-then-write gap in the route.
- **Return the canonical `ReactionRow[]` for that comment.** This is what lets the client settle without waiting for a broadcast, and it removes most of the optimistic-state problem in Step 4.
- Broadcast as a **non-critical side effect** through `settleSideEffects`, exactly as the comment routes do. A failed broadcast is a warning, never a 500 — the write already committed.
- **No notification, no activity row.** Write that in the file as a comment with the reason.

- [ ] **Step 2: A dedicated realtime event**

Do **not** reuse the task room's `changed` event. `TaskDetailDrawer.tsx:286-289` responds to `changed` by scheduling `reload("realtime")`, which refetches the entire detail — up to 1000 comments, every attachment re-signed, activity, metadata. One emoji tap would cost that for every viewer, including the tapper: unlike `broadcastTasksChanged`, the room topic carries no source id, so the self-echo suppression at `:243-249` does not apply.

Use the shared `taskReactionTopic(id)` helper on both server and browser and broadcast `{ event: "reaction", payload: {} }`. Task topics are predictable public channels, so never place comment ids, reaction rows, or reactor emails in the payload.

In `CommentThread`, fetch `/api/tasks/{id}/comment-reactions` after the initial comment paint, then debounce later realtime pings through the same path. That endpoint repeats the full task-view authorization and calls `task_comment_reactions_for_task`; it is much lighter than the full detail route and keeps the public channel content-free.

- [ ] **Step 3: Gate it behind `reactionsEnabled`**

Add `reactionsEnabled?: boolean` to `CommentThread`, defaulting **false**. Only `TaskDetailDrawer` passes it. `EnrollmentClient.tsx:3192` passes nothing and keeps today's behaviour — no bar, no `+`, no reaction fetch, no 404s against a route that does not exist for `/api/enrollment`.

- [ ] **Step 4: The reaction bar**

In `CommentItem` (`:1327`), under the body: pills of emoji + count, tinted when `reactedByMe`, plus a `+` opening the `QUICK_EMOJI` popover from Task 1.

**Optimistic state must reconcile.** `CommentItem` is keyed by `c.id` (`:1051`), so component-local state survives the prop update a reload produces and would keep overriding server truth until unmount. Two rules:
- Merge the canonical rows the route returns (Step 1) as soon as they arrive — that is the primary settle path, not the broadcast.
- Reset pending state when `c.reactions` changes identity, so a broadcast or reload wins over a stale local guess.

Sequence rapid clicks per comment, not per `(commentId, emoji)`, because every response contains the whole comment snapshot. Use a monotonic version to ignore stale responses, preserve optimistic rows while local writes are pending, and reconcile canonically after the queue drains. Canonical refresh is the rollback path; restoring an old local snapshot can resurrect a different failed reaction.

**Accessibility:** each pill is a `button` with `aria-pressed={reactedByMe}` and a text label ("React with 👍, 2 people") — an emoji-only button announces as a Unicode name or nothing. The `+` needs `aria-haspopup` and `aria-expanded`. Render `reactors` through the `nameOf` prop (`:1333`, passed at `:1057`), never as raw emails; display names are the convention everywhere else (`detail.ts:175-178`, `edits/route.ts:76-81`).

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit && npx vitest run && npm run build
```
Expected: all clean.

By hand, two browsers signed in as different agents, with the Network panel open:

1. A reacts 👍; B sees it appear without reloading.
2. B also reacts 👍 — count reads 2, pill tinted for both.
3. A clicks 👍 again — count drops to 1, tint clears for A only.
4. **No new notification in either bell.** The premise of the feature.
5. **No `GET /api/tasks/{id}/detail` fires on any tap** — not for the tapper, not for the observer. This is what the dedicated event buys; reusing `changed` silently undoes it. Closing and reopening the same task after a reaction must also reuse the warm detail cache; a reaction mutation must not evict it.
6. Double-click 👍 fast, and click add/remove/add rapidly — the final state matches the last click and no request 500s.
7. Retry a `PUT` after killing the response (throttle to offline mid-request, restore) — the reaction is added once, not toggled off.
8. Soft-delete a comment that has reactions, then query `task_comment_reactions` — **zero rows remain**.
9. Open an ACA enrollment record — comments work exactly as before, **no reaction UI at all**.
10. Post a comment with an emoji from Task 1 in the same session — the picker and the bar do not interfere.

- [ ] **Step 6: Changelog**

```markdown
## 2026-08-20 — Emoji cho comment: nút chọn emoji và thả cảm xúc
- **Loại**: feature
- **Cái gì**: Ô nhập comment (chỉ ô soạn mới, không phải ô sửa) có nút chọn emoji với danh sách 16 emoji cố định. Comment trong Task drawer có thanh thả cảm xúc kiểu Slack: `PUT` để thêm, `DELETE` để bỏ, mỗi người một emoji một lần. Bảng mới `task_comment_reactions` ràng buộc duy nhất `(comment_id, reactor_email, emoji)`. `delete_task_comment_atomic` được mở rộng để xoá reaction khi comment bị xoá mềm.
- **Vì sao**: Team yêu cầu. Thả cảm xúc còn nhằm CẮT ồn: đo ngày 2026-08-18 trên production có 529 thông báo, 67% là `commented`, trung bình 2,2 thông báo mỗi comment — phần lớn là những câu "ok"/"đã nhận". Thả 👍 thay câu đó thì không bắn thông báo nào.
- **File**: `supabase/rollouts/2026-08-20-comment-reactions.sql` (+ `-test.sql`), `supabase/schema.sql`, `src/lib/tasks/emoji.ts`, `src/lib/tasks/reactions.ts`, `src/lib/tasks/reaction-access.ts`, hai reaction API routes, `src/lib/tasks/realtime.ts`, `src/lib/tasks/realtime-topics.ts`, `src/lib/tasks/detail.ts`, `CommentThread.tsx`, `TaskDetailDrawer.tsx`
- **Ảnh hưởng**: Reaction TUYỆT ĐỐI không tạo thông báo và không ghi activity — đó là lý do tồn tại của tính năng, đừng "sửa" lại sau. Dùng ping realtime RIÊNG, payload rỗng, rồi đọc canonical qua API có auth; không dùng `changed` vì nó tải lại toàn bộ detail và ký lại URL đính kèm. Mutation chạy atomic với soft-delete, email được normalize, và client serialize theo comment để click nhanh không ghi đè nhau. `CommentThread` dùng chung với Enrollment nên reaction bị khoá sau prop `reactionsEnabled` mặc định tắt; Enrollment giữ nguyên hành vi cũ.
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/tasks/reactions.ts src/lib/tasks/reactions.test.ts \
        "src/app/api/tasks/[id]/comments/[cid]/reactions/route.ts" \
        src/lib/tasks/realtime.ts src/lib/tasks/detail.ts src/lib/tasks/detail.test.ts \
        "src/app/(authed)/tasks/_components/CommentThread.tsx" \
        "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx" \
        supabase/schema.sql supabase/rollouts/2026-08-20-comment-reactions*.sql changelog.md
git commit -m "feat(comments): add emoji reactions"
```

---

## Sequencing

Task 1 ships alone, needs no database change, and may be all the team actually wanted. Tasks 2-4 are one unit — do not ship the UI before the rollout has run.

**Related outstanding work:** the three defects in `2026-08-20-live-sync-fixes.md` were largely fixed in `308be82`. `boardInvalidationSourceId` and `resolveNotificationInvalidation` are in, and the dead drawer reset is gone. **The `tasksOnly` split is not** — `reconcileTaskData` still calls `reloadCategories()` on every task-scoped invalidation, so each task edit still reloads config that cannot have changed. Small, and independent of this plan.

---

## What the first draft got wrong

Kept so a reader who saw it is not left guessing.

**Two tests were arithmetically wrong.** `"✅"` is U+2705, **one** UTF-16 code unit, not two. `insertAtCaret("hi", 99, "✅")` returns `caret: 3` and the draft expected `4`; the negative-caret case expected `2` and returns `1`. TDD against those would have "fixed" the implementation into breaking the caret for every single-unit emoji.

**Five structural problems, all found independently by both reviewers:**
- Reusing the room `changed` event → a full detail reload per tap, for everyone
- `CommentThread` is shared with Enrollment → reaction UI would 404 there
- Soft delete means `on delete cascade` never runs → reaction rows leak forever
- `insertEmoji` omitted `pick()`'s mention-popover reset → corrupted bodies
- Toggling `POST` → unique-constraint 500 on concurrent taps, and a retry undoes the add

**Also corrected:** `QUICK_EMOJI as const` made the server's `.includes(emoji)` a TS2345 error; `reactions` had to be optional or four call sites stop compiling; `task_id` was redundant and unenforceable; `schema.sql` uses a central `protected_tables` loop rather than per-table grants; and the citations for `COMMENT_COLUMNS`, the auth block, `pick()`'s range, the toolbar button count and the caret-restore effect were all wrong. An intermediate implementation put the reaction query in `loadComments`; the latency benchmark above superseded that design with post-render hydration.

**Left as-is:** the notification statistics, now labelled as a dated production snapshot rather than dropped. They are real measurements, just not reproducible from the repo.
