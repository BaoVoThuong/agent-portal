# Independent Code Review — Uncommitted Batch + RBAC Architecture

Date: 2026-08-02
Reviewer role: Senior Engineer / Tech Lead (production release gate)
Branch: `config` · HEAD `d9083cd` · Working tree: 51 files changed, +1213 / −450 (uncommitted)

> Đây là review **độc lập**, thách thức implementation của Codex — **không** mặc định code đúng.
> Batch uncommitted này thực thi 17 findings trong `docs/2026-08-01-health-task-enrollment-config-review.md`
> (bản review + fix do Codex tạo) **cộng** feature custom-column-value-editing.

---

## Mục lục

1. [Kết luận điều hành](#1-kết-luận-điều-hành)
2. [Baseline đã verify](#2-baseline-đã-verify)
3. [Phạm vi review](#3-phạm-vi-review)
4. [Findings — CRITICAL](#4-findings--critical)
5. [Findings — HIGH](#5-findings--high)
6. [Findings — MEDIUM](#6-findings--medium)
7. [Findings — LOW](#7-findings--low)
8. [Điểm Codex làm tốt (giữ nguyên)](#8-điểm-codex-làm-tốt-giữ-nguyên)
9. [Task 2 — RBAC architecture review](#9-task-2--rbac-architecture-review)
10. [Action plan theo ưu tiên](#10-action-plan-theo-ưu-tiên)
11. [Các quyết định cần chốt (đi qua từng câu)](#11-các-quyết-định-cần-chốt-đi-qua-từng-câu)

---

## 1. Kết luận điều hành

Chất lượng batch **khá cao**: Medicare sanitizer 3 tầng, import claim chống double-approve, attachment magic-byte, eligibility assignee — đều chắc, có test. `npm typecheck` + 416 test pass.

**Nhưng** rủi ro merge lớn nhất **không phải bug code** mà là **một quyết định sản phẩm bị Codex tự chốt**: enrollment bị đổi từ *shared queue* sang *scoped per-user* trong khi chính doc review liệt kê đó là **open question chưa trả lời**. Nếu nghiệp vụ thực tế là hàng đợi chung, bản này sẽ khiến ~50 agent mất gần hết record sau deploy.

Xếp hạng tổng thể trước merge: **KHÔNG merge cho tới khi chốt hướng scoping (mục 4.1)**; các bug HIGH/MEDIUM còn lại có fix rõ ràng.

---

## 2. Baseline đã verify

| Check | Kết quả |
|---|---|
| `npx tsc --noEmit` | exit 0 (sạch) |
| `npx vitest run` | 416 pass / 0 fail |
| `npm run lint` (theo doc) | 1 warning `_ariaDescribedBy` — đã fix trong batch |

Kết luận: batch **không gãy build/test**. Các vấn đề bên dưới là **logic / nghiệp vụ / kiến trúc**, không phải compile error.

---

## 3. Phạm vi review

Đã đọc: toàn bộ diff (3126 dòng) + 5 file mới:

- `src/app/(authed)/_shared/EditableCustomCell.tsx` (component sửa inline dùng chung)
- `src/lib/enrollment/program-fields.ts` + test (Medicare sanitizer)
- `src/lib/enrollment/access.test.ts` (unit test access model)
- `src/lib/table-config/export-access.test.ts`

Và các file nền: `access.ts`, `tasks/access.ts`, `assignees.ts`, `values.ts`, `import.ts`, `imports/[id]/route.ts`, `queries.ts`.

---

## 4. Findings — CRITICAL

### 4.1 — Enrollment bị đổi shared-queue → scoped per-user mà chưa xác nhận

**Severity: CRITICAL (product regression risk)**

**Bằng chứng:**
- `src/lib/enrollment/access.ts:36-45` — `canViewEnrollmentRecord`: worker chỉ xem được nếu là `caller_email` / `responsible_enroll_email` / `created_by_email`, hoặc thuộc `participantRecordIds`.
- `src/lib/enrollment/queries.ts:106-113` — `fetchEnrollmentRecords` fetch tất cả rồi **filter in-app** theo `canViewEnrollmentRecord`.
- `src/lib/enrollment/overview-data.ts:127-133` — **overview/dashboard KPI cũng bị scope** (`visibleRecords`).

**Vì sao là vấn đề:**
Chính `docs/2026-08-01-...md:622` ghi rõ đây là Open Question: *"Is enrollment intended to be a shared queue for every task.work user, or should ACA/Medicare records be scoped?"* — Codex **tự chọn scoped** và ship. Đây là quyết định nghiệp vụ, không phải kỹ thuật.

**Business impact:**
- Nếu enrollment thực tế là **hàng đợi chung** (ai rảnh nhận việc nấy — mô hình phổ biến cho team enrollment): sau deploy, mỗi agent **đột nhiên chỉ còn thấy record của chính mình** → gãy workflow, cháy support.
- Dashboard KPI mỗi người thấy một số khác nhau → không còn là KPI team.

**Khuyến nghị:** PHẢI chốt business intent trước merge (xem mục 11, Q1). Không thể tự quyết.
- Nếu **shared** → revert scope ở list/overview/detail (giữ lại các fix khác).
- Nếu **scoped** → giữ, nhưng bắt buộc kèm fix 5.1 (nguồn participant) + index + test.

---

## 5. Findings — HIGH

### 5.1 — "Participant" access dựa trên comment/notification quá mong manh

**Severity: HIGH (security model fragility)**

**Bằng chứng:** `src/lib/enrollment/access.ts:58-86` — `fetchEnrollmentParticipantRecordIds` suy quyền xem từ:
- `enrollment_comments.author_email` (đã comment), và
- `enrollment_notifications.recipient_email` (được notify/mention).

**Vì sao là vấn đề:**
1. **ACL ẩn, phình vô hạn, không thu hồi được**: được @mention 1 lần → xem record đó vĩnh viễn. Quyền truy cập PII không nên nằm trong bảng thông báo.
2. **Không bền**: nếu sau này prune `enrollment_notifications` để dọn DB → **mất quyền xem ngoài ý muốn**.
3. **Thiếu index**: query lọc `enrollment_comments.author_email` nhưng schema chỉ index `record_id` (`supabase/schema.sql:2369`). `recipient_email` thì có index (`:2456`). → seq scan `enrollment_comments` mỗi request của non-stakeholder worker.
4. **Không test tích hợp** ở tầng query — chỉ có unit test pure (`access.test.ts`).

**Khuyến nghị:** nếu chọn scoped, dùng nguồn quyền **tường minh** — cột assignee/participant thật hoặc bảng `enrollment_participants` — thay vì suy diễn từ comment/notification. Thêm index `enrollment_comments(author_email)`.

---

### 5.2 — Enrollment inline cell & drawer custom fields hardcode `canEdit=true`

**Severity: HIGH (correctness / UX inconsistency)**

**Bằng chứng:**
- `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` (~dòng 1785, inline cell) và drawer custom fields (~dòng 2558): `<EditableCustomCell ... canEdit ... />` — **`canEdit` không truyền giá trị = luôn `true`**.
- Đối chiếu task đúng: `src/app/(authed)/tasks/_components/TaskRowItem.tsx:852` truyền `canEdit={canEditContent}`.

**Vì sao là vấn đề:**
Worker chỉ-xem (participant, không phải stakeholder) thấy custom cell **render editable**, sửa → server chặn bằng `canMutateEnrollmentRecord` (403, `src/app/api/enrollment/[id]/route.ts:108-110`) → optimistic update **rollback im lặng**, không báo lỗi. Server an toàn nhưng UI lừa mắt + lệch chuẩn với task.

**Khuyến nghị:** truyền `canEditRecord` (manager || stakeholder) xuống cell; hoặc tối thiểu đồng nhất hành vi disabled như task.

---

## 6. Findings — MEDIUM

### 6.1 (M1) — Import 'processing'/'failed' là dead-state không phục hồi

**Bằng chứng:** `src/app/api/config/imports/[id]/route.ts:70-152`.
- Claim `pending→processing` where `status='pending'` (tốt, chống double-approve).
- Apply rows trong loop — **không transaction**.
- Lỗi giữa chừng → set `failed`, nhưng **rows đã ghi một phần** vào bảng thật.
- Sau đó: approve lại (`POST`) cần `canApproveImport` → `status='pending'` → fail. Reject (`DELETE`) cũng cần `status='pending'` → fail.

**Hệ quả:** request `failed` (hoặc `processing` do server crash giữa chừng) **kẹt vĩnh viễn**, dữ liệu nửa vời, **không có đường recovery**. Doc chỉ thừa nhận "non-atomic" chứ không nhận ra bế tắc này.

**Khuyến nghị:** (a) cho phép reject/reset các request `failed` và `processing` cũ (timeout); và/hoặc (b) gói apply-rows vào một Supabase RPC transaction (claim + apply + finalize atomic).

---

### 6.2 (M2) — `fetchEnrollmentRecordById(id, actor?)` để actor optional = foot-gun

**Bằng chứng:** `src/lib/enrollment/queries.ts:143` — `actor?` optional; nếu caller **không truyền** → **bỏ qua toàn bộ access check**, trả record thẳng.

Hiện tại mọi caller đều truyền actor (đã grep xác nhận), nhưng API tự mời lỗi tương lai: một route mới quên `actor` = rò rỉ PII qua ID mà không ai để ý.

**Khuyến nghị:** bắt buộc `actor` (bỏ `?`), hoặc tách rõ `fetchEnrollmentRecordByIdForActor(id, actor)` vs `fetchEnrollmentRecordByIdUnchecked(id)` để chỗ nào bỏ check là cố ý và thấy được.

---

### 6.3 (M3) — Perf: eligibility & participant query lặp, không cache/short-circuit

**Bằng chứng:**
- `src/lib/tasks/assignees.ts:56` — `fetchTaskAssignees()` **không** bọc `cache()`, chạy 3 query tuần tự (`role_permissions` → `user_roles` → `portal_account`). `isEligibleTaskAssigneeEmail` / `findIneligibleTaskAssigneeEmail` gọi lại mỗi request.
- `src/lib/enrollment/queries.ts:179-188` — `fetchEnrollmentRecordById` **tính participant kể cả khi actor đã là direct stakeholder** (không short-circuit như `canViewEnrollmentRecordWithContext` ở `access.ts:52`). → 2 query thừa trên mỗi PATCH/comment của chính chủ record.

**Khuyến nghị:** bọc `fetchTaskAssignees` bằng `cache()` (React request-dedup); trong `fetchEnrollmentRecordById` kiểm tra `canViewEnrollmentRecord(actor, record)` trước, chỉ fetch participant khi cần.

---

### 6.4 (M4) — Import assignee sync xóa sạch rồi insert 1 → sập multi-assignee

**Bằng chứng:** `src/app/api/config/imports/[id]/route.ts:1225-1252` — `syncImportedTaskAssignee` `delete().eq("task_id", taskId)` rồi insert 1. Với import **update** có `assignee_email`, task đang multi-assignee sẽ bị **collapse về 1 người**, không concurrency control.

**Khuyến nghị:** nếu import single-assignee là chủ ý → ghi rõ trong doc + UI. Nếu không → merge thay vì replace, hoặc chặn import update assignee.

---

### 6.5 (M5) — Enrollment DELETE trả 500 sau khi đã archive thành công

**Bằng chứng:** `src/app/api/enrollment/[id]/route.ts:441-447` — sau khi archive OK, nếu insert `enrollment_activity` fail → trả **500**.

**Hệ quả:** archive đã thành công nhưng client nhận 500 → retry → lần 2 gặp `archived_at != null` → 404. Báo lỗi trên thao tác đã thành công + gây nhầm lẫn.

**Khuyến nghị:** log activity error thay vì 500 (như hành vi cũ), hoặc gộp archive + activity vào một transaction/RPC.

---

## 7. Findings — LOW

### 7.1 (L1) — Dead code: `permissions.ts::canExportImport`
`src/lib/table-config/permissions.ts` chỉ được gọi bởi `permissions.test.ts`; runtime dùng `export-access.ts::canActorExportImport`. Codex đồng bộ giá trị (manager-only) nhưng vẫn để dead. → Xóa cả helper + test, hoặc cho runtime dùng nó.

### 7.2 (L2) — `EditableCustomCell.normalizedValueEquals` so sánh person phân biệt hoa/thường
`src/app/(authed)/_shared/EditableCustomCell.tsx:197` — chọn lại đúng người (email khác case) vẫn `current !== next` → trigger save dư (PATCH thừa). → normalize lowercase khi so sánh person.

### 7.3 (L3) — `EditableCustomCell` không có state loading/error khi save fail
Save fail → cell revert im lặng, người dùng không biết. → thêm pending/error nhẹ (viền đỏ / giữ giá trị / toast).

---

## 8. Điểm Codex làm tốt (giữ nguyên)

- **Medicare 3 tầng**: `sanitizeEnrollmentPatchForProgram` ở POST/PATCH/import + DB CHECK constraint + backfill (`supabase/schema.sql:2292-2322`) — chắc, có test.
- **Import claim atomic** (`update ... where id=? and status='pending'`) chống 2 admin approve trùng (`imports/[id]/route.ts:70-84`).
- **Import validation context** cho cả custom lẫn system dropdown/person (`imports/route.ts:196-260` + `import.ts:17`); assignee import được validate eligibility **ngay ở staging** → nên KHÔNG phải lỗ hổng như doc lo ở finding #4/#12.
- **Attachment hardening**: extension allowlist + magic-byte signature + phát hiện HTML/script + bucket `allowedMimeTypes` (`tasks/attachments.ts:52-110`, `tasks/storage.ts:32-42`) — có test.
- **Eligibility assignee** ở create/patch/assign/queue, kiểm tra đúng tập active + `task.work`/`task.manage`.
- **2-người approval** (`canApproveImport`: submitter ≠ approver, status pending) giữ nguyên.
- **`/config` thêm vào `ACCESSIBLE_ROUTES`** (`rbac/routes.ts:49-52`) — fix finding #14.

---

## 9. Task 2 — RBAC architecture review

**Kiến trúc hiện tại (mô tả):** identity theo email (không account-id trong session). Pure resolver `src/lib/tasks/access.ts` (`buildTaskActor`, `isTaskViewAdmin`) là "nguồn sự thật" cho task; enrollment tái dùng qua `EnrollmentActor = TaskActor` và thêm resolver row-level ở `enrollment/access.ts`. API routes enforce; client render control tương ứng.

| # | Câu hỏi kiến trúc | Đánh giá |
|---|---|---|
| 1 | **Business rule duplication** | Enrollment giờ **tập trung tốt** ở `access.ts`. Task-side **vẫn rải rác**: `isAgentOwnerOrAssistant` (canonical) vs check route-local ở comments/edits/activity — finding #6 của doc **CHƯA fix trong batch này**. |
| 2 | **Permission trộn business rule** | `canMutateEnrollmentRecord` trộn RBAC (`isManager/isWorker`) + ownership (stakeholder). Ở scale ~50 user **chấp nhận được**; chưa cần tách policy engine. |
| 3 | **Over-engineering** | Không. Mức trừu tượng hợp scale. |
| 4 | **Under-engineering** | Thiếu: (a) test tích hợp scoping; (b) recovery import (M1); (c) transaction cho multi-write — task create + assignees + rotation vẫn **không atomic** (finding #7 CHƯA fix); (d) audit "ai xem PII gì". |
| 5 | **Hard-coded rules** | `TASK_ADMIN_ROLE_NAMES`, `MEDICARE_INAPPLICABLE_FIELDS` set cứng — ổn ngắn hạn; thêm role/program mới phải sửa nhiều nơi. |
| 6 | **Duplicate authz Controller/Service/Repo** | Enrollment repo (`queries.ts`) + route đều gọi cùng resolver → không mâu thuẫn. Điểm cần dọn: actor-optional (M2) khiến enforcement "opt-in". |
| 7 | **Clean arch / DDD** | `access.ts` giờ kéo `getSupabaseAdmin` (infra) vào lớp access; `loadEnrollmentActor` phải `await import("@/auth")` động để né circular import — **code smell nhẹ, chấp nhận**. |
| 8 | **Security (IDOR / escalation)** | Không thấy IDOR mới — mọi route `[id]` đều check view/mutate. Không có privilege-escalation qua import. Rủi ro chính = **model participant mong manh (5.1)**, không phải bypass. |
| 9 | **Performance** | Xem M3. Fetch-all-rồi-filter-in-app (`fetchEnrollmentRecords`) ổn ở data nhỏ, tốn khi lớn. |
| 10 | **Maintainability** | Thêm role/program/workflow mới → sửa nhiều điểm hard-coded. Chấp nhận ngắn hạn, nên có test bao. |

**Rules nên GIỮ:** manager-only cho config/option/export-import; 2-người approval; eligibility assignee; `isTaskViewAdmin` tách khỏi `task.manage` đơn thuần.
**Rules nên BỎ/DỌN:** dead helper `permissions.ts` (L1).
**Rules nên thành POLICY/tường minh:** nguồn "participant" (5.1) nên là dữ liệu tường minh, không suy diễn.
**Rules nên chuyển vào business layer:** apply-import + task-create multi-write → RPC transaction.

**Hướng RBAC đề xuất:** giữ pure resolver (đã đúng) → (1) nguồn scope tường minh; (2) apply-import + task-create vào RPC transaction có recovery; (3) khi data lớn, đổi scope sang SQL filter/RPC thay vì filter in-app.

---

## 10. Action plan theo ưu tiên

| Ưu tiên | Việc | Finding |
|---|---|---|
| **CRITICAL — chốt trước merge** | Xác nhận scoping. Shared → revert scope; Scoped → +index +test +tài liệu | 4.1 |
| **HIGH** | Nguồn participant tường minh + index `author_email` | 5.1 |
| **HIGH** | `canEdit` enrollment theo quyền thật | 5.2 |
| **MEDIUM** | Import recovery (reset failed/processing) hoặc RPC transaction | 6.1 (M1) |
| **MEDIUM** | Bắt buộc `actor` trong `fetchEnrollmentRecordById` | 6.2 (M2) |
| **MEDIUM** | `cache()` cho `fetchTaskAssignees` + short-circuit participant | 6.3 (M3) |
| **MEDIUM** | Import multi-assignee: merge hoặc chặn | 6.4 (M4) |
| **MEDIUM** | Enrollment DELETE: log activity thay vì 500 | 6.5 (M5) |
| **LOW** | Dead code / person compare / save feedback | 7.1–7.3 |
| **(ngoài batch — cân nhắc)** | Task-side authz rải rác (#6) + task-create non-atomic (#7) | Task 2 |

---

## 11. Các quyết định cần chốt (đi qua từng câu)

> Phần này để mình đi qua cùng nhau. Trả lời theo thứ tự; Q1 là nút thắt.

**Q1 — Access/visibility model — ✅ ĐÃ CHỐT (2026-08-02, CHƯA code)**

**Enrollment:**
- **Xem = shared**: mọi worker thấy TẤT CẢ record → revert scope Codex ở `fetchEnrollmentRecords` / `fetchEnrollmentRecordById` / `overview-data` + bỏ check `canViewEnrollmentRecordWithContext` ở route detail/comments/attachments/activity/edits. Cơ chế "participant qua comment/notification" (finding 5.1) **bỏ luôn**.
- **Sửa = hạn chế** (GIỮ NGUYÊN `canMutateEnrollmentRecord`): manager + chủ record (`responsible_enroll_email` / `created_by_email` / `caller_email`).
- **Default filter UI**: `EnrollmentClient` load lên set `responsible_enroll_email = user`, xoá được.

**CS / tasks — ma trận XEM mới** (chỉ đổi view; sửa/status/assign/xoá **GIỮ NGUYÊN** agent-owner/assignee/reporter/manager):

| Actor | Nhận diện | Thấy | So với hiện tại |
|---|---|---|---|
| Manager / Admin | `actor.isManager` | Tất cả | không đổi |
| **CS thường** | worker, KHÔNG agent, KHÔNG assistant | **Tất cả** | **MỞ (mới)** |
| Agent | email ∈ `task_agents` (`fetchSelectedAgentEmails`) | `agent_email = mình` (+ task assign/mention cho mình) | không đổi |
| Assistant | `agent_members(cs_email=họ, is_assistant=true)` ≠ rỗng | task của agent mình assist (+ assign/mention) | không đổi |

- **Implement tối thiểu**: trong `fetchTasksForActor`, nếu actor là **CS thường** → **bỏ OR-scope** (thấy hết); agent/assistant → **giữ nguyên** scope cũ. Agent/assistant vẫn giữ task được assign/mention (không mất việc của mình).
- **Default filter**: server truyền cờ `defaultToMyTasks = true` **chỉ khi** actor là CS-thường-see-all (không phải manager). Client bật filter **"My tasks"** mặc định cho nhóm này (xoá được). Manager giữ như cũ (tắt mặc định). Agent/assistant không bật mặc định (đã scoped, bật sẽ giấu nhầm task agent-owned).

**Files dự kiến:** `lib/tasks/queries.ts` (`fetchTasksForActor`) · `lib/enrollment/{queries,access,overview-data}.ts` + route enrollment (revert view) · `TaskBoardClient.tsx` + `TaskToolbar.tsx` + `tasks/page.tsx` (default filter + cờ) · `EnrollmentClient.tsx` + `enrollment/page.tsx`. Kèm test + 1 entry `changelog.md`.

> Lý do gốc: `docs/2026-08-01-...md:622` để đây là open question; user chốt: **CS là hàng đợi chung cả công ty** (CS thường thấy hết), **agent/assistant scoped theo agent**, **enrollment shared + filter mặc định theo tên**.

**Q2 — Nhóm fix an toàn làm ngay (song song Q1)?** ✅ ĐÃ CHỐT (2026-08-02) — làm **cả 6 mục**
Không đụng DB, không đụng quyết định sản phẩm:
- **5.2** — enrollment `canEdit` theo quyền thật (đang hardcode `true` → sửa im lặng bị 403).
- **6.3 (M3)** — `cache()` cho `fetchTaskAssignees` + short-circuit participant trong `fetchEnrollmentRecordById`.
- **6.5 (M5)** — enrollment DELETE: log activity error thay vì trả 500.
- **7.1 (L1)** — xoá dead code `permissions.ts::canExportImport` + test.
- **7.2 (L2)** — `EditableCustomCell` person compare lowercase (bớt PATCH thừa).
- **7.3 (L3)** — feedback khi save custom value fail (không revert im lặng).
- *(6.2/M2 tự tiêu: Q1 revert view → chỉ còn dọn tham số `actor?` thừa trong `fetchEnrollmentRecordById`.)*

Còn lại tách riêng: **6.1 (M1)** → Q3 · **6.4 (M4)** → Q4 · task-side #6/#7 → Q5.

**Q3 — Import recovery (M1)** ✅ ĐÃ CHỐT (2026-08-02) — **(a)**
Cho admin **reject/đóng** request `failed` + `processing` kẹt (→ `rejected`), không đụng DB. Partial rows còn lại admin tự dọn (hiếm). RPC transaction (b) để hardening tương lai.

**Q4 — Import update multi-assignee (M4)** ✅ ĐÃ CHỐT (2026-08-02) — **(c)**
Team dùng **đa-assignee** (nhất là CS). → **Cấm import đụng assignee khi *update*** (chỉ set assignee lúc *create*). Assignee đổi qua UI. Bỏ nhánh `if ("assignee_email" in systemPatch) syncImportedTaskAssignee(...)` ở update. Tương lai cần bulk-đổi-list thì làm (d) parse nhiều email.

**Q5 — Findings ngoài batch (#6 task authz rải rác, #7 task-create non-atomic)** ✅ ĐÃ CHỐT (2026-08-02) — **(A) hoãn cả hai** sang đợt riêng. Là nợ có sẵn, không phải regression của batch; tách ra để test tập trung.

---

## 12. Tình trạng: TẤT CẢ quyết định đã chốt → sẵn sàng implement

Đợt này gồm: **Q1** (view model CS + enrollment + default filter) · **Q2** (6 fix an toàn) · **Q3a** (import recovery: reject failed/processing) · **Q4c** (cấm import đụng assignee khi update). Hoãn: #6, #7, RPC transaction (M1-b).
