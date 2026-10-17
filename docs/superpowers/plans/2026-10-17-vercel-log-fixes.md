# Sửa lỗi từ audit log Vercel 2026-10-17 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Không để người dùng mất lượt sửa Task/Enrollment vì 409 "tự xung đột" sau khi gửi comment hoặc file đính kèm. Ghi log đủ để biết nguyên nhân của các 409 và 500 còn lại. Bỏ cảnh báo `notification_failed` báo sai.

**Architecture:** Chỉ sửa code, không có SQL. (1) Tăng số lượt tự gửi lại khi 409 mà trường đang sửa không ai đụng: đã có cơ chế `canRetryAfterConflict`, chỉ là 2 lượt không đủ. (2) Upload file gắn vào comment của Enrollment không đẩy `updated_at` thêm lần nữa, giống Task đã làm. (3) Log 409 kèm `stage` + `lag_ms`. (4) `GET /api/tasks` lỗi 500 thì ghi log. (5) Realtime hỏng sau khi đã ghi dòng thông báo thì chỉ ghi log, không thành warning của mutation.

**Tech Stack:** Next.js 16 (App Router, `after()` từ `next/server`), Supabase PostgREST + RPC plpgsql, Vitest, TypeScript.

## Trạng thái triển khai 2026-10-17

- [x] Task 1–5: đã sửa code, thêm test và cập nhật `changelog.md`. Không đổi SQL/schema hoặc quy tắc phân quyền.
- [x] Task 6, bước 1: 214 file test / 1.743 test pass; typecheck và build pass; lint 0 lỗi, 2 cảnh báo ở `public/sw.js` và `LeadTable.tsx`. Claude kiểm lại trong một worktree chỉ chứa code của plan (không có WIP Role Manager/OrgTree): kết quả như trên.
- [ ] Task 6, bước 2: chưa thử tay vì `.env.local` trỏ production; thao tác thử sẽ ghi dữ liệu thật.
- [x] Task 6, bước 3: user cho push 2026-10-17; commit cùng plan này, push `origin/main` + `vercel/main`.
- [ ] Task 6, bước 4: theo dõi log 3–7 ngày sau deploy.

Plan này thay cho `docs/superpowers/plans/2026-10-17-vercel-log-audit-and-optimization.md` (review của Codex). Mục 2 đối chiếu từng điểm của bản đó.

## Global Constraints

- **Không commit, không push** khi user chưa bảo. Mỗi task có bước commit, nhưng chỉ chạy khi user đã đồng ý.
- Working tree đang có việc dở của người khác (`OrgTree.tsx`, `OrgTree.module.css`, `role-manager/*`, `.gitignore`). `git add` đúng từng file của task, **không** `git add -A` hay `git add .`.
- Plan này **không chạy SQL** và không đổi `supabase/schema.sql`.
- Mọi thay đổi LOGIC ghi vào `changelog.md` (entry mới ở trên cùng, tiếng Việt). Riêng log thuần (Task 3, Task 4) thì không ghi.
- Log không chứa email, session, request body, token hay nội dung khách hàng. ID bản ghi (UUID) được phép, giống log `mutation.conflict` hiện có.
- `.env.local` trỏ thẳng production. Thử tay trên localhost là tạo dữ liệu thật: thử xong thì archive task hoặc hồ sơ đó.
- Lệnh kiểm: `npx vitest run <file>`, `npm run typecheck`, `npm run lint`. Chạy trong `agent-portal/`.

---

## 1. Danh sách lỗi (gộp audit của Claude và Codex)

Nguồn: runtime log + request log production **7 ngày** (10–17/10). Codex đọc **72 giờ**. Cả hai lấy qua Vercel CLI 64.5.

| # | Lỗi | Bằng chứng | Kết luận | Task |
|---|---|---|---|---|
| E1 | `TaskScopeTooLargeError` ở `/tasks` (kèm 5×503 + 1×500 ở `GET /api/tasks`) | 44 lần, lần cuối 16/10 13:38 UTC | **Đã hết.** Từ 16/10 13:40 UTC có 8.215 `GET /api/tasks` 200 và 1.455 `/tasks` 200, **0 lỗi 5xx**. Từ `29c1b7d` tới `6d2fafa`, đường nạp danh sách task không đổi gì (chỉ đổi comment trong `assignees.ts`, xoá `membership-mutation.ts`, sửa 2 dialog Leads) | — |
| E2 | 409 "tự xung đột" sau comment/file | Có 29 lượt 409 trên Task/Enrollment. 28 lượt xảy ra trong vòng 90 s sau một POST comment/attachment vào **cùng bản ghi**. 22 lượt có lượt lưu thành công trong 15 s sau đó (tự gửi lại được). **7 lượt không có lượt lưu thành công nào sau đó**, trong đó 1 lượt (`64119c18`) là hai người sửa cùng lúc thật, đúng thiết kế | Có lỗi thật: người dùng mất lượt sửa. Xem mục 3 | 1, 2, 3 |
| E3 | `GET /api/tasks` trả 500 nhưng không có log | 1 lần, 15/10 18:52 UTC (deployment cũ). Tra theo request ID: không có dòng log nào | Không biết nguyên nhân vì route nuốt lỗi | 4 |
| E4 | Warning `notification_failed` khi chỉ realtime hỏng | 14/10 20:15: `[side-effect] notification_failed reported failure`. `insertNotifications` đã ghi dòng vào DB **trước**, rồi trả `false` chỉ vì broadcast hết giờ | Warning báo sai: thông báo vẫn có trong chuông | 5 |
| E5 | `DEP0169 url.parse()` (Vercel xếp level `error`) | ~220 dòng / 7 ngày. Nguồn: `node_modules/web-push/src/web-push-lib.js:274` và `:348`. `web-push` 3.6.7 là bản mới nhất trên npm | Không có bản nâng cấp để sửa. Vô hại. **Không làm** | — |
| E6 | `CredentialsSignin` (3), `UnknownAction` (1) | Gõ sai mật khẩu; một request không phải GET/POST tới `/api/auth/session` | Bình thường | — |
| E7 | 404: 4 Apple icon, 2 CSS chunk | Browser tự hỏi `apple-touch-icon`; chunk CSS cũ sau deploy | Để sau (mục 5) | — |
| E8 | Build warning npm `cache-dir`, `allowScripts` (esbuild, sharp, unrs-resolver) | Build log `6d2fafa` | Không chặn build. 3 gói này không cần install script trên Vercel | — |
| E9 | Realtime broadcast timeout 1.500 ms × 2 lần thử | 3 lần ngày 13–14/10 | Đã có poll dự phòng. Theo dõi tiếp, không sửa | — |
| E10 | `[enrollment-detail] initial reaction snapshot unavailable`; `Enrollment notifications dropped by current access scope` | 1 lần và 2 lần | Theo dõi khi có repro. **Không** nới scope chỉ để hết warning | — |

## 2. Đối chiếu với review Codex

| Codex | Plan này | Lý do |
|---|---|---|
| P0: phải smoke test TaskScope trên `6d2fafa` vì "chỉ có 32 request" | **Đóng E1**, smoke test không bắt buộc | Codex chỉ xem bản `6d2fafa`. Bản `29c1b7d` (cùng code đường nạp danh sách) đã chạy 8.215 lượt `GET /api/tasks` trong giờ làm việc ngày 16/10, 0 lỗi 5xx. RPC `tasks_visible_to_worker` đã được kiểm chỉ đọc ngày 16/10: chỉ `service_role` gọi được, 32/32 Agent/Assistant khớp |
| P1: log lỗi 500 của `GET /api/tasks` | **Đồng ý** → Task 4 | Hiện catch trả 500 mà không log |
| P1: tách "ghi thông báo hỏng" khỏi "broadcast hỏng" | **Đồng ý** → Task 5 | Đã đọc code `insertNotifications`, đúng như Codex mô tả |
| P2: bỏ fetch SLA trùng, dùng chung notification summary, chỉ tối ưu list khi có baseline | **Đồng ý là đo trước**, chưa đưa vào task (mục 5) | Lợi ích nhỏ: tổng chi phí Vercel khoảng $3/tháng; latency sau syd1 đã tốt (p50 `GET /api/tasks` 300 ms, detail 200 ms) |
| P3: dùng `--trace-deprecation` để tìm gói gọi `url.parse` | **Đã tìm ra**: `web-push` 3.6.7 | Không có bản mới hơn để nâng, nên đóng |
| "18 × 409 là optimistic conflict, xem UX, không tự coi là lỗi server" | **Khác**: 409 là lỗi phía token ở client, không phải lỗi server | Đối chiếu từng 409 với POST comment/attachment và bảng `task_activity`: phần lớn là chính người đó tự xung đột. Task `56093378` mất lượt sửa (mục 3) |
| `level:warn` (không phải `level:warning`) | **Codex đúng** | `level:warning` trả rỗng. Audit 7 ngày đã đọc lại bằng `level:warn` (11 dòng) |
| Task search audit | Ngoài phạm vi | Không có trong log. User chưa chọn làm (P3 của Sol) |

## 3. Phân tích 409 — đọc trước khi làm Task 1–3

### 3.1 Cơ chế khoá lạc quan (optimistic concurrency) hiện tại

Client gửi `expected_updated_at` = `updated_at` của bản nó đang giữ. Server chặn ở **hai** chỗ:

1. **Precheck** (so chuỗi, không ghi log). `src/app/api/tasks/[id]/route.ts:243`:
   ```ts
   if (expectedUpdatedAt !== r.task.updated_at) {
     return NextResponse.json(
       { error: "Task was updated by someone else. Refresh and try again." },
       { status: 409 }
     );
   }
   ```
   Enrollment giống hệt ở `src/app/api/enrollment/[id]/route.ts:166`.
2. **Write**: RPC `patch_task_atomic` / `patch_enrollment_atomic` so lại trong transaction và raise `TASK_CONFLICT` / `ENROLLMENT_CONFLICT`. Chỉ nhánh này có log: `console.warn("mutation.conflict", { route, id })` (`tasks/[id]/route.ts:610`, `enrollment/[id]/route.ts:548`).

Ngoài sửa trường, còn 3 thứ đẩy `updated_at` lên:

| Hành động | Hàm DB | Client có biết mốc mới không |
|---|---|---|
| Comment (Task, Enrollment) | `create_task_comment_atomic`, `create_enrollment_comment_idempotent` | **Có**: trả `parent_updated_at`, `CommentThread` gọi `onParentUpdatedAt` |
| File Task **không** gắn comment | `create_task_attachment_atomic` (chỉ khi `p_comment_id is null`, `supabase/schema.sql:3094`) | **Không** |
| Mọi file Enrollment, kể cả file gắn comment | `enrollment_touch_activity` gọi từ `src/app/api/enrollment/[id]/attachments/route.ts:281` | **Không**: response trả `record: null`, và tab bỏ qua ping realtime do chính nó phát |

Client tự gửi lại **đúng 1 lần** khi 409 mà các trường của lượt sửa không ai đổi. `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:1532` và `:1562`:
```ts
for (let attempt = 0; attempt < 2; attempt += 1) {
  // ...
  if (attempt === 0 && canRetryTaskPatchAfterConflict(patch, baseline, canonical)) {
    continue;
  }
  setError(
    "Someone else changed this task, so your last change was not saved. The latest data is shown — please make the change again."
  );
```
Enrollment cũng vậy ở `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:1634` và `:1677`. Gửi lại an toàn vì `canRetryAfterConflict` (`src/lib/collaboration/conflict-retry.ts`) chỉ trả `true` khi mọi trường trong patch vẫn giữ nguyên giữa bản người dùng đã thấy và bản mới nhất trên server.

### 3.2 Ca mất lượt sửa: task `56093378` (14/10, giờ UTC)

| Thời điểm | Sự kiện (DB + request log) |
|---|---|
| 12:47:06.56 | Tạo task kèm 3 file. `uploadCreatedTaskFiles` (`TaskBoardClient.tsx:1873`) → `runBackgroundUploads` (`src/app/(authed)/_shared/useBackgroundUploads.ts`) tải tối đa 3 file cùng lúc |
| 12:47:23.39 | Comment (client nhận `parent_updated_at`) |
| 12:47:47.55 | File 1 vào DB → `updated_at` nhảy, client không biết |
| 12:47:52.90 | PATCH → **409** (precheck). Client đọc lại bản mới nhất → gửi lại |
| 12:47:53.87 | File 2 vào DB → `updated_at` nhảy lần nữa |
| 12:47:54.17 | PATCH gửi lại → **409**. Hết lượt → người dùng thấy "Someone else changed this task…" và **mất lượt sửa** |
| 12:47:55.07 | File 3 vào DB |

Cần tối đa 1 + 3 = **4 lượt** (lượt đầu, mỗi file một lượt). → **Task 1**.

### 3.3 Ca Enrollment: comment + file rồi sửa ngay

`e663be46` (15/10): comment 16:42:12 → PATCH bắt đầu 16:42:18, log `mutation.conflict` lúc 16:42:21 (nhánh write) → POST file gắn comment bắt đầu 16:42:20. File chạm `enrollment_touch_activity` **giữa** precheck và write của PATCH. `89dc5a7f` (13/10) lặp lại hai lần: comment → file → PATCH 409 → gửi lại thì 200.

Comment vốn đã đẩy `updated_at` + `last_activity_at` rồi (`create_enrollment_comment_idempotent`, dòng `update enrollment_records set updated_at = v_now, … last_activity_at = v_now`), nên lần chạm thêm của file gắn comment là thừa. Task không làm vậy. → **Task 2**.

10 trong 11 lượt 409 Enrollment có POST file + comment vào cùng hồ sơ trong 90 s trước đó. Lượt còn lại (`e663be46` 16:42:18) là lượt đua với file ở trên.

### 3.4 Chưa giải thích được → cần log (Task 3)

`88a5ee33` (15/10 18:51:00 sửa trạng thái được → 18:51:02 PATCH 409), `79a570a7` (14/10 13:23:31 → 13:23:36), `867cdd4d` (16/10): cùng một người sửa được một lượt, vài giây sau lượt thứ hai bị 409 **và không có lượt gửi lại** (tức `canRetry` trả false, hoặc không đọc được bản mới nhất). Không có body nên không biết là trường nào. Log `lag_ms` (token client chậm hơn server bao lâu) và `same_instant` (cùng thời điểm mà chuỗi khác nhau, tức so chuỗi ở precheck chặn nhầm) sẽ trả lời được lần tới.

---

## 4. Các task

### File Structure

| File | Trách nhiệm |
|---|---|
| `src/lib/collaboration/conflict-retry.ts` (sửa) | Thêm `MAX_CONFLICT_ATTEMPTS`, `shouldRetryConflict` dùng chung cho Task + Enrollment |
| `src/lib/collaboration/conflict-retry.test.ts` (mới) | Test hai export trên |
| `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` (sửa) | Vòng gửi lại của `patchTask` |
| `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` (sửa) | Vòng gửi lại của `patchRecord` |
| `src/lib/enrollment/attachment-touch.ts` (mới) + `.test.ts` | Luật "file nào thì chạm hồ sơ" |
| `src/app/api/enrollment/[id]/attachments/route.ts` (sửa) | Dùng luật trên |
| `src/lib/collaboration/conflict-log.ts` (mới) + `.test.ts` | Trường log 409 (`stage`, `lag_ms`, `same_instant`) |
| `src/app/api/tasks/[id]/route.ts`, `src/app/api/enrollment/[id]/route.ts` (sửa) | Log cả hai nhánh 409 |
| `src/lib/server-error-log.ts` (mới) + `.test.ts` | Trường log lỗi an toàn |
| `src/app/api/tasks/route.ts` (sửa) | Log 500 của `GET` |
| `src/lib/tasks/notifications.ts` (sửa), `src/lib/tasks/notification-delivery.test.ts` (sửa) | Broadcast hỏng không thành "không gửi được thông báo" |
| `changelog.md` (sửa) | Entry cho Task 1, 2, 5 |

---

### Task 1: Gửi lại tới 4 lượt khi 409 mà trường đang sửa không ai đụng

**Files:**
- Modify: `src/lib/collaboration/conflict-retry.ts` (thêm vào cuối file)
- Create: `src/lib/collaboration/conflict-retry.test.ts`
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:96-99` (import), `:1529-1532`, `:1562`
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:161-164` (import), `:1631-1634`, `:1677`
- Modify: `changelog.md`

**Interfaces:**
- Produces: `MAX_CONFLICT_ATTEMPTS: number` (= 4), `shouldRetryConflict(attempt: number, fieldsUntouched: boolean): boolean`.

Không đụng vòng gán/bỏ người (`TaskBoardClient.tsx:1737`): vòng đó dùng `assigneeChangeAlreadyApplied`, và 2/2 lượt 409 của assignees đều lưu được.

- [ ] **Step 1: Viết test fail**

Tạo `src/lib/collaboration/conflict-retry.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MAX_CONFLICT_ATTEMPTS, shouldRetryConflict } from "./conflict-retry";

describe("shouldRetryConflict", () => {
  it("gives the first send plus one retry per parallel background upload", () => {
    // runBackgroundUploads tải tối đa 3 file cùng lúc; mỗi file vào là
    // updated_at nhảy một lần (task 56093378, 2026-10-14).
    expect(MAX_CONFLICT_ATTEMPTS).toBe(4);
  });

  it("retries while attempts remain and nobody touched the patched fields", () => {
    for (let attempt = 0; attempt < MAX_CONFLICT_ATTEMPTS - 1; attempt += 1) {
      expect(shouldRetryConflict(attempt, true)).toBe(true);
    }
  });

  it("stops after the last attempt", () => {
    expect(shouldRetryConflict(MAX_CONFLICT_ATTEMPTS - 1, true)).toBe(false);
  });

  it("never retries when someone else changed one of the patched fields", () => {
    expect(shouldRetryConflict(0, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, phải fail**

Run: `npx vitest run src/lib/collaboration/conflict-retry.test.ts`
Expected: FAIL. Lỗi import kiểu `MAX_CONFLICT_ATTEMPTS is not exported` / `shouldRetryConflict is not a function`.

- [ ] **Step 3: Thêm code vào cuối `src/lib/collaboration/conflict-retry.ts`**

```ts
/**
 * Số lượt gửi tối đa của MỘT lượt sửa bị 409: lượt đầu + các lượt gửi lại.
 *
 * Trước đây là 2, không đủ khi file đính kèm vào nối tiếp nhau: tạo task kèm 3
 * file (`runBackgroundUploads`, 3 file cùng lúc), mỗi file vào là `updated_at`
 * nhảy một lần, nên lượt gửi lại cũng 409 và việc người dùng vừa làm bị bỏ
 * (task 56093378, 2026-10-14). 4 = lượt đầu + mỗi file một lượt.
 *
 * Gửi lại nhiều lần vẫn an toàn: lượt nào cũng phải qua `canRetryAfterConflict`
 * với bản mới nhất vừa đọc, nên không bao giờ đè lên trường người khác vừa sửa.
 */
export const MAX_CONFLICT_ATTEMPTS = 4;

/** Lượt `attempt` (đếm từ 0) vừa bị 409: có gửi lại không. */
export function shouldRetryConflict(attempt: number, fieldsUntouched: boolean): boolean {
  return fieldsUntouched && attempt + 1 < MAX_CONFLICT_ATTEMPTS;
}
```

- [ ] **Step 4: Chạy test, phải pass**

Run: `npx vitest run src/lib/collaboration/conflict-retry.test.ts src/lib/tasks/conflict-retry.test.ts src/lib/enrollment/optimistic-patch.test.ts`
Expected: PASS hết.

- [ ] **Step 5: Dùng trong `patchTask`**

`TaskBoardClient.tsx`, ngay dưới khối import `@/lib/tasks/conflict-retry` (dòng 96–99), thêm:
```ts
import {
  MAX_CONFLICT_ATTEMPTS,
  shouldRetryConflict,
} from "@/lib/collaboration/conflict-retry";
```
Dòng 1529–1532, thay:
```ts
        // Tối đa hai lượt, như patchRecord của Enrollment (6da7ee0): 409 mà không
        // ai đụng các trường của lượt này (mốc giờ bị đẩy lên vì comment, file...)
        // thì gửi lại MỘT lần với bản mới nhất, thay vì bỏ việc người dùng vừa làm.
        for (let attempt = 0; attempt < 2; attempt += 1) {
```
bằng:
```ts
        // Tối đa MAX_CONFLICT_ATTEMPTS lượt, như patchRecord của Enrollment: 409
        // mà không ai đụng các trường của lượt này (mốc giờ bị đẩy lên vì comment,
        // file...) thì gửi lại với bản mới nhất, thay vì bỏ việc người dùng vừa làm.
        for (let attempt = 0; attempt < MAX_CONFLICT_ATTEMPTS; attempt += 1) {
```
Dòng 1562, thay:
```ts
                if (attempt === 0 && canRetryTaskPatchAfterConflict(patch, baseline, canonical)) {
```
bằng:
```ts
                if (
                  shouldRetryConflict(
                    attempt,
                    canRetryTaskPatchAfterConflict(patch, baseline, canonical),
                  )
                ) {
```

- [ ] **Step 6: Dùng trong `patchRecord`**

`EnrollmentClient.tsx`, ngay dưới khối import `@/lib/enrollment/optimistic-patch` (dòng 161–164), thêm:
```ts
import {
  MAX_CONFLICT_ATTEMPTS,
  shouldRetryConflict,
} from "@/lib/collaboration/conflict-retry";
```
Dòng 1631–1634, thay:
```ts
        // Tối đa hai lượt: 409 mà không ai đụng tới các trường này (mốc giờ bị
        // đẩy lên bởi upload file, reaction...) thì gửi lại MỘT lần với bản mới
        // nhất, thay vì bỏ việc người dùng vừa làm — xem canRetryAfterConflict.
        for (let attempt = 0; attempt < 2; attempt += 1) {
```
bằng:
```ts
        // Tối đa MAX_CONFLICT_ATTEMPTS lượt: 409 mà không ai đụng tới các trường
        // này (mốc giờ bị đẩy lên bởi upload file, reaction...) thì gửi lại với
        // bản mới nhất, thay vì bỏ việc người dùng vừa làm — xem canRetryAfterConflict.
        for (let attempt = 0; attempt < MAX_CONFLICT_ATTEMPTS; attempt += 1) {
```
Dòng 1677, thay:
```ts
          if (attempt === 0 && canRetryAfterConflict(patch, baseline, canonical)) continue;
```
bằng:
```ts
          if (shouldRetryConflict(attempt, canRetryAfterConflict(patch, baseline, canonical))) continue;
```

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npx eslint "src/app/(authed)/tasks/_components/TaskBoardClient.tsx" "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" src/lib/collaboration/conflict-retry.ts`
Expected: không lỗi.
Kiểm thêm: `grep -n "attempt === 0 &&" "src/app/(authed)/tasks/_components/TaskBoardClient.tsx" "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"` không còn kết quả nào.

- [ ] **Step 8: Changelog**

Thêm vào đầu `changelog.md`, ngay dưới đoạn giới thiệu:
```md
## 2026-10-17 — Sửa lỗi từ audit log Vercel (plan `2026-10-17-vercel-log-fixes.md`)

- **409 gửi lại tới 4 lượt** (`MAX_CONFLICT_ATTEMPTS`, `shouldRetryConflict`): `patchTask` và
  `patchRecord` trước chỉ gửi lại 1 lần khi 409 mà trường đang sửa không ai đụng. Tạo task kèm 3 file
  rồi sửa ngay thì mỗi file vào lại đẩy `updated_at`, lượt gửi lại cũng 409 và người dùng mất lượt sửa
  (task 56093378, 14/10). Vẫn qua `canRetryAfterConflict` ở mọi lượt nên không đè thay đổi của người khác.
```

- [ ] **Step 9: Commit (chỉ khi user đã bảo)**

```bash
git add src/lib/collaboration/conflict-retry.ts src/lib/collaboration/conflict-retry.test.ts "src/app/(authed)/tasks/_components/TaskBoardClient.tsx" "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" changelog.md
git commit -m "fix(collab): retry a field-safe 409 up to four times"
```

---

### Task 2: File gắn comment của Enrollment không chạm hồ sơ lần nữa

**Files:**
- Create: `src/lib/enrollment/attachment-touch.ts`
- Create: `src/lib/enrollment/attachment-touch.test.ts`
- Modify: `src/app/api/enrollment/[id]/attachments/route.ts:280-286` (+ import)
- Modify: `changelog.md`

**Interfaces:**
- Produces: `attachmentTouchesRecord(commentId: string | null): boolean`.

Ngoài phạm vi: route xoá file `src/app/api/enrollment/[id]/attachments/[aid]/route.ts:63` vẫn chạm như cũ. Log không có ca 409 nào sau khi xoá file.

- [ ] **Step 1: Viết test fail**

Tạo `src/lib/enrollment/attachment-touch.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attachmentTouchesRecord } from "./attachment-touch";

describe("attachmentTouchesRecord", () => {
  it("touches the record for a standalone attachment", () => {
    expect(attachmentTouchesRecord(null)).toBe(true);
  });

  it("does not touch again for a comment attachment: the comment already did", () => {
    expect(attachmentTouchesRecord("2a3632fa-1c2a-4ab2-a24e-1fbcb7599bb3")).toBe(false);
  });

  // Task và Enrollment phải cùng một luật. Bên Task luật nằm trong SQL: chỉ cập
  // nhật `tasks` khi file không gắn comment. Ai đổi một bên thì test này nhắc bên kia.
  it("matches the Task rule in create_task_attachment_atomic", () => {
    const schema = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8");
    const start = schema.lastIndexOf("create or replace function create_task_attachment_atomic(");
    expect(start).toBeGreaterThan(-1);
    const body = schema.slice(start, schema.indexOf("$$;", start));
    expect(body).toMatch(/if p_comment_id is null then\s+v_now := [^;]+;\s+update tasks/);
  });
});
```

- [ ] **Step 2: Chạy test, phải fail**

Run: `npx vitest run src/lib/enrollment/attachment-touch.test.ts`
Expected: FAIL với `Failed to resolve import "./attachment-touch"`.

- [ ] **Step 3: Tạo `src/lib/enrollment/attachment-touch.ts`**

```ts
/**
 * Upload file vào Enrollment có đẩy `updated_at` của hồ sơ không (qua RPC
 * `enrollment_touch_activity`).
 *
 * File gắn vào comment: KHÔNG. Comment vừa tạo (`create_enrollment_comment_idempotent`)
 * đã đẩy `updated_at` + `last_activity_at` và trả mốc mới cho trình duyệt. Đẩy
 * thêm lần nữa thì mốc trình duyệt đang giữ cũ đi mà nó không biết, và lượt sửa
 * kế tiếp bị 409 (10/11 lượt 409 Enrollment tuần 10–17/10/2026). Task làm y như
 * vậy: `create_task_attachment_atomic` chỉ cập nhật `tasks` khi
 * `p_comment_id is null`.
 */
export function attachmentTouchesRecord(commentId: string | null): boolean {
  return commentId === null;
}
```

- [ ] **Step 4: Chạy test, phải pass**

Run: `npx vitest run src/lib/enrollment/attachment-touch.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Dùng trong route**

`src/app/api/enrollment/[id]/attachments/route.ts`, thêm import cạnh các import `@/lib/enrollment/...`:
```ts
import { attachmentTouchesRecord } from "@/lib/enrollment/attachment-touch";
```
Dòng 280–286, thay:
```ts
  const warnings: string[] = [];
  const { error: touchError } = await context.supabase.rpc("enrollment_touch_activity", {
    p_record_id: id,
    p_actor_email: context.actor.email,
    p_now: new Date().toISOString(),
  });
  if (touchError) warnings.push(`Attachment activity touch failed: ${touchError.message}`);
```
bằng:
```ts
  const warnings: string[] = [];
  if (attachmentTouchesRecord(commentId)) {
    const { error: touchError } = await context.supabase.rpc("enrollment_touch_activity", {
      p_record_id: id,
      p_actor_email: context.actor.email,
      p_now: new Date().toISOString(),
    });
    if (touchError) warnings.push(`Attachment activity touch failed: ${touchError.message}`);
  }
```
`commentId` đã có sẵn ở dòng 93 (`string | null`). Khối `after()` bên dưới vẫn giữ nguyên: broadcast `broadcastEnrollmentChanged` + `broadcastEnrollmentRoom` vẫn chạy cho mọi file, nên các tab khác vẫn thấy file mới.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npx eslint "src/app/api/enrollment/[id]/attachments/route.ts" src/lib/enrollment/attachment-touch.ts`
Expected: không lỗi.

- [ ] **Step 7: Changelog**

Thêm một gạch đầu dòng vào entry `2026-10-17 — Sửa lỗi từ audit log Vercel` (đã tạo ở Task 1):
```md
- **File gắn comment của Enrollment không gọi `enrollment_touch_activity` nữa**
  (`attachmentTouchesRecord`): comment vừa tạo đã đẩy `updated_at`/`last_activity_at`; lần chạm thứ hai
  làm mốc của trình duyệt cũ đi và lượt sửa ngay sau bị 409. Giống Task (`create_task_attachment_atomic`
  chỉ cập nhật `tasks` khi file không gắn comment). File không gắn comment vẫn chạm như cũ.
```

- [ ] **Step 8: Commit (chỉ khi user đã bảo)**

```bash
git add src/lib/enrollment/attachment-touch.ts src/lib/enrollment/attachment-touch.test.ts "src/app/api/enrollment/[id]/attachments/route.ts" changelog.md
git commit -m "fix(enrollment): comment attachments no longer bump the record twice"
```

---

### Task 3: Log mọi 409 kèm `stage`, `lag_ms`, `same_instant`

**Files:**
- Create: `src/lib/collaboration/conflict-log.ts`
- Create: `src/lib/collaboration/conflict-log.test.ts`
- Modify: `src/app/api/tasks/[id]/route.ts:243-248` (precheck), `:610` (write) + import
- Modify: `src/app/api/enrollment/[id]/route.ts:166-171` (precheck), `:548` (write) + import

**Interfaces:**
- Produces: `toEpochMicros(value: string): number | null`; `conflictLogFields(input: { route: string; id: string; stage: "precheck" | "write"; expected: string; current?: string | null }): { route: string; id: string; stage: "precheck" | "write"; lag_ms: number | null; same_instant: boolean | null }`.

Giữ nguyên message `"mutation.conflict"` để lệnh đếm cũ vẫn chạy.

- [ ] **Step 1: Viết test fail**

Tạo `src/lib/collaboration/conflict-log.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { conflictLogFields, toEpochMicros } from "./conflict-log";

describe("toEpochMicros", () => {
  it("keeps microseconds that Date.parse would drop", () => {
    const a = toEpochMicros("2026-10-14T16:26:55.478159+00:00");
    const b = toEpochMicros("2026-10-14T16:26:55.478160+00:00");
    expect(a).not.toBeNull();
    expect(b! - a!).toBe(1);
  });

  it("reads the PostgREST JSON form and the Postgres text form as the same instant", () => {
    expect(toEpochMicros("2026-10-15T19:41:23.544+00:00")).toBe(
      toEpochMicros("2026-10-15 19:41:23.544+00"),
    );
    expect(toEpochMicros("2026-10-15T19:41:23.544Z")).toBe(
      toEpochMicros("2026-10-15T19:41:23.544+00:00"),
    );
  });

  it("returns null for anything that is not a timestamp", () => {
    expect(toEpochMicros("not a date")).toBeNull();
  });
});

describe("conflictLogFields", () => {
  it("reports how far the client token is behind the server", () => {
    expect(
      conflictLogFields({
        route: "tasks.update",
        id: "t1",
        stage: "precheck",
        expected: "2026-10-14T12:47:47.548922+00:00",
        current: "2026-10-14T12:47:53.867545+00:00",
      }),
    ).toEqual({
      route: "tasks.update",
      id: "t1",
      stage: "precheck",
      lag_ms: 6319,
      same_instant: false,
    });
  });

  it("flags the same instant written differently (string compare refused it)", () => {
    const fields = conflictLogFields({
      route: "enrollment.update",
      id: "r1",
      stage: "precheck",
      expected: "2026-10-15T19:41:23.544Z",
      current: "2026-10-15T19:41:23.544+00:00",
    });
    expect(fields.lag_ms).toBe(0);
    expect(fields.same_instant).toBe(true);
  });

  it("leaves lag unknown at the write stage, where the RPC does not return the current value", () => {
    expect(
      conflictLogFields({ route: "tasks.update", id: "t1", stage: "write", expected: "2026-10-14T12:47:47.548922+00:00" }),
    ).toEqual({ route: "tasks.update", id: "t1", stage: "write", lag_ms: null, same_instant: null });
  });
});
```

- [ ] **Step 2: Chạy test, phải fail**

Run: `npx vitest run src/lib/collaboration/conflict-log.test.ts`
Expected: FAIL với `Failed to resolve import "./conflict-log"`.

- [ ] **Step 3: Tạo `src/lib/collaboration/conflict-log.ts`**

```ts
/**
 * Trường log cho một lượt 409 của khoá lạc quan (`expected_updated_at`).
 *
 * `lag_ms` = server mới hơn token của client bao lâu. Vài giây: đua với comment
 * hoặc file vừa vào. Vài phút: client lỡ một lần cập nhật. `same_instant` = cùng
 * thời điểm mà chuỗi khác nhau, tức precheck so chuỗi đã chặn nhầm. Không ghi
 * email hay nội dung, chỉ id bản ghi như log `mutation.conflict` trước đây.
 */
export type ConflictStage = "precheck" | "write";

const TIMESTAMP_RE =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

function isoZone(zone: string): string {
  if (zone === "Z") return "Z";
  const digits = zone.slice(1).replace(":", "");
  return `${zone[0]}${digits.slice(0, 2)}:${digits.slice(2, 4) || "00"}`;
}

/**
 * Chuỗi timestamptz (JSON của PostgREST hoặc dạng text của Postgres, tới 6 chữ
 * số lẻ) → micro giây kể từ epoch. `Date.parse` chỉ giữ mili giây, mà
 * `updated_at` hay chỉ hơn nhau 1 µs (`updated_at + interval '1 microsecond'`).
 */
export function toEpochMicros(value: string): number | null {
  const match = TIMESTAMP_RE.exec(value.trim());
  if (!match) return null;
  const [, date, time, fraction = "", zone] = match;
  const millis = Date.parse(`${date}T${time}${isoZone(zone)}`);
  if (Number.isNaN(millis)) return null;
  return millis * 1000 + Number(fraction.padEnd(6, "0"));
}

export function conflictLogFields(input: {
  route: string;
  id: string;
  stage: ConflictStage;
  expected: string;
  current?: string | null;
}): {
  route: string;
  id: string;
  stage: ConflictStage;
  lag_ms: number | null;
  same_instant: boolean | null;
} {
  const expected = toEpochMicros(input.expected);
  const current = input.current ? toEpochMicros(input.current) : null;
  const lagMicros = expected !== null && current !== null ? current - expected : null;
  return {
    route: input.route,
    id: input.id,
    stage: input.stage,
    lag_ms: lagMicros === null ? null : Math.round(lagMicros / 1000),
    same_instant: lagMicros === null ? null : lagMicros === 0,
  };
}
```

- [ ] **Step 4: Chạy test, phải pass**

Run: `npx vitest run src/lib/collaboration/conflict-log.test.ts`
Expected: PASS (6 test).

- [ ] **Step 5: Log ở route Task**

`src/app/api/tasks/[id]/route.ts`, thêm import:
```ts
import { conflictLogFields } from "@/lib/collaboration/conflict-log";
```
Dòng 243–248, thay:
```ts
  if (expectedUpdatedAt !== r.task.updated_at) {
    return NextResponse.json(
```
bằng:
```ts
  if (expectedUpdatedAt !== r.task.updated_at) {
    console.warn(
      "mutation.conflict",
      conflictLogFields({
        route: "tasks.update",
        id,
        stage: "precheck",
        expected: expectedUpdatedAt,
        current: r.task.updated_at,
      }),
    );
    return NextResponse.json(
```
Dòng 609–610, thay:
```ts
      // Chỉ id, không nội dung: đếm số 409 trước/sau khi đổi giao diện.
      console.warn("mutation.conflict", { route: "tasks.update", id });
```
bằng:
```ts
      // Chỉ id + độ lệch thời gian, không nội dung (xem conflictLogFields).
      console.warn(
        "mutation.conflict",
        conflictLogFields({ route: "tasks.update", id, stage: "write", expected: expectedUpdatedAt }),
      );
```

- [ ] **Step 6: Log ở route Enrollment**

`src/app/api/enrollment/[id]/route.ts`, thêm import:
```ts
import { conflictLogFields } from "@/lib/collaboration/conflict-log";
```
Dòng 166–167, thay:
```ts
  if (current.updated_at !== expectedUpdatedAt) {
    return NextResponse.json(
```
bằng:
```ts
  if (current.updated_at !== expectedUpdatedAt) {
    console.warn(
      "mutation.conflict",
      conflictLogFields({
        route: "enrollment.update",
        id,
        stage: "precheck",
        expected: expectedUpdatedAt,
        current: current.updated_at,
      }),
    );
    return NextResponse.json(
```
Dòng 547–548, thay:
```ts
      // Chỉ id, không nội dung: đếm số 409 trước/sau khi đổi giao diện.
      console.warn("mutation.conflict", { route: "enrollment.update", id });
```
bằng:
```ts
      // Chỉ id + độ lệch thời gian, không nội dung (xem conflictLogFields).
      console.warn(
        "mutation.conflict",
        conflictLogFields({ route: "enrollment.update", id, stage: "write", expected: expectedUpdatedAt }),
      );
```

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npx eslint "src/app/api/tasks/[id]/route.ts" "src/app/api/enrollment/[id]/route.ts" src/lib/collaboration/conflict-log.ts`
Expected: không lỗi.

- [ ] **Step 8: Commit (chỉ khi user đã bảo)**

```bash
git add src/lib/collaboration/conflict-log.ts src/lib/collaboration/conflict-log.test.ts "src/app/api/tasks/[id]/route.ts" "src/app/api/enrollment/[id]/route.ts"
git commit -m "chore(logs): log every optimistic 409 with stage and token lag"
```

---

### Task 4: `GET /api/tasks` lỗi 500 thì ghi log

**Files:**
- Create: `src/lib/server-error-log.ts`
- Create: `src/lib/server-error-log.test.ts`
- Modify: `src/app/api/tasks/route.ts:58-99` (+ import)

**Interfaces:**
- Produces: `safeErrorFields(error: unknown): { name: string; code: string | null; message: string }`.

Response HTTP giữ nguyên (body, status, `Server-Timing`). Nhánh 503 `TASK_LIST_TRUNCATED` không log thêm: nó đã có mã riêng trong body.

- [ ] **Step 1: Viết test fail**

Tạo `src/lib/server-error-log.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { safeErrorFields } from "./server-error-log";

describe("safeErrorFields", () => {
  it("keeps name, PostgREST code and message", () => {
    const error = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });
    expect(safeErrorFields(error)).toEqual({
      name: "Error",
      code: "57014",
      message: "canceling statement due to statement timeout",
    });
  });

  it("cuts long messages to 300 characters", () => {
    const fields = safeErrorFields(new Error("x".repeat(1000)));
    expect(fields.message).toHaveLength(300);
  });

  it("handles thrown non-errors without leaking the value", () => {
    expect(safeErrorFields({ email: "a@b.com" })).toEqual({
      name: "unknown",
      code: null,
      message: "non-Error thrown",
    });
  });
});
```

- [ ] **Step 2: Chạy test, phải fail**

Run: `npx vitest run src/lib/server-error-log.test.ts`
Expected: FAIL với `Failed to resolve import "./server-error-log"`.

- [ ] **Step 3: Tạo `src/lib/server-error-log.ts`**

```ts
const MAX_MESSAGE_LENGTH = 300;

/**
 * Trường an toàn để log một lỗi server: tên, mã lỗi PostgREST/Postgres (nếu có),
 * message đã cắt ngắn. Không log nguyên object: object không phải Error có thể
 * chứa email, body hoặc token.
 */
export function safeErrorFields(error: unknown): {
  name: string;
  code: string | null;
  message: string;
} {
  if (!(error instanceof Error)) {
    return { name: "unknown", code: null, message: "non-Error thrown" };
  }
  const code = (error as { code?: unknown }).code;
  return {
    name: error.name,
    code: typeof code === "string" ? code : null,
    message: error.message.slice(0, MAX_MESSAGE_LENGTH),
  };
}
```

- [ ] **Step 4: Chạy test, phải pass**

Run: `npx vitest run src/lib/server-error-log.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Dùng trong `GET`**

`src/app/api/tasks/route.ts`, thêm import cạnh `import { RouteTiming } from "@/lib/server-timing";`:
```ts
import { safeErrorFields } from "@/lib/server-error-log";
```
Trong `GET()`, ngay trên `try {` (dòng 66), thêm:
```ts
  // Bước đang chạy khi lỗi, để log 500 nói được hỏng ở auth hay ở nạp task.
  let stage: "auth" | "tasks" = "auth";
```
Ngay trước `const page = await timing.measure("tasks", async () =>`, thêm:
```ts
    stage = "tasks";
```
Cuối catch, thay:
```ts
    return respond(
      { error: error instanceof Error ? error.message : "Could not load tasks." },
      500,
    );
```
bằng:
```ts
    console.error("tasks.list.failed", { stage, status: 500, ...safeErrorFields(error) });
    return respond(
      { error: error instanceof Error ? error.message : "Could not load tasks." },
      500,
    );
```

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npx eslint src/app/api/tasks/route.ts src/lib/server-error-log.ts`
Expected: không lỗi.

- [ ] **Step 7: Commit (chỉ khi user đã bảo)**

```bash
git add src/lib/server-error-log.ts src/lib/server-error-log.test.ts src/app/api/tasks/route.ts
git commit -m "chore(logs): log the stage and error code when the task list returns 500"
```

---

### Task 5: Realtime hỏng sau khi đã ghi thông báo thì không thành warning `notification_failed`

**Files:**
- Modify: `src/lib/tasks/notifications.ts:102-132` (`insertNotifications`)
- Modify: `src/lib/tasks/notification-delivery.test.ts:81-86` (+ thêm 1 test)
- Modify: `changelog.md`

**Interfaces:**
- Consumes: `broadcastNotif(emails: string[]): Promise<boolean>` từ `@/lib/tasks/realtime`, `schedulePush` (có sẵn trong file).
- Produces: `insertNotifications` vẫn là `Promise<boolean>` để 12 chỗ gọi không phải sửa. Từ giờ: `true` = đã ghi dòng; ghi hỏng thì **throw** (như cũ).

Lý do: 12 chỗ gọi bọc nó trong `settleSideEffects` với code `notification_failed` và câu "some people may not have been notified". `settleSideEffects` coi `false` là thất bại. Nhưng `false` hiện chỉ có nghĩa là ping realtime hỏng, còn dòng đã nằm trong DB và chuông vẫn thấy ở lượt poll kế tiếp (`POLL_REALTIME_MS` = 120 s, fallback 30 s). Đường `deliverAfterResponse` đã xử lý đúng: log `task.notification.delivery_failed` và trả `true`. Task này cho đường inline làm giống vậy.

- [ ] **Step 1: Sửa test cũ + thêm test (fail)**

`src/lib/tasks/notification-delivery.test.ts`, thay test ở dòng 81–86:
```ts
  it("keeps the old behaviour without the option: waits for the broadcast", async () => {
    mocks.broadcastNotif.mockResolvedValue(false);

    await expect(insertNotifications([taskRow])).resolves.toBe(false);
    expect(mocks.broadcastNotif).toHaveBeenCalledTimes(1);
  });
```
bằng:
```ts
  it("inline: a failed broadcast is logged, not reported as a lost notification", async () => {
    mocks.broadcastNotif.mockResolvedValue(false);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(insertNotifications([taskRow])).resolves.toBe(true);
    expect(mocks.broadcastNotif).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("task.notification.delivery_failed", {
      taskIds: ["task-1"],
      stage: "broadcast",
    });
    error.mockRestore();
  });

  it("inline: a throwing broadcast does not reject once the rows are written", async () => {
    mocks.broadcastNotif.mockRejectedValue(new Error("missing topic secret"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(insertNotifications([taskRow])).resolves.toBe(true);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("task.notification.delivery_failed", {
      taskIds: ["task-1"],
      stage: "broadcast",
      error: "missing topic secret",
    });
    error.mockRestore();
  });
```

- [ ] **Step 2: Chạy test, phải fail**

Run: `npx vitest run src/lib/tasks/notification-delivery.test.ts`
Expected: 2 test mới FAIL (test 1 nhận `false` thay vì `true`; test 2 bị reject với "missing topic secret"). Các test khác PASS.

- [ ] **Step 3: Sửa `insertNotifications`**

`src/lib/tasks/notifications.ts`, thay đoạn từ `// Realtime "ping" so recipients' open tabs toast instantly` đến hết hàm:
```ts
  // Realtime "ping" so recipients' open tabs toast instantly (content stays in DB).
  const broadcast = await broadcastNotif(rows.map((r) => r.recipient_email));

  // Và đẩy ra ngoài trình duyệt cho ai không mở tab. Service worker tự bỏ qua
  // khi người nhận đang nhìn portal, nên không kêu hai lần.
  await schedulePush(async () => {
    const { pushForTaskNotifications } = await import("@/lib/notifications/push-dispatch");
    await pushForTaskNotifications(rows);
  });

  return broadcast;
}
```
bằng:
```ts
  // Realtime "ping" so recipients' open tabs toast instantly (content stays in DB).
  // Dòng đã ghi xong ở trên, nên ping hỏng KHÔNG phải "không báo được": chuông
  // vẫn thấy ở lượt poll kế tiếp. Chỉ ghi log như deliverTaskNotifications, đừng
  // trả false — settleSideEffects sẽ biến nó thành warning `notification_failed`
  // ("some people may not have been notified"), sai với thực tế (log 2026-10-14).
  const taskIds = [...new Set(rows.map((row) => row.task_id))];
  try {
    const delivered = await broadcastNotif(rows.map((r) => r.recipient_email));
    if (!delivered) {
      console.error("task.notification.delivery_failed", { taskIds, stage: "broadcast" });
    }
  } catch (error) {
    console.error("task.notification.delivery_failed", {
      taskIds,
      stage: "broadcast",
      error: error instanceof Error ? error.message : "unknown error",
    });
  }

  // Và đẩy ra ngoài trình duyệt cho ai không mở tab. Service worker tự bỏ qua
  // khi người nhận đang nhìn portal, nên không kêu hai lần.
  await schedulePush(async () => {
    const { pushForTaskNotifications } = await import("@/lib/notifications/push-dispatch");
    await pushForTaskNotifications(rows);
  });

  return true;
}
```
Cập nhật JSDoc của `insertNotifications` (nếu có; nếu chưa có thì thêm ngay trên `export async function insertNotifications(`):
```ts
/**
 * Ghi dòng thông báo rồi phát đi (realtime + push). Trả `true` khi đã ghi dòng;
 * ghi hỏng thì throw. Phát đi hỏng chỉ ghi log `task.notification.delivery_failed`.
 */
```

- [ ] **Step 4: Chạy test, phải pass**

Run: `npx vitest run src/lib/tasks/notification-delivery.test.ts src/lib/tasks/notifications.test.ts`
Expected: PASS hết.

- [ ] **Step 5: Kiểm chỗ gọi không dựa vào `false`**

Run: `grep -rn "insertNotifications(" src --include='*.ts' | grep -v test` (giữ dấu nháy quanh `*.ts`: zsh tự bung glob)
Expected: 12 chỗ (`tasks/route.ts:414`, `tasks/[id]/route.ts:634`, `comments/route.ts:217`, `comments/[cid]/route.ts:166`, `reactions/route.ts:111`, `overdue-unlock/route.ts:169`, `assignees/[email]/route.ts:137`, `assignees/route.ts:173`, `assign/route.ts:103`, `attachments/route.ts:344`, `reopen/route.ts:127`, `cron/check-overdue/route.ts:308`). Mở từng chỗ, xác nhận kết quả chỉ được `return` vào `settleSideEffects`, hoặc `await` rồi bỏ qua, hoặc nằm trong `Promise.allSettled`. **Không** chỗ nào rẽ nhánh theo `=== false` để làm việc khác. Có chỗ nào rẽ nhánh như vậy thì dừng lại, báo user.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npx eslint src/lib/tasks/notifications.ts src/lib/tasks/notification-delivery.test.ts`
Expected: không lỗi.

- [ ] **Step 7: Changelog**

Thêm vào entry `2026-10-17 — Sửa lỗi từ audit log Vercel`:
```md
- **Realtime hỏng không còn bị báo là "không gửi được thông báo"** (`insertNotifications`, đường
  inline): dòng thông báo đã ghi trước khi ping, nên ping hỏng/throw chỉ ghi log
  `task.notification.delivery_failed` và hàm trả `true`, giống đường `deliverAfterResponse`. Mutation
  không còn warning `notification_failed` sai. Ghi dòng hỏng thì vẫn throw như cũ.
```

- [ ] **Step 8: Commit (chỉ khi user đã bảo)**

```bash
git add src/lib/tasks/notifications.ts src/lib/tasks/notification-delivery.test.ts changelog.md
git commit -m "fix(notifications): a failed realtime ping is not a lost notification"
```

---

### Task 6: Kiểm toàn bộ, deploy, theo dõi

- [ ] **Step 1: Chạy toàn bộ test + build**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: tất cả pass. Nếu một test fail mà file test đó không nằm trong plan, và không import file nào plan sửa, thì đó là lỗi có sẵn (có thể từ WIP của người khác trong working tree): báo user, **không** sửa, **không** `git stash`.

- [ ] **Step 2: Thử tay trên localhost (dữ liệu production thật, xem Global Constraints)**

1. Tạo task kèm 3 file, mỗi file vài MB. Lúc file đang tải thì đổi Priority rồi Status. Kỳ vọng: cả hai lượt sửa được lưu, không hiện "Someone else changed this task". Network tab có thể thấy 409 rồi PATCH lại thành 200, tổng không quá 4 PATCH cho mỗi lượt sửa.
2. Mở một hồ sơ Enrollment, gửi comment kèm 1 file, rồi đổi ngay một trường. Kỳ vọng: PATCH 200 ở lượt đầu, không có 409.
3. Archive task/hồ sơ vừa thử.

- [ ] **Step 3: Deploy, chỉ khi user bảo**

Theo quy trình hiện tại (memory `feedback_deploy`, `project_other_agents_push`): `git fetch --all`, xem `git log` của `origin/main` và `vercel/main` (Codex/Sol cũng push) rồi mới push. Trong plan này không có rollout SQL nào.

- [ ] **Step 4: Theo dõi 3–7 ngày sau deploy**

```bash
# 409 theo route — so với 29 lượt / 7 ngày trước khi sửa
vercel logs requests --environment production --since 7d -q 'httpStatus = 409' -n 500 --json
# log 409 mới: có stage / lag_ms / same_instant
vercel logs --environment production --since 7d -q 'level:warn' -n 2000 --json | grep mutation.conflict
# 500 của danh sách task, nếu có
vercel logs --environment production --since 7d -q 'level:error' -n 2000 --json | grep tasks.list.failed
# warning notification_failed sai thì không còn; broadcast hỏng hiện dưới dạng này
vercel logs --environment production --since 7d -q 'level:error' -n 2000 --json | grep task.notification.delivery_failed
```
Đọc kết quả:
- 409 Enrollment sau comment kèm file phải gần như hết.
- `same_instant: true` ở bất kỳ dòng nào → precheck so chuỗi đang chặn nhầm. Báo user, đề xuất so theo `toEpochMicros` thay vì `!==`.
- `stage: "precheck"` với `lag_ms` lớn (> 60.000) → client lỡ cập nhật (ca mục 3.4). Báo user kèm id để lần theo.
- Còn 409 sau upload file Task không gắn comment mà lượt sửa vẫn mất → làm mục 5.1.

---

## 5. Để sau — chưa có task, chờ số liệu hoặc user chọn

Số liệu từ 14/10 (sau khi chuyển syd1) tới 17/10, khoảng 3,5 ngày. Chi phí Vercel khoảng $3/tháng, nên các mục này chỉ đáng làm nếu nhanh hơn cho người dùng hoặc có lỗi đi kèm.

1. **Upload file trả mốc `updated_at` mới** (cần SQL): `create_task_attachment_atomic` và `enrollment_touch_activity` trả thêm `parent_updated_at` + `previous_updated_at`. Client chỉ nâng mốc khi mốc đang giữ bằng `previous_updated_at`, để không nuốt thay đổi của người khác. Chỉ làm nếu Task 6 bước 4 vẫn thấy mất lượt sửa sau upload.
2. **Fetch SLA rules trùng** (Codex P2.2): 9.090 lượt, khoảng 2 lượt mỗi lần mở `/tasks` (4.729 lượt). Nguồn: lúc mount (`TaskBoardClient.tsx:988`) + `SUBSCRIBED` (`:999`), cộng mỗi lần tab hiện lại (`:1008`). p50 52 ms. Bỏ fetch lúc mount thì phải có fallback khi realtime không kết nối được.
3. **Dùng chung notification summary giữa chuông và board** (Codex P2.3): `/api/tasks/notifications` 36.526 lượt. Board gọi `?mode=summary` sau mỗi lần nạp danh sách (`TaskBoardClient.tsx:625`), chuông poll riêng (`NotificationBell.tsx`, 120 s / 30 s). p50 83 ms.
4. **Chỉ prefetch chi tiết task khi chuột dừng khoảng 150 ms** (`TaskCard.tsx:98`, `TaskRowItem.tsx:354` gọi `prefetchTaskDetail` ngay khi `onMouseEnter`): detail 17.138 lượt, trong khi số lần mở task (ước theo `notifications/read`) khoảng 2.776.
5. **Tối ưu danh sách task**: theo plan Phase B có sẵn (`2026-09-04-task-list-pagination.md`), chỉ làm khi có baseline (Codex P2.4).
6. **Vercel Skew Protection** (cấu hình project, gói Pro có): hết 404 chunk CSS cũ ngay sau deploy. Đổi cấu hình production nên phải hỏi user.
7. **`src/app/apple-icon.png`**: hết 404 `apple-touch-icon`. Cần ảnh icon từ user.
8. **Task search audit** (Codex P2.5): `src/lib/tasks/search.ts` nạp lịch sử `task_assignees`/`task_participants` không phân trang. Rủi ro thiếu kết quả, chưa thấy trong log.

## 6. Lệnh kiểm nhanh (chỉ đọc)

```bash
vercel ls agent-portal-vercel
vercel logs --environment production --since 24h -q 'level:error' -n 2000 --json
vercel logs --environment production --since 24h -q 'level:warn' -n 2000 --json
vercel logs requests --environment production --since 24h -q 'httpStatus >= 500' -n 2000 --json
vercel metrics vercel.function_invocation.ttfb_ms -a p95 --group-by route --prod --since 24h --json
vercel inspect <deployment-url> --logs
```
Ghi chú: KQL `a or b` giữa hai giá trị của cùng một trường trả rỗng, phải chạy từng lệnh. Một trang tối đa 10.000 dòng: đọc `summary.pagination.next` trước khi gọi là "toàn bộ". `function_duration_ms` tính cả thời gian `after()`, nên latency người dùng thấy phải đọc `ttfb_ms`.
