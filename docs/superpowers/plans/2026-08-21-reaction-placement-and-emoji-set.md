# Reaction Placement and a Full Emoji Set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the reaction UI and give both comment reactions and the composer a searchable Slack-style full emoji picker that opens above-right of its trigger without covering the active text.

## [[codex]] Review and decisions — 2026-08-21

- **[[codex]] Regex instead of an allowlist: no.** A regex can identify emoji-looking
  code points, but it cannot safely express the exact supported RGI sequences,
  variation selectors, and ZWJ combinations. It would also accept symbols or
  sequences that the picker does not ship. Keep the generated dataset as the
  source of truth and validate with a module-level `Set`; normalization happens
  before `Set.has()`.
- **[[codex]] `unicode-emoji-json` as the generated-data source: yes.** Use its
  RGI dataset for the canonical character, name, group, and ordering. It
  consolidates skin-tone support into the base entry, which matches this plan's
  scope. It does not provide the broad search keyword set itself, so add the
  dev-only `emojilib` keyword data during generation; never add either package
  to the runtime bundle.
- **[[codex]] Database length guard: keep it as defense in depth.** The route's
  exact `Set` check is the product allowlist; the RPC's `char_length <= 16`
  remains a cheap database invariant and must be verified against the generated
  output before shipping. If the generated set contains a longer RGI sequence,
  the plan must resolve that mismatch before the UI is enabled.

**Architecture:** Task 1 keeps the existing reaction UI while using the shared searchable picker. Task 2 adds a generated, checked-in dataset for both the composer and reaction picker, while the server swaps its `Array.includes` allowlist for a `Set`. No runtime dependency is added; the dataset is produced by a script from a dev-only package and committed.

**Tech Stack:** Next.js 16.2.4 App Router, React client components, Supabase/PostgREST, Tailwind v4, vitest 2.1.9.

## Review of what is on screen today

Verified against `dee4c64`.

**Both comment entry points use the full picker.** The reaction picker and composer picker share the searchable dataset and open above-right of their triggers, leaving the active comment text visible like Slack.

**Everything else works.** The RPCs are installed, `PUT`/`DELETE` are idempotent, the dedicated realtime ping avoids a full detail reload, Enrollment is correctly gated off, and reactions produce no notification.

**Two things in the current code will not survive Task 2** and must change with it:

- `src/app/api/tasks/[id]/comments/[cid]/reactions/route.ts:24` validates with `QUICK_EMOJI.includes(emoji)`. Linear scan over 16 is nothing; over ~1900 it runs on every tap. Becomes a `Set`.
- The RPC rejects `char_length(p_emoji) > 16` (`supabase/rollouts/2026-08-20-comment-reactions.sql`). Postgres `char_length` counts code points. A four-person family emoji is 7 code points and an England flag is 7, so 16 holds for the standard set — but this must be **measured against the actual generated dataset**, not assumed. See Task 2 Step 3.

## Scope

**In:** the placement change; a searchable multi-category emoji picker; the dataset; server allowlist rework.

**Out — decisions, not omissions:**

- **Skin-tone variants.** Messenger and Slack both have them, and they multiply the set roughly six-fold while adding a per-user preference to store. If wanted, it is a follow-up.
- **Custom uploaded emoji.** Slack has them; they need storage, an admin screen, and moderation.
- **The edit-comment box.** `EditCommentForm` still has no emoji button, deliberately — it is a separate component with no `caretRef` (`CommentThread.tsx:1837-1863` uses `setTimeout` + `setSelectionRange`).
- **Reactions in Enrollment.** Still gated off behind `reactionsEnabled`.

## Global Constraints

- **UI copy is English only.** Code comments may stay Vietnamese; anything a user reads may not.
- **Test harness cannot render components.** `vitest.config.ts` is `environment: "node"`, `include: ["src/**/*.test.ts"]` — no jsdom, `.tsx` not collected. Search, filtering and normalization go in plain `.ts` modules so they can be tested; the picker JSX cannot be.
- **No new *runtime* dependency.** A dev-only package generates the dataset; the committed output is what ships.
- **Build-only sources are pinned.** Pin `unicode-emoji-json` and `emojilib`
  versions in `devDependencies`; refresh the generated file deliberately when
  either source is upgraded.
- **Reactions must never notify.** Unchanged and non-negotiable.
- **Do not commit or push without being asked.** Each is a separate request and the remote must be named: `origin` is BaoVoThuong/agent-portal, `vercel` is the separate repo eps-portal.vercel.app deploys from.

---

### Task 1: Keep the reaction UI and use the full picker

**Files:**
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx`

Target layout, under the comment body:

```
Nhờ team assign PCP giúp em ạ
👍 2   🎉 1                     ← pills, only when there are any
Reply · React                   ← text actions
```

- [x] **Step 1: Cut the reaction block out of the outer row**

Remove lines `2046-2120` — the whole `{onToggleReaction || reactions.length > 0 ? ( … ) : null}` block. It currently sits between the `hasMenu` block that closes at `:2045` and `{mutationStatus ? (` at `:2121`.

- [x] **Step 2: Re-insert it inside the body column, above the Reply row**

The body column's `Reply` row is at `:1979-1989`. Put the **pills** immediately before it and fold **React** into the same row as Reply:

```tsx
              {reactions.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {/* the existing pill buttons, unchanged */}
                </div>
              ) : null}

              {canReply || onToggleReaction ? (
                <div className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-[#44546f]">
                  {canReply ? (
                    <button
                      type="button"
                      onClick={onReply}
                      className="rounded px-1 py-0.5 transition hover:bg-[#f4f5f7] hover:text-[#0c66e4]"
                    >
                      Reply
                    </button>
                  ) : null}
                  {canReply && onToggleReaction ? (
                    <span aria-hidden className="text-[#c1c7d0]">·</span>
                  ) : null}
                  {onToggleReaction ? (
                    <button
                      ref={reactTriggerRef}
                      type="button"
                      onClick={toggleReact}
                      aria-haspopup="dialog"
                      aria-expanded={reactOpen}
                      className="rounded px-1 py-0.5 transition hover:bg-[#f4f5f7] hover:text-[#0c66e4]"
                    >
                      React
                    </button>
                  ) : null}
                </div>
              ) : null}
```

Both pickers keep anchored portal behavior and open above-right of their triggers, with enough vertical offset to keep the active comment text visible like Slack.

- [x] **Step 3: Check the guard you just changed**

The old outer condition was `onToggleReaction || reactions.length > 0`. Now the pills render on `reactions.length > 0` alone and the actions row on `canReply || onToggleReaction`. Confirm a comment with **reactions but no permission to react** — Enrollment, or an optimistic row — still shows its pills, disabled, and shows no React button.

- [x] **Step 4: Verify**

```bash
npx tsc --noEmit && npx eslint "src/app/(authed)/tasks/_components/CommentThread.tsx" && npm run build
```

Then `npm run dev` and check by eye:
1. The existing reaction UI remains unchanged while its picker becomes searchable/full-set.
2. `Reply · React` sits under the body, same size and weight as Reply was.
3. The composer picker opens above-right of the smile trigger and does not cover the draft text.
4. A reply (nested comment) shows the same layout — `CommentItem` renders in both places (`:1370` and `:1396`).
5. Clicking React and the composer smile both open the searchable full picker.

---

### Task 2: A full, searchable emoji set

16 hard-coded emoji is the thing the team actually complained about. Messenger and Slack both offer roughly 1,800 with search and categories.

#### The dataset decision

Three ways to get ~1,900 emoji with names and keywords:

| Option | Runtime cost | Trade-off |
|---|---|---|
| **A. Generate once, commit the file** | none | Needs a dev-only package and a regen script; the file is stale when Unicode updates (about once a year) |
| B. Runtime dependency (`emoji-mart` etc.) | ~1MB, its own styling | Fights the app's visual language; large |
| C. Hand-maintain a list | none | Nobody will maintain 1,900 rows by hand |

**Take A.** The output is auditable in review, ships with zero supply-chain surface at runtime, and matches how this repo already treats generated artefacts. If the file needs refreshing later, rerun one script.

#### Bundle placement

The picker renders inside **every** `CommentItem`, so a static import would put the whole dataset in the main bundle. Load it with a dynamic `import()` the first time any picker opens, cached in a module-level promise so the second picker does not refetch. The server route imports it directly — no bundle concern there.

**Files:**
- Create: `scripts/generate-emoji-data.mjs`
- Create: `scripts/emoji-data-source.mjs`
- Create: `scripts/check-emoji-length.mjs`
- Create: `src/lib/tasks/emoji-data.ts` (generated, committed)
- Create: `src/lib/tasks/emoji-search.ts`
- Test: `src/lib/tasks/emoji-search.test.ts`
- Create: `src/app/(authed)/tasks/_components/EmojiPicker.tsx`
- Modify: `src/lib/tasks/emoji.ts`
- Modify: `src/app/api/tasks/[id]/comments/[cid]/reactions/route.ts`
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx` — both trigger sites

- [x] **Step 1: Write the generator**

Add pinned `unicode-emoji-json` and `emojilib` as **devDependencies** and emit a TS
module shaped like this. Read Unicode metadata from `data-by-group.json` (or the
equivalent package export), and merge `emojilib` keywords by exact emoji key.
The generator must derive a fallback keyword list from `name` and `slug` when
`emojilib` has no entry, then deduplicate and lowercase all terms. This keeps
the output reproducible and makes the `+1`/Slack-style search aliases explicit.

```ts
export type EmojiEntry = {
  /** The emoji itself, exactly as it will be stored. */
  char: string;
  /** Lowercase display name, e.g. "thumbs up". */
  name: string;
  /** Extra search terms, lowercase, no duplicates of `name`. */
  keywords: string[];
  group: EmojiGroup;
};
```

Exclude component-only code points. The upstream package already consolidates
skin-tone variants into a base entry; do not expand them. Sort within each group
by the dataset's own order so the picker looks conventional. Emit the upstream
Unicode/emoji data version in a generated-file header so a future refresh is
auditable.

- [x] **Step 2: Generate and eyeball the output**

```bash
npm run generate:emoji
```

Check the file into git. The generated file contains 1,914 entries and is
55,841 bytes gzipped after trimming low-priority keywords; do not trim emoji
unless a future refresh requires it.

- [x] **Step 3: Prove the dataset fits the database constraint**

**Do not skip this.** The RPC raises `INVALID_EMOJI` above `char_length(p_emoji) > 16`, and `char_length` counts code points. Run:

```bash
npm run check:emoji-length
```

(Use `tsx` or compile first if the import fails — the point is the measurement, not the loader.)

The current maximum is 8 code points. If anything exceeds 16 code points, stop and resolve the mismatch before
shipping: either filter that entry from the generated supported set or update
the RPC/schema invariant in the same rollout. Do not leave a picker option that
the server rejects.

- [x] **Step 4: Write the failing search test**

```ts
// src/lib/tasks/emoji-search.test.ts
import { describe, expect, it } from "vitest";
import { searchEmoji, isAllowedEmoji, normalizeEmojiInput } from "./emoji-search";

describe("searchEmoji", () => {
  it("matches on name", () => {
    expect(searchEmoji("thumbs up").map((e) => e.char)).toContain("👍");
  });

  it("matches on a keyword the name does not contain", () => {
    // "+1" is a keyword for thumbs up in every set Slack users expect.
    expect(searchEmoji("+1").map((e) => e.char)).toContain("👍");
  });

  it("is case and whitespace insensitive", () => {
    expect(searchEmoji("  THUMBS  ").map((e) => e.char)).toContain("👍");
  });

  it("ranks a name prefix above a mid-word or keyword hit", () => {
    const first = searchEmoji("smile")[0];
    expect(first.name.startsWith("smil")).toBe(true);
  });

  it("returns everything for an empty query", () => {
    expect(searchEmoji("").length).toBeGreaterThan(1000);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchEmoji("zzzzzznotanemoji")).toEqual([]);
  });
});

describe("isAllowedEmoji", () => {
  it("accepts a member of the set", () => {
    expect(isAllowedEmoji("👍")).toBe(true);
  });

  it("rejects arbitrary text", () => {
    expect(isAllowedEmoji("<script>")).toBe(false);
    expect(isAllowedEmoji("")).toBe(false);
  });

  it("rejects a long paste that merely starts with an emoji", () => {
    expect(isAllowedEmoji("👍 plus a whole sentence")).toBe(false);
  });
});

describe("normalizeEmojiInput", () => {
  it("keeps a canonical emoji untouched", () => {
    expect(normalizeEmojiInput("👍")).toBe("👍");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmojiInput(" 👍 ")).toBe("👍");
  });
});
```

- [x] **Step 5: Implement `emoji-search.ts`**

`isAllowedEmoji` must use a `Set` built once at module load, not
`Array.includes` — it runs on every server request. Do not replace this with a
generic emoji regex; the exact generated set is the allowlist.

**Variation selectors are the subtle part.** The old 16-emoji list dodged U+FE0F entirely; a full set cannot. `⚠️` and `❤️` exist in the dataset with the selector, but a client may send the bare code point. Decide one canonical form — whatever the dataset uses — and have `normalizeEmojiInput` map the bare form to it before the allowlist check, so a legitimate pick is never rejected as "unsupported". Add a test for whichever direction the dataset lands on once you can see the real data.

- [x] **Step 6: Build `EmojiPicker.tsx`**

The searchable picker is used by both the composer button and the reaction trigger. Props: `onPick(emoji: string)`, `onClose()`, and optional selected reaction state.

- A search input, focused on open.
- Category tabs or sticky section headers.
- A virtualised or capped grid — rendering 1,900 buttons at once is a visible stall. Cap the rendered count (say 240) and let search narrow it; that avoids adding a virtualisation dependency.
- A **Frequently used** row at the top, from the existing `QUICK_EMOJI`, so the common case stays one click away.
- Load the dataset with a cached dynamic `import()`; show a small "Loading…" state on first open only.

**Accessibility**, matching what is already there: `role="dialog"` and `aria-label` on the container, `aria-label` per emoji button (an emoji-only button announces as a raw code point name or nothing), and the search input labelled. `useAnchoredMenu` supplies Escape and outside-click; this implementation uses sticky group headers and keeps every emoji tab-reachable, with no custom roving-focus layer.

- [x] **Step 7: Swap both call sites**

Replace the inline 8-column grids in the composer and reaction trigger (`CommentThread.tsx`) with `<EmojiPicker />`. Keep both portal-positioned above-right of their triggers like the reference UI.

Keep `QUICK_EMOJI` exported — the picker's frequently-used row uses it, and
`src/lib/tasks/reactions.ts` uses its stable order for reaction-pill ties.

- [x] **Step 8: Swap the server allowlist**

`route.ts:24`:

```ts
  return emoji && QUICK_EMOJI.includes(emoji) ? emoji : null;
```

becomes a `normalizeEmojiInput` + `isAllowedEmoji` pair. Reject before the RPC so the user sees "Unsupported emoji." rather than an opaque `INVALID_EMOJI`.

- [x] **Step 9: Verify automated checks**

```bash
npx tsc --noEmit && npx vitest run && npx eslint . && npm run build
```

Then `npm run dev` for the remaining visual smoke checks:
1. Open the composer picker — search "fire", pick 🔥, it lands at the caret.
2. Open the composer picker, search "party", pick 🎉, and confirm it lands at the caret. Open a comment's **React** and confirm the old 16-emoji grid still toggles the pill.
3. Pick an emoji **not** in the old 16 — it must save and survive a reload. This is the whole point; if the allowlist or the RPC length check rejects it, that is Step 3 or Step 8 failing.
4. Pick `❤️` or `⚠️` specifically — the variation-selector cases from Step 5.
5. Type a nonsense query — the grid empties without an error.
6. Check the Network panel on first open: the dataset chunk loads once, not per comment.
7. Confirm the main bundle did not grow — compare `npm run build` output against the previous run.

- [x] **Step 10: Changelog**

```markdown
## 2026-08-21 — Reaction đặt cạnh Reply, và bộ emoji đầy đủ
- **Loại**: fix, feature
- **Cái gì**: Nút thả cảm xúc chuyển từ biểu tượng nổi ở góc trên phải xuống thành chữ "React" nằm cạnh "Reply" dưới nội dung comment; các pill nằm ngay trên hàng đó. Thay 16 emoji cố định bằng bộ đầy đủ có tìm kiếm và phân nhóm, dùng chung một component picker cho cả ô soạn comment lẫn thanh reaction.
- **Vì sao**: Khối reaction trước đây là anh em với khối menu `⋯` nên rơi vào cột phải của hàng ngoài thay vì cột nội dung — lỗi bố cục mà `tsc` và build không thấy được. Và 16 emoji là quá ít so với Messenger/Slack, đúng điều team phản ánh.
- **File**: `scripts/generate-emoji-data.mjs`, `src/lib/tasks/emoji-data.ts`, `src/lib/tasks/emoji-search.ts`, `src/app/(authed)/tasks/_components/EmojiPicker.tsx`, `CommentThread.tsx`, `src/app/api/tasks/[id]/comments/[cid]/reactions/route.ts`
- **Ảnh hưởng**: Không thêm phụ thuộc lúc chạy — bộ dữ liệu sinh sẵn bằng script từ một devDependency rồi commit thẳng vào repo. Dữ liệu nạp bằng dynamic import lần đầu mở picker nên không phình bundle chính. Kiểm duyệt emoji phía server đổi từ `Array.includes` sang `Set` vì giờ có ~1900 phần tử. Ràng buộc `char_length(p_emoji) <= 16` trong RPC đã được đo lại với bộ dữ liệu thật. CHƯA làm: biến thể màu da, emoji tự tải lên, và emoji cho ô sửa comment.
```

---

## Sequencing

Task 1 is independent, small, and fixes something visibly wrong — ship it first even if Task 2 waits. Task 2 subsumes both inline pickers, so doing it before Task 1 would mean touching the same JSX twice.
