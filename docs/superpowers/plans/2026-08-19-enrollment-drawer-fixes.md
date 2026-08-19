# Enrollment Drawer Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four changes to the Enrollment module: new records must always start at the first stage instead of letting the creator pick one, the drawer carries a Files tab that is being retired, the Activity tab is visible to everyone when it should be manager-only, and the Description field can grow without limit inside a fixed-height drawer.

**Architecture:** All four live in one file, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`. None touches the database or an API route. Two of them copy a shape CS already uses — the locked create-time stage from `NewTaskDialog.tsx:506-514` and the Activity gate from `TaskDetailDrawer.tsx:546`/`:593` — and the Description cap copies the fix shipped for CS in commit `ffb8c2b`.

**Tech Stack:** Next.js 16.2.4 App Router, React client components, Tailwind v4 (no config file — arbitrary values like `max-h-[138px]` are read straight from source).

## Status

**Nothing here is implemented.** An earlier attempt was written to the working tree and then discarded before it was committed; `git status` is clean apart from untracked plan files, and the last commit touching `EnrollmentClient.tsx` is `03ec9bd`. Every line number below was re-verified against the tree at commit `bc27874`. Start from Task 1.

## Global Constraints

- **UI copy is English only.** Commit `03ec9bd` translated the last 21 Vietnamese user-facing strings. Code comments may stay Vietnamese; anything a user reads may not.
- **`changelog.md` records logic changes only.** Its own header excludes pure UI changes (colour, spacing, copy). Task 3 changes who can see data and Task 4 changes layout behaviour, so both earn a mention; Tasks 1 and 2 alone would not.
- **Do not commit or push without being asked.** Each commit and each push is a separate request, and the remote must be named: `origin` is BaoVoThuong/agent-portal, `vercel` is the separate repo eps-portal.vercel.app deploys from.

## Verified starting state

| Thing | Line |
|---|---|
| `DETAIL_FIELD_BUTTON_CLASS` | 175 |
| `COMPACT_DESCRIPTION_CLASS` | 187 |
| `EnrollmentStagePill` function | 2773 |
| — `field = false` default | 2776 |
| — `field?: boolean` in the prop type | 2782 |
| — `const pill = field ? (` branch | 2799 |
| — badge branch `className` | 2810 |
| `EnrollmentDrawer` function | 2895 |
| — `isManager: boolean;` prop | 2928 |
| — tab state | 2938 |
| Description `<label>` in the drawer | 3153-3165 |
| Tab `<section>` | 3167 |
| `import { AttachmentPanel }` | 88 |
| Stage call sites | 1980 (list row), 3228 (drawer), 3816 (create dialog) |

---

### Task 1: New records always start at the first stage, shown read-only

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` — add a derived value near line 3641, replace lines 3816-3820

**What is wanted:** a new enrollment record always starts at the first stage, and the stage is only changed afterwards from the record drawer. The create dialog therefore shows the starting stage but does not let anyone pick a different one — the same shape CS already uses.

**How CS does it.** `NewTaskDialog.tsx:153-172` derives the rule, then the JSX at 493-515 renders two different things:

```tsx
  const isAssigned = canPickAssignee ? selectedAssignees.length > 0 : true;
  const effectiveStatus: TaskStatus = isAssigned ? status : "backlog";
```

```tsx
              {showStage ? (
                <MetaField label={columnByKey.get("status")?.label ?? "Stage"}>
                  {isAssigned ? (
                    <TaskSelect … />
                  ) : (
                    <div
                      className="flex h-10 items-center rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm font-medium text-[#172b4d]"
                      title="Unassigned tasks always start in Backlog — pick an Assignee to choose a different stage."
                    >
                      {STATUS_LABEL.backlog}
                    </div>
                  )}
                </MetaField>
              ) : null}
```

The locked branch is a plain read-only `<div>` — not a disabled picker — carrying a `title` that explains *why* it cannot be changed. Enrollment gets the locked branch unconditionally.

**This also fixes the misalignment that prompted the task.** Today Stage is the only property in that column that is not a full-width 36px control; it renders as a small centred pill in 11px uppercase while Due date, Payment status, Carrier, ACA and Platform are all boxes. That is not a `text-align` bug — `EnrollmentStagePill` has two render modes chosen by a `field` prop (default `false` at 2776, typed 2782, branched 2799), and the badge branch at 2810 is `inline-flex`, so it shrinks to its content and the container appears to centre it. Passing `field` would have fixed the look while keeping it editable; making it read-only fixes the look *and* the behaviour, so the pill is removed from this call site entirely.

Leave the other two call sites alone: line 1980 (list row) correctly uses the compact badge, and line 3228 (drawer, inside `FieldBlock`) correctly passes `field` and stays editable — that is where the stage is changed after creation.

**The payload already does the right thing.** `form` initialises with `stage_id: optionsBySet.stage[0]?.id ?? ""` at line 3592, so the first stage is already what gets submitted. No payload change is needed; only the control changes.

- [ ] **Step 1: Derive the starting stage**

Beside `const showStage = showField("stage");` at line 3641, add:

```tsx
  // New records always start at the first stage; it is changed afterwards from
  // the record drawer. This mirrors form.stage_id's initial value at line 3592
  // — keep the two in step if either moves.
  const initialStage = optionsBySet.stage[0] ?? null;
```

- [ ] **Step 2: Replace the picker with a read-only display**

Replace lines 3816-3820:

```tsx
                      <EnrollmentStagePill
                        stageId={form.stage_id || null}
                        stages={optionsBySet.stage}
                        onChange={async (value) => update("stage_id", value)}
                      />
```

with:

```tsx
                      <div
                        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-[#f4f5f7] px-2 py-1.5 text-left text-sm font-semibold text-[#172b4d]"
                        title="New records always start at the first stage. Change it from the record after creating."
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: enrollmentStateBadgeStyle(initialStage).fg }}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {initialStage?.label ?? "No stage"}
                        </span>
                      </div>
```

The class list is `DETAIL_FIELD_BUTTON_CLASS` (line 175) minus its interactive parts — no `hover:`, no `focus:`, no `outline-none` — and on `bg-[#f4f5f7]` rather than white, so it reads as disabled rather than as an input someone failed to click. There is deliberately **no chevron**: `EnrollmentStagePill`'s `field` branch always renders one, which would advertise a picker that does not open.

`enrollmentStateBadgeStyle` is already imported at line 67, so no new import is needed.

- [ ] **Step 3: Check what became unused**

`update("stage_id", …)` may now have no caller in this dialog, and `EnrollmentStagePill` may no longer be referenced from it. Neither is an error, but run:

```bash
npx eslint "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
```

and clear anything it flags as unused. Do **not** delete `EnrollmentStagePill` itself — lines 1980 and 3228 still use it.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

**One edge case to think about, not to code around blindly.** `form.stage_id` is captured in `useState`'s initialiser at 3592, so it is fixed at first render. If `optionsBySet.stage` is still empty then and fills in later, the record is created with an empty `stage_id` while the new display shows "No stage". Check whether the dialog can mount before options load — if it can, either gate the Create button on `initialStage` being present, or resolve `stage_id` at submit time instead of at mount.

---

### Task 2: Remove the Files tab

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` — line 88 (import), 2938 (tab state), the tab button block, the tab body block

The Files tab is being retired: attachments move under Description and become create-time only. That work is `2026-08-19-enrollment-create-attachments.md`; nothing here depends on it landing first.

**This removes a capability that exists today** — uploading a file to an enrollment record after it was created. That is intended.

- [ ] **Step 1: Narrow the tab state type**

Line 2938. Replace:

```tsx
  const [tab, setTab] = useState<"comments" | "activity" | "files">("comments");
```

with:

```tsx
  const [tab, setTab] = useState<"comments" | "activity">("comments");
```

Narrowing first is deliberate: `tsc` will now point at every remaining `"files"` comparison, so nothing depends on grep alone.

- [ ] **Step 2: Delete the Files tab button**

In the tab bar, delete:

```tsx
                  <DrawerTab
                    label="Files"
                    count={detail?.attachments.length ?? record.attachment_count}
                    active={tab === "files"}
                    onClick={() => setTab("files")}
                  />
```

- [ ] **Step 3: Delete the panel branch**

The tab body is a ternary chain ending with `AttachmentPanel` as its `else`. Replace:

```tsx
                ) : tab === "activity" ? (
                  <ActivityFeed
                    activity={detail.activity}
                    personLabelByEmail={peopleByEmail}
                  />
                ) : (
                  <AttachmentPanel
                    attachments={detail.attachments}
                    taskId={record.id}
                    apiBase="/api/enrollment"
                    canEdit={capabilities.canEditFields}
                    onReload={reloadDetailAndParent}
                  />
                )}
```

with:

```tsx
                ) : tab === "activity" ? (
                  <ActivityFeed
                    activity={detail.activity}
                    personLabelByEmail={peopleByEmail}
                  />
                ) : null}
```

Task 3 rewrites this same branch again. If you are doing both, apply Task 3's version and skip this step.

- [ ] **Step 4: Remove the import**

Line 88. Delete:

```tsx
import { AttachmentPanel } from "../../tasks/_components/AttachmentPanel";
```

**`AttachmentPanel.tsx` is now dead code.** It is 165 lines, and `EnrollmentClient` is its only importer anywhere in the repo — `CommentThread` does **not** use it; the composer paperclip is CommentThread's own upload path (`CommentThread.tsx:648`) and its only DELETE call is `comments/${id}` (`CommentThread.tsx:791`). Leave the file in place for now — the plan for `2026-08-19-enrollment-create-attachments.md` reuses nothing from it, and deleting it is a separate decision — but do not describe it as "still wired for comments", because it is not.

- [ ] **Step 5: Confirm nothing is left behind**

```bash
grep -n '"files"\|AttachmentPanel' "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
```
Expected: no output.

```bash
npx tsc --noEmit
```
Expected: exit 0.

**Known waste this leaves behind:** `loadEnrollmentDetail` calls `loadEnrollmentAttachments` unconditionally (`src/lib/enrollment/detail.ts:203`, loader at 167-181), which queries and signs record-level attachments on every drawer open. With the tab gone and the strip not yet added, nothing renders them. CS avoids the same cost with an `includeTaskAttachments: false` flag. Do not add a flag now — the create-attachments plan puts that data back on screen — but if that plan is shelved, revisit this.

---

### Task 3: Activity tab is manager-only

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` — the tab button block and the tab body block

**Reference behaviour — how CS already does it.** `TaskDetailDrawer.tsx:546` hides the buttons:

```tsx
                  {canViewNonCommentDetail ? (
                    <>
                      <DetailTabButton label="Activity" ... />
                      <DetailTabButton label="Overdue" ... />
                    </>
                  ) : null}
```

and lines 593 and 599 gate the bodies independently:

```tsx
              {tab === "activity" && canViewNonCommentDetail && (
```

Two layers, not one. Hiding only the button leaves the panel reachable by any other path that sets `tab`.

The value comes from `TaskBoardClient.tsx:1573-1575`:

```tsx
  const canViewOpenNonCommentDetail = Boolean(
    openTask && (isManager || isAgentOwnerOrAssistantOf(openTask.agent_email))
  );
```

**What Enrollment uses.** `EnrollmentDrawer` already receives `isManager: boolean` (declared line 2928, passed at 1275), which is `task.manage` combined with an admin role. No new prop, no new lookup.

- [ ] **Step 1: Gate the tab button**

Replace the Activity `DrawerTab` with:

```tsx
                  {isManager ? (
                    <DrawerTab
                      label="Activity"
                      count={detail?.activity.length ?? 0}
                      active={tab === "activity"}
                      onClick={() => setTab("activity")}
                    />
                  ) : null}
```

- [ ] **Step 2: Gate the tab body**

Replace the Activity branch of the ternary chain with a check on `isManager` rather than on `tab`:

```tsx
                ) : isManager ? (
                  <ActivityFeed
                    activity={detail.activity}
                    personLabelByEmail={peopleByEmail}
                  />
                ) : null}
```

`tab` is now a two-member union and `"comments"` is handled by the previous branch, so reaching here means `tab === "activity"`; the only remaining question is whether the viewer may see it.

- [ ] **Step 3: Decide about the redirect effect — and skip it**

CS carries this at `TaskDetailDrawer.tsx:269-273`:

```tsx
  useEffect(() => {
    if (canViewNonCommentDetail || tab === "comments") return;
    const timer = window.setTimeout(() => setTab("comments"), 0);
    return () => window.clearTimeout(timer);
  }, [canViewNonCommentDetail, tab]);
```

**Do not copy it.** CS needs it because its gate includes `isAgentOwnerOrAssistantOf(openTask.agent_email)`, which changes as the user opens different tasks — someone sitting on Activity can open a task they do not own and lose access while that tab is still selected. Enrollment's gate is `isManager` alone, which does not vary by record, so a non-manager can never reach `tab === "activity"`. Add the effect only if the Enrollment gate later becomes record-dependent.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

---

### Task 4: Cap the Description height

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:187` and the `autosizeTextarea` helper at 200-203

**This was not requested, and it is not cosmetic.** It is the same bug that shipped in CS and was fixed there in `ffb8c2b`; the Enrollment copy was never fixed.

The drawer is a fixed-height column that does not scroll on desktop — line 3077:

```tsx
className="flex h-[calc(100vh-2rem)] max-h-[760px] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
```

and 3097-3099:

```tsx
        <div className="flex-1 overflow-y-auto lg:overflow-hidden">
          <div className="grid min-h-full grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_280px]">
            <main className="flex min-w-0 flex-col gap-3 p-4 lg:min-h-0 lg:overflow-hidden lg:p-5">
```

The Description wrapper is `shrink-0` and the comment section at 3167 is the only `flex-1` child, so the field takes its space from the comment thread. Line 187 has a floor and no ceiling:

```tsx
const COMPACT_DESCRIPTION_CLASS = `${INPUT_CLASS} min-h-[72px] resize-none overflow-hidden !px-2 !py-2 leading-6`;
```

and `autosizeTextarea` (200-203) grows it on every keystroke, called from `EditableTextarea` at 4228 and 4239. A 13-line description is ~330px, 43% of the drawer. Compare the CS version, `TaskDetailDrawer.tsx:47`, which carries `max-h-[138px]`.

**The create-attachments plan stacks a file strip directly beneath this field.** Doing that on an uncapped Description reproduces the original bug with extra weight, so cap it first.

- [ ] **Step 1: Add the ceiling**

Replace line 187 with:

```tsx
// The drawer is a fixed 760px column and this field is shrink-0, so every pixel
// it grows is a pixel taken from the comment thread below it. Cap at 5 lines
// (5 × 24px leading-6 + 16px of !py-2 = 138px) and scroll inside instead.
// max-h mirrors DESCRIPTION_MAX_HEIGHT — Tailwind cannot read the constant, so
// keep them in sync — and is the fallback if autosizeTextarea never runs.
const COMPACT_DESCRIPTION_CLASS = `${INPUT_CLASS} min-h-[72px] max-h-[138px] resize-none overflow-x-hidden !px-2 !py-2 leading-6`;
```

Note `overflow-hidden` becomes `overflow-x-hidden`: the vertical axis is now managed inline by the helper.

- [ ] **Step 2: Give `autosizeTextarea` a ceiling**

Lines 200-203 read:

```tsx
function autosizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(72, textarea.scrollHeight)}px`;
}
```

Replace with:

```tsx
/** 5 lines at leading-6 (24px) plus the 16px of !py-2. */
const DESCRIPTION_MAX_HEIGHT = 138;
const DESCRIPTION_MIN_HEIGHT = 72;

function autosizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  // Measure against an unclipped box: a leftover height or an existing
  // scrollbar both feed back into scrollHeight and would ratchet the value.
  textarea.style.overflowY = "hidden";
  textarea.style.height = "auto";
  const contentHeight = textarea.scrollHeight;
  textarea.style.height = `${Math.min(
    DESCRIPTION_MAX_HEIGHT,
    Math.max(DESCRIPTION_MIN_HEIGHT, contentHeight)
  )}px`;
  if (contentHeight > DESCRIPTION_MAX_HEIGHT) textarea.style.overflowY = "auto";
}
```

The measure-then-clamp order matters. Setting `overflowY = "hidden"` *before* reading `scrollHeight` is what stops the value creeping upward on every keystroke once a scrollbar appears.

**Check who else calls this helper before you commit.** `autosizeTextarea` in this file may be shared by textareas other than Description — grep for it. If a caller wants unbounded growth, take the max as a parameter instead of hard-coding it.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit && npm run build
```
Expected: both exit 0.

Then in `npm run dev`, open a record whose description is long enough to overflow. Confirm the field stops at five lines and scrolls internally with **no text lost** — scroll to the very bottom and check the last characters are reachable — and that the comment list below has usable height.

---

### Task 5: Verify by hand

Static checks cannot see any of this. All four are visual or permission-based.

- [ ] **Step 1: Build**

```bash
npx tsc --noEmit && npm run build
```
Expected: both exit 0.

- [ ] **Step 2: Stage is fixed and read-only at create**

Open `localhost:3000/enrollment?program=aca` → **New enrollment**.

- Stage is a full-width box the same height as Due date beneath it, label left-aligned, coloured dot on the left — **not** a small centred uppercase pill.
- It shows the **first** stage in the catalogue (for ACA, `1-NEED QUOTE`).
- **Clicking it does nothing.** No menu opens. Hovering shows the explanation.
- Create the record, open it in the drawer, and confirm the stage picker there **does** open and the change sticks. That is the only place a stage is changed.

Repeat on `?program=medicare` — the two programs have different stage catalogues (12 vs 11), so "the first stage" is a different value and both should display their own.

- [ ] **Step 3: Tabs as a manager**

Open any record. Exactly two tabs: **Comments** and **Activity**. No Files tab. Activity renders.

- [ ] **Step 4: Tabs as a non-manager**

Sign in as an account with `task.work` but not `task.manage`. Open a record. **Only Comments.** No Activity content reachable.

This is the step most likely to be skipped and the only one that verifies an access rule rather than cosmetics.

- [ ] **Step 5: Description cap**

A record with a long description: field stops at five lines, scrolls, no text lost, comments below still usable.

- [ ] **Step 6: Comment attachments still work**

Post a comment with a file via the composer paperclip. Task 2 removed an `AttachmentPanel` import; this confirms the comment upload path — which never used that component — is untouched.

---

### Task 6: Changelog and commit

- [ ] **Step 1: Add the changelog entry**

At the top of `changelog.md`, under the header block:

```markdown
## 2026-08-19 — Enrollment: Stage cố định khi tạo, Activity chỉ manager xem, bỏ tab Files, chặn chiều cao Description
- **Loại**: fix, rbac, workflow, ui
- **Cái gì**: Dialog "New enrollment" không cho chọn Stage nữa — record mới luôn bắt đầu ở stage đầu tiên của catalogue, hiển thị dạng ô chỉ đọc kèm tooltip; đổi stage chỉ làm được ở drawer sau khi đã tạo. Giống cách CS khoá Stage ở `NewTaskDialog.tsx:506-514`. Tab Activity trong drawer chỉ hiện với `isManager` (task.manage + admin role), chặn ở CẢ nút tab lẫn nhánh render — giống CS ở `TaskDetailDrawer.tsx:546` và `:593`. Bỏ hẳn tab Files và `AttachmentPanel` khỏi drawer. Ô Description trong drawer được chặn trần 138px và cuộn bên trong.
- **Vì sao**: Cho chọn stage lúc tạo khiến record mới có thể nhảy thẳng vào giữa quy trình, bỏ qua các bước trước. Activity phơi lịch sử thao tác của mọi người cho người không có quyền quản lý. Tab Files bị thu hồi vì đính kèm chuyển thành trường của form tạo. Description không có trần trong một drawer cao cố định sẽ nuốt hết chỗ của khối comment — đúng bug đã sửa cho CS ở `ffb8c2b` nhưng bản Enrollment thì chưa.
- **File**: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: Người không phải manager mất quyền xem Activity của Enrollment (CS vốn đã chặn tương tự). **Mất khả năng upload file vào record sau khi đã tạo** — trước đây làm được ở tab Files. `AttachmentPanel.tsx` giờ là code chết, không còn ai import; giữ lại file, chưa xoá. `loadEnrollmentAttachments` vẫn chạy mỗi lần mở drawer dù tạm thời không còn ai hiển thị — sẽ có chỗ dùng lại khi làm plan đính kèm. Không đụng schema, API, hay CS.
```

- [ ] **Step 2: Confirm only the intended files are staged**

```bash
git status --porcelain
```

Expected: `EnrollmentClient.tsx` and `changelog.md`. `AccountManagerClient.tsx` should **not** appear — that work was committed as `bc27874`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" changelog.md
git commit -m "fix(enrollment): restrict Activity to managers, drop Files tab, repair Stage and cap Description"
```

- [ ] **Step 4: Stop**

Do not push. Ask which remote first.
