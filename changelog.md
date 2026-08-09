# Changelog

Ghi lại **mọi thay đổi LOGIC** của agent-portal: business rule, quyền/RBAC, luồng dữ liệu,
điều kiện, tính toán, schema. **Không** ghi: đổi UI thuần (màu/spacing/copy), rename biến,
format code, thay đổi test đơn thuần.

Mới nhất ở trên cùng. Mỗi thay đổi logic → thêm 1 entry ngay trong lượt code đó.

### Format 1 entry
```
## YYYY-MM-DD — <tiêu đề ngắn>
- **Loại**: feat | fix | refactor-logic | security | perf | breaking
- **Cái gì**: mô tả thay đổi logic
- **Vì sao**: lý do / quyết định nghiệp vụ
- **File**: path/to/file.ts:line (các file chính)
- **Ảnh hưởng**: role/luồng/dữ liệu nào bị tác động
- **Ref**: doc / finding / commit (nếu có)
```

---

## Unreleased

## 2026-08-09 — Add Enrollment stage-time RPC scratch assertions
- **Loại**: test
- **Cái gì**: Thêm rollback-only PostgreSQL assertions cho create/PATCH/archive, terminal markers, owner snapshot, monotonic timestamps, invalid activity/fields, idempotent archive và database invariants.
- **Vì sao**: SQL RPC correctness không được chứng minh bằng TypeScript tests; fixture dùng stage set ACA đã seed và không để lại dữ liệu.
- **File**: `supabase/rollouts/2026-08-09-enrollment-stage-time-test.sql`
- **Ảnh hưởng**: Chỉ scratch database; production data không bị ghi.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-stage-time-tracking.md`, CODEX-08/CODEX-16

## 2026-08-09 — Add atomic Enrollment stage mutation RPCs
- **Loại**: feat, security
- **Cái gì**: Thêm `patch_enrollment_atomic`, `create_enrollment_atomic`, `archive_enrollment_atomic` và `enrollment_touch_activity`; các RPC khóa record, enforce monotonic `updated_at`, normalize email, ghi cycle/history/activity trong cùng transaction và fail closed với unknown fields/invalid activity.
- **Vì sao**: Ngăn stale overwrite, thiếu stage history/cycle, terminal/archive tracking gap và actor/email scope drift.
- **File**: `supabase/schema.sql`, `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql`
- **Ảnh hưởng**: Enrollment ACA/Medicare mutation paths; routes chưa chuyển sang RPC cho tới Task 5.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-stage-time-tracking.md`, CODEX-03/CODEX-05/CODEX-10/CODEX-11/CODEX-13/CODEX-16

## 2026-08-09 — Add Enrollment stage-time tracking schema
- **Loại**: feat
- **Cái gì**: Thêm các mốc stage/activity trên `enrollment_records` và bảng `enrollment_stage_cycles` với unique open-cycle invariant, source tracking, terminal-marker distinction, index và RLS.
- **Vì sao**: Tạo nền schema cho stage dwell/revisit metrics mà không tách cycle khi chỉ đổi owner và không làm thay đổi semantics usage count của Config archive.
- **File**: `supabase/schema.sql`, `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql`
- **Ảnh hưởng**: Enrollment ACA/Medicare; chưa có route nào đọc/ghi cycle cho tới các task tiếp theo.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-stage-time-tracking.md`, CODEX-02/CODEX-03/CODEX-04

## 2026-08-09 — Prevent comment mention menu from covering composer actions
- **Loại**: fix
- **Cái gì**: Menu gợi ý khi gõ `@` được portal ra ngoài drawer, neo theo vị trí caret và tự chọn hướng mở. Composer docked ở đáy luôn mở menu lên trên; reply composer tự chọn phía còn đủ chỗ. Menu tự đo lại khi textarea resize, viewport resize hoặc vùng comment scroll.
- **Vì sao**: Menu cũ render absolute bên trong khung `overflow-hidden`, nên ở đáy Enrollment/CS drawer nó mở xuống, bị cắt và đè lên Attach/Clear/Send.
- **File**: `src/app/(authed)/tasks/_components/CommentThread.tsx`
- **Ảnh hưởng**: Mention picker dùng chung trong comment của Health CS, ACA và Medicare; logic lưu mention và gửi comment không đổi.
- **Ref**: user screenshot 2026-08-09

## 2026-08-09 — Backfill Agent for generated Enrollment QA samples
- **Loại**: fix, data
- **Cái gì**: Mở rộng `--backfill-agents` từ 27 fixture hardcode sang cả bộ generated QA, nhưng chỉ nhận record đồng thời có Client Name bắt đầu bằng `[Sample QA]` và FUB thuộc đúng `https://sample.qa/enrollment-{program}/...`. Có thêm `--dry-run`; assignment round-robin dùng toàn bộ tập QA đã sort để rerun sau partial write không làm lệch mapping.
- **Vì sao**: Audit cũ nhầm 640 generated QA records là non-sample vì chúng không nằm trong mảng fixture hardcode. Do đó backfill báo xong 27 record nhưng list vẫn còn 320 ACA + 320 Medicare hiển thị `Assign` ở cột Agent.
- **File**: `scripts/seed-enrollment-samples.mjs`
- **Ảnh hưởng**: Chỉ sample Enrollment có hai marker QA nghiêm ngặt và `agent_email IS NULL`; record khách thật và Agent đã có sẵn không bị thay đổi.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-permission-final.md`, post-rollout correction

## 2026-08-09 — Recommend colors for new dropdown values
- **Loại**: fix
- **Cái gì**: Config automatically assigns the least-used color from the shared dropdown palette when an admin adds a Category, custom dropdown option, or Enrollment option without manually choosing a color. The Config color cell previews the same softened/tinted badge treatment used by its consumer while retaining a small raw-color picker for overrides. The visible `Auto` button cycles through the remaining recommendations and stays available after a manual override.
- **Vì sao**: The native picker displayed the stored saturated hex while List/Detail rendered a transformed badge, so admins could not see the actual result; Category/custom creation could also submit `null` despite showing a gray picker.
- **File**: `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/lib/table-config/value-colors.ts`
- **Ảnh hưởng**: Dropdown-value creation and color editing in Health CS, ACA, and Medicare Config. Existing List/Detail/Create badge colors and stored existing values are unchanged.
- **Ref**: user request 2026-08-09

## 2026-08-09 — Searchable custom dropdown/person selection lifecycle
- **Loại**: refactor-logic, fix
- **Cái gì**: Custom dropdown/person cells now use the same anchored searchable selection flow as system fields. Selection still commits only on an existing option, supports the original clear row, closes before saving, skips normalized-equal values, and preserves save-error feedback.
- **Vì sao**: Replacing the native select must not introduce free-form values, blur-triggered saves, duplicate commits, or accidental resets while users search long configured lists.
- **File**: `src/app/(authed)/_shared/EditableCustomCell.tsx`, `src/app/(authed)/_shared/SearchableListboxPanel.tsx`, `src/lib/table-config/values.ts`
- **Ảnh hưởng**: CS custom dropdown/person fields in list/detail and Enrollment custom fields; text/number/date/link/checkbox behavior remains unchanged.
- **Ref**: `docs/superpowers/plans/2026-08-09-searchable-dynamic-dropdowns.md`, Task 7

## 2026-08-09 — Khóa nội dung chính Enrollment đối với CS worker
- **Loại**: fix, security
- **Cái gì**: Tách capability `canEditContent` cho Client Name, FUB Link và Description. Manager, agent-owner/assistant và creator được sửa; Caller/Responsible chỉ làm workflow nên ba field này read-only. API PATCH áp cùng guard và trả 403, không chỉ disable UI.
- **Vì sao**: Enrollment trước đây dùng `canEditFields` cho cả nội dung chính lẫn dữ liệu vận hành, khiến CS worker sửa được thông tin mà bên Health CS chỉ manager/agent-owner/reporter được sửa.
- **File**: `src/lib/enrollment/access.ts`, `src/app/api/enrollment/[id]/route.ts`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/lib/enrollment/capabilities.test.ts`
- **Ảnh hưởng**: ACA và Medicare detail drawer. Caller/Responsible vẫn đổi Stage/Reopen và các field vận hành Enrollment theo matrix hiện tại; quyền create, QC, archive, assign và transfer agent không đổi.
- **Ref**: user request 2026-08-09; Health CS `canEditContent` precedent

## 2026-08-09 — Chỉ default Enrollment Assignee filter cho plain worker
- **Loại**: fix
- **Cái gì**: Filter mặc định `Responsible/Assignee = current user` chỉ được khởi tạo cho plain worker. Manager mở toàn bộ dữ liệu; agent và assistant mở toàn bộ record đã được server giới hạn trong agent scope của họ, không bị lọc tiếp theo tên cá nhân.
- **Vì sao**: Điều kiện cũ dùng `!canManageOptions`, nên vô tình áp default cá nhân cho mọi non-manager và che mất record hợp lệ của agent/assistant trong cùng scope.
- **File**: `src/app/(authed)/enrollment/page.tsx`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: ACA và Medicare initial list filters; không đổi server visibility, quyền mutation hoặc hành vi khi người dùng tự chọn/reset filter.
- **Ref**: user request 2026-08-09

## 2026-08-09 — Enforce Enrollment agent scope and explicit export permission
- **Loại**: security, breaking
- **Cái gì**: ACA/Medicare now enforce the same agent/assistant scope on list, overview, export, deep links and every record-by-ID API. Mutation rights are split by action: agent-owner/assistant controls QC, people assignment and archive; caller/responsible can edit workflow fields and change/reopen stage; creator can edit fields; managers retain all actions. Agent transfer is reserved for manager, agent-owner/assistant or creator. Creating a record requires manager access or ownership/assistant scope for the selected agent. Task and Enrollment exports now require the independent `task.export` permission in both UI and API.
- **Vì sao**: Service-role reads previously allowed out-of-scope UUID access, a single broad client predicate exposed controls the server should reject, and manager status alone was an implicit data-export entitlement.
- **File**: `src/lib/enrollment/access.ts`, `src/lib/enrollment/scope.ts`, `src/app/api/enrollment/**`, `src/app/(authed)/enrollment/**`, `src/lib/table-config/export-access.ts`, `src/app/api/tasks/export/route.ts`, `src/lib/rbac/permissions.ts`, `supabase/schema.sql`
- **Ảnh hưởng**: Scoped agents/assistants only see records for agents they cover; null-agent records fail closed for scoped viewers. Plain task workers keep the shared queue view but cannot create unless they have agent scope. Existing managers without `task.export` lose Export until the permission is granted. Health CS permission behavior was verified and intentionally not changed.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-permission-final.md`; commits `1e5a763`…`ff12606`

## 2026-08-09 — Thêm chế độ seed assistant có guard
- **Loại**: feat, security
- **Cái gì**: Seed script chỉ tạo assistant membership khi người chạy truyền explicit `cs:agent` allow-list, bật `SEED_ALLOW_ASSISTANTS=1`; hỗ trợ `--dry-run`, in target database và toàn bộ pair trước khi ghi.
- **Vì sao**: Assistant có quyền ngang agent-owner; tự chọn active account hoặc chạy nhầm production có thể cấp quyền truy cập dữ liệu ngoài ý muốn.
- **File**: `scripts/seed-enrollment-samples.mjs`
- **Ảnh hưởng**: Không có write mặc định; chỉ các pair hợp lệ trên môi trường được xác nhận mới được upsert vào `agent_members`.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-permission-final.md`; Phase 0 Task 0.2

## 2026-08-09 — Gán agent hợp lệ cho enrollment sample
- **Loại**: feat
- **Cái gì**: Enrollment sample seed lấy roster từ giao của `task_agents` và active `portal_account`, phân bổ agent round-robin ổn định với cùng roster, ghi `agent_email` cho record mới và hỗ trợ `--backfill-agents` cho sample cũ.
- **Vì sao**: Sample cũ không có agent nên không thể kiểm thử permission/scope agent-assistant; chỉ đọc `task_agents` có thể chọn account inactive mà API Enrollment từ chối.
- **File**: `scripts/seed-enrollment-samples.mjs`
- **Ảnh hưởng**: Chỉ sample records có FUB link nằm trong fixture; backfill chỉ cập nhật `agent_email` đang null và không tải/chạm record ngoài sample.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-permission-final.md`; Phase 0 Task 0.1

## 2026-08-09 — Làm drift test SLA kiểm tra mọi khai báo SQL
- **Loại**: test, refactor-logic
- **Cái gì**: Các test đồng bộ SLA đọc toàn bộ SQL matches bằng `matchAll`, thay vì chỉ kiểm tra match đầu tiên; mọi khai báo default tìm được phải khớp với TypeScript constant.
- **Vì sao**: `task_reminder_settings.todo_hours` có cả CREATE và ALTER declaration, nên đọc một match có thể bỏ sót drift ở declaration còn lại.
- **File**: `src/lib/tasks/sla-config.test.ts`
- **Ảnh hưởng**: Chỉ tăng độ tin cậy verification; không thay đổi runtime/API.
- **Ref**: `docs/superpowers/plans/2026-08-07-sla-config-section.md`; finding B-02

## 2026-08-09 — Rollback SLA editor sau save lỗi và Reset
- **Loại**: fix
- **Cái gì**: SLA row đồng bộ lại hour/minute khi rule prop thay đổi (bao gồm Reset), và khôi phục giá trị trước đó nếu POST save thất bại; các commit UI cũ hơn bị bỏ qua khi đã có commit mới.
- **Vì sao**: trước đây local state chỉ khởi tạo một lần, nên Reset thành công vẫn hiển thị override cũ; network/API failure cũng để UI hiển thị giá trị chưa được lưu.
- **File**: `src/app/(authed)/config/_components/ConfigSlaSection.tsx`
- **Ảnh hưởng**: Chỉ hiển thị/trạng thái SLA admin editor; không đổi giá trị đã lưu hoặc API contract.
- **Ref**: `docs/superpowers/plans/2026-08-07-sla-config-section.md`; findings stale Reset/save failure

## 2026-08-09 — Serialize SLA rule saves per row
- **Loại**: fix
- **Cái gì**: SLA rule dropdowns và Reset bị khóa theo từng row trong lúc request đang bay; parent dùng functional state update để các row khác nhau không ghi đè lẫn nhau khi save đồng thời.
- **Vì sao**: trước đây `savingKey` chỉ theo dõi một row và callback save dùng snapshot `rules` cũ, nên thao tác nhanh hoặc save hai row cùng lúc có thể để response cũ xoá mất thay đổi mới.
- **File**: `src/app/(authed)/config/_components/ConfigSlaSection.tsx`
- **Ảnh hưởng**: Chỉ SLA admin editor; mỗi row vẫn có thể save độc lập, không đổi API/storage.
- **Ref**: `docs/superpowers/plans/2026-08-07-sla-config-section.md`; finding SLA save race

## 2026-08-09 — Giới hạn lựa chọn phút theo bounds SLA
- **Loại**: fix
- **Cái gì**: SLA editor lọc minute options theo hour selection, không còn offer `0h 0m` hoặc các tổ hợp vượt quá `168h`; khi đổi giờ, phút hiện tại được clamp về lựa chọn hợp lệ gần nhất.
- **Vì sao**: UI trước đó cho chọn `168h 55m` dù API từ chối trên 10,080 phút, khiến giá trị hiển thị khác giá trị lưu.
- **File**: `src/lib/tasks/sla-config.ts`, `src/lib/tasks/sla-config.test.ts`, `src/app/(authed)/config/_components/ConfigSlaSection.tsx`
- **Ảnh hưởng**: Chỉ SLA admin editor; API bounds, storage và overdue computation không đổi.
- **Ref**: `docs/superpowers/plans/2026-08-07-sla-config-section.md`; finding B-01

## 2026-08-09 — Hiển thị neutral state cho option Enrollment chưa chọn
- **Loại**: fix
- **Cái gì**: Các identity option badge chưa có giá trị trong Enrollment List dùng neutral background `#f4f5f7` và foreground `#5e6c84`, thay vì bị JSX ghi đè thành nền trong suốt.
- **Vì sao**: Helper palette đã có empty-state trung tính nhưng render path bỏ qua nó khi `option` là `null`, khiến empty value không đồng nhất với badge đã chọn.
- **File**: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: Chỉ hiển thị List; không đổi option value, payload, permission hay validation.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-task-ui-standardization.md`; source commit `b86ffbb`

## 2026-08-09 — Đồng bộ badge option Enrollment theo hai ngôn ngữ của Health CS
- **Loại**: fix, refactor-logic
- **Cái gì**: Enrollment List phân biệt hai loại badge: Carrier / Payment / AC / Platform / Consent dùng identity badge solid theo màu option, chữ uppercase và không có chevron; Stage giữ workflow-state badge nền tint 0.14 và chỉ hiện chevron khi record editable. Palette và contrast logic dùng `src/lib/enrollment/option-badge.ts`, tái sử dụng `readableTextColor` của CS.
- **Vì sao**: Enrollment option chip nhạt 0.08, chữ thường và chevron luôn hiện nên không cùng design language với CS `CategoryBadge`; Stage lại bị hiển thị affordance dù read-only.
- **File**: `src/lib/enrollment/option-badge.ts`, `src/lib/enrollment/option-badge.test.ts`, `src/lib/tasks/category-colors.ts`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: chỉ thay đổi List presentation/affordance; Detail form controls, payload, permission, validation và program-specific fields không đổi. ACA và Medicare dùng chung implementation.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-task-ui-standardization.md`; source commits `f20392e`, `912bb00`

## 2026-08-09 — Chuẩn hóa empty state person field trong Enrollment Create
- **Loại**: fix
- **Cái gì**: `EnrollmentPersonMenu` đổi từ boolean `field` sang surface union `list | form-bare | form-field`. ACA và Medicare Create dùng `form-bare`, nên Agent / Caller / Responsible không còn render pill `Assign` nét đứt của List bên trong border của `CreatePropertyField`; List vẫn giữ CTA `Assign`, Detail vẫn giữ control có border và chevron.
- **Vì sao**: một prop boolean đang gộp hai trách nhiệm khác nhau: surface và border chrome. Empty state List đúng nhưng bị dùng nhầm trong Create.
- **File**: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: chỉ thay đổi presentation/affordance của person fields; không đổi payload, permission, required validation hoặc cardinality. `agent_email`, `caller_email`, `responsible_enroll_email` vẫn là single-person text fields.
- **Ref**: `docs/superpowers/plans/2026-08-09-enrollment-task-ui-standardization.md`; source commit `c51691f`

## 2026-08-09 — Di chuyển cấu hình SLA vào Health Table Configuration
- **Loại**: feat, fix, refactor-logic, breaking
- **Cái gì**: Chuyển giao diện quản trị `SLA Times` từ modal trên CS Task Board sang tab `SLA Times` trong `/config`; gom các constant UI/validation vào `src/lib/tasks/sla-config.ts`; xoá `SlaRulesModal.tsx`. API `POST /api/admin/task-sla-rules` nay từ chối `duration_minutes` ngoài khoảng 1–10080 phút (tối đa 168 giờ). Thêm test khóa `DEFAULT_SLA_MINUTES` và `DEFAULT_REMINDER_SETTINGS` đồng bộ với `supabase/schema.sql`.
- **Vì sao**: Tập trung toàn bộ cấu hình quản trị vào `/config`, tránh hardcode SLA trong component UI và tránh API chấp nhận giá trị mà UI không thể hiển thị/chỉnh sửa lại.
- **File**: `src/lib/tasks/sla-config.ts`, `src/lib/tasks/sla-config.test.ts`, `src/app/api/admin/task-sla-rules/route.ts`, `src/app/(authed)/config/page.tsx`, `src/app/(authed)/config/_components/ConfigClient.tsx`, `src/app/(authed)/config/_components/ConfigSlaSection.tsx`, `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/app/(authed)/tasks/_components/SlaRulesModal.tsx`
- **Ảnh hưởng**: Admin quản lý SLA tại `/config`; quyền truy cập vẫn do `loadConfigAdmin()`/manager gate quyết định. Người dùng Task Board vẫn đọc `slaRules` để hiển thị overdue/countdown; không đổi SLA computation, storage shape hoặc read permission. Direct API caller lưu SLA trên 168 giờ sẽ nhận `400` thay vì `200`.
- **Ref**: `docs/superpowers/plans/2026-08-07-sla-config-section.md`; source commits `3ec0616`, `36e41cc`, `30746ba`

## 2026-08-08 — Fix bug UI nhảy A→B→A→B (race condition) ở Enrollment + Config + CS [Phase 0]
- **Loại**: fix, breaking (tăng khả năng gặp 409 khi có người comment — xem Ảnh hưởng)
- **Cái gì**: Review toàn bộ module Task (CS/Enroll/Config) bằng 2 agent độc lập + 1 vòng debate đối kháng. **Phát hiện quan trọng: 1 triệu chứng nhưng 3 nguyên nhân khác nhau**, không phải 1 root cause chung như giả định ban đầu:
  1. **Enrollment — race thật (nguyên nhân chính)**: `refetch()` kiểm tra điều kiện chặn (`pendingRef.size === 0`) **sau** khi request về, thay vì lúc gửi đi. Nên 1 GET xuất phát *trước* lúc ghi commit nhưng về *sau* sẽ đè snapshot cũ lên dữ liệu vừa ghi. Cộng debounce 300ms của realtime → ra đúng nhịp A→B→A→B cách nhau ~0.5s. **Sửa**: bắt `refetchSeqRef` (chỉ refetch mới nhất được áp) + `hadPendingAtIssue` (refetch gửi lúc đang có ghi thì vĩnh viễn không được áp).
  2. **Hệ quả nặng hơn cả bug hiển thị**: sau khi snapshot cũ đè lên, `updated_at` trong state thành giá trị cũ → lần sửa kế gửi `expected_updated_at` sai → **409** → code rollback về đúng bản cũ đó → **record kẹt, không sửa được nữa**. Đây chính là lời giải cho lỗi "Task was updated by someone else" gặp trong lúc test trước đó — lỗi thật, không phải do tab giữ state cũ.
  3. **CS**: đã có 4 ref canh từ trước nên hiếm gặp, nhưng response bị giữ lại thì **bị vứt luôn** (kèm cả update của người khác) cho tới ping kế tiếp. **Sửa**: đánh dấu `tasksRefetchDirtyRef` và chạy lại khi mutation settle, thay vì bỏ.
  4. **Config — KHÔNG phải race**: optimistic giữ nguyên thứ tự mảng, còn echo từ server thì sort lại (khoá sort đầu tiên là `hidden_default`) → dòng vừa toggle bị đẩy xuống cuối bảng ~1s sau; đồng thời server ép thêm field mà client không áp (`show_in_detail=true` khi set Required cho cột custom) → nút "In detail" tự bật lên sau 1s. **Sửa**: tách luật ép field thành **1 hàm dùng chung `applyColumnPatchInvariants()`** gọi bởi CẢ server route lẫn optimistic update ở client (không thể lệch nhau nữa), và tách comparator thành `sortConfigEditorColumns()` dùng chung cho cả list lẫn optimistic. Thêm khoá 8 toggle khi đang lưu để chặn đường race 2-lần-bấm.
  5. `touchLastActivity()` giờ bump luôn `updated_at` — trước đó chỉ ghi `last_activity_at`/`stale_reminded_at`, nghĩa là nội dung hiển thị của dòng đổi mà version không đổi (đã verify: schema **0 trigger** tự bump `updated_at`, mọi route tự set tay).
- **Vì sao**: 2 phương án "hiển nhiên" đều bị chính người đề xuất rút lại sau debate — (a) dùng `updated_at` làm khoá so sánh mới/cũ: **sai**, vì có đường ghi đổi nội dung mà không bump version, và timestamp do app sinh trên nhiều serverless instance nên lệch đồng hồ; (b) dùng TanStack Query `cancelQueries`: **không đủ**, vì request gây lỗi *sinh ra giữa lúc mutation đang bay*, lúc `cancelQueries` chạy chưa có gì để cancel.
- **File**: `enrollment/_components/EnrollmentClient.tsx`, `tasks/_components/TaskBoardClient.tsx`, `lib/tasks/last-activity.ts`, `lib/table-config/columns.ts` (2 hàm mới dùng chung + 9 test), `api/config/columns/[id]/route.ts`, `config/_components/ConfigClient.tsx`
- **Ảnh hưởng**: **Cần theo dõi** — vì `updated_at` giờ được bump khi có comment, người đang mở task từ trước lúc ai đó comment mà sửa task sẽ gặp 409 "updated by someone else" thường hơn trước. Đây là đánh đổi có chủ đích (version giờ phản ánh đúng thay đổi), nhưng nếu gây phiền thì hướng xử lý đúng là tự rebase khi 409 (Phase 2), không phải quay lại để version nói dối.
- **Ref**: `docs/superpowers/plans/2026-08-08-task-module-state-architecture.md` (plan đầy đủ 5 phase; đây mới là Phase 0 "chặn máu"). Phase 1-2 (tách state optimistic khỏi state server thành primitive dùng chung cho cả 3 module) và Phase 3 (perf: module hiện **không có `React.memo`** nào, 1 lần sửa ô Enrollment = ~100 API call ở 50 user) chưa làm.

### Sửa tiếp sau vòng review Phase 0 (cùng đợt)
Cho 1 agent review lại đúng phần code Phase 0 vừa viết, nó bắt được **2 lỗi do chính đợt sửa này gây ra** + 3 lỗi sẵn có:
- **(do đợt này gây ra) Bump `updated_at` khi comment làm hỏng luồng comment→sửa**: `POST /api/tasks/[id]/comments` chỉ trả `{comment}`, không trả `updated_at` mới → state của board giữ token cũ → sửa task ngay sau khi comment bị **409**, và đường rollback còn cài lại token cũ + tái kích hoạt cooldown 3s nên task kẹt tới khi ngừng bấm 3s. **Sửa**: cả 2 route comment (CS + Enrollment) nay trả `parent_updated_at`, `CommentThread` (dùng chung) đẩy ngược lên qua `onParentUpdatedAt` để list cập nhật token. Enrollment vốn đã trả `record` nhưng client bỏ qua — nay cùng dùng 1 field chung.
- **(do đợt này gây ra) Sort lại mảng optimistic ở Config làm dòng "teleport"**: dòng chỉ có animation khi đang kéo-thả, nên sort lại lúc toggle khiến dòng **biến mất khỏi dưới con trỏ ngay lập tức** → mất luôn phản hồi thị giác, user tưởng nút không ăn. **Sửa gốc**: bỏ hẳn việc sort editor theo `hidden_default` (dùng `sortColumns` thuần theo position), đánh dấu cột ẩn bằng cách làm mờ dòng. Việc này còn sửa 1 lỗi dữ liệu có sẵn: `handleDragEnd` ghi `position = index+1` theo thứ tự editor, nên mỗi lần kéo-thả là **ghi cứng luôn thứ tự "cột ẩn nằm cuối" vào position thật**, bỏ ẩn sau đó thì cột kẹt lại dưới cùng.
- **Khoá toggle khi đang lưu là hướng sai** (thêm ở 0.5): `busy` là biến global nên khoá **toàn bộ 8 toggle của mọi dòng** ~0.5-1s → bấm toggle thứ 2 bị **nuốt im lặng**, khiến chính tiêu chí nghiệm thu "2 toggle trong 500ms đều phải lưu" không thể đạt. **Sửa**: bỏ khoá, thay bằng đếm số PATCH đang bay — chỉ patch cuối cùng settle mới gọi refresh (patch còn bay thì snapshot server chưa chứa nó, áp vào sẽ revert toggle kia).
- **Cờ hoãn-refetch không bao giờ chạy tới**: cờ được set *trong* handler response, nhưng chỗ chạy lại chỉ nằm ở `finally` của mutation — mà mutation thường settle **trước** khi response bị giữ lại về, nên flush chạy rồi mới có cờ → không bao giờ chạy lại. **Sửa**: nếu lúc đó không còn ghi nào đang bay thì chạy lại ngay tại chỗ; đồng thời xoá cờ khi có lần áp thành công (trước đó cờ kẹt `true` vĩnh viễn, gây refetch thừa).
- **`refreshScope` nằm trong `try` của Config**: GET lỗi sẽ rollback một lần ghi **đã thành công** — nút bật lại về cũ trong khi server đang giữ giá trị mới. **Sửa**: đưa ra ngoài `try`. Rollback cũng đổi từ khôi phục nguyên mảng sang **chỉ khôi phục đúng cột đó**, để không xoá mất chỉnh sửa cột khác đang bay.
- **`createRecord`/`archiveRecord` không đăng ký vào `pendingRef`** → refetch chạy song song coi là "sạch" và áp vào: record vừa tạo biến mất, record vừa archive sống lại. **Sửa**: đăng ký như mọi write khác.

## 2026-08-08 — Thông báo chuyển từ banner chèn layout sang toast nổi (toàn app)
- **Loại**: fix (UX)
- **Cái gì**: các thông báo trạng thái trước đây render **trong luồng layout**, nên khi hiện lên là **đẩy nguyên bảng xuống** và khi tắt thì giật ngược lên — rất khó chịu khi đang thao tác giữa bảng. Gom thành 1 component chung `_shared/Toast.tsx` (nổi, `fixed`, tự tắt sau 5s, có nút đóng, xếp chồng được) và áp cho: Config (`notice`), Account Manager (`error`/`message`), Role Manager (`error`/`message`). Đồng thời gộp luôn 2 toast tự chế khác nhau đang có ở CS và Enrollment về dùng chung component này (trước đó mỗi chỗ 1 kiểu). Bỏ effect tự-xoá-lỗi trùng lặp ở Enrollment vì Toast đã lo.
- **Vì sao**: user phản ánh trực tiếp trên màn Config — "cái này nó sẽ đẩy cái bảng xuống không tiện lắm", yêu cầu sửa cho tất cả các phần.
- **File**: `_shared/Toast.tsx` (mới), `config/_components/ConfigClient.tsx`, `account-manager/AccountManagerClient.tsx`, `role-manager/RoleManagerClient.tsx`, `tasks/_components/TaskBoardClient.tsx`, `enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: không đổi logic nghiệp vụ. Timer auto-dismiss giữ trong ref nên parent re-render không làm reset đếm ngược.

## 2026-08-08 — Nhãn cột (label) trong Create/Detail/Filter/Kanban giờ đọc live từ table_column, không hard code
- **Loại**: fix, refactor-logic
- **Cái gì**: Audit (2 subagent song song + 2 subagent phản biện kiến trúc) phát hiện: admin ĐƯỢC PHÉP đổi tên (label) mọi cột kể cả cột hệ thống qua `/config` → Table Columns (`canEditColumnField` cho phép `label` với `is_system=true`), nhưng rất nhiều nơi hiển thị nhãn đó bằng chữ hard code thẳng trong JSX, không đọc `table_column.label` — nên đổi tên trong Config không có tác dụng gì ở các chỗ đó. Đã sửa toàn bộ: (1) CS `NewTaskDialog`/`TaskDetailDrawer` — mọi nhãn field (Client Name, FUB Link, Description, Priority, Category, Agent, Assignee, Stage, Created by, Assignees, QC Review) giờ đọc `columnByKey.get(key)?.label ?? <chữ cũ làm fallback>`. (2) Enrollment `EnrollmentDrawer`/`NewEnrollmentDialog` — tương tự cho toàn bộ field (Client Name, FUB, Description, Stage, Due date, Payment, Carrier, AC, Consent, Platform, Agent, Caller, Responsible/Assignee, Created by, PCP 2025/2026, QC). (3) 2 ô List-cell Enrollment (`pcp2026`, `due`) trước đó hard code lệch khỏi pattern đúng đã có sẵn 2 dòng kế bên — sửa khớp. (4) Filter dropdown ở toolbar (cả CS lẫn Enrollment: Agent/Category/Status/Priority/Stage/Carrier/Payment/Caller/Responsible) cũng đọc label live thay vì chữ cứng. (5) CS Kanban board trước giờ KHÔNG hề nhận `visibleColumnKeys`/config gì cả — ẩn cột Priority/Category/QC trong Config chỉ ẩn được ở Create/Detail/List, card Kanban vẫn hiện — nay Kanban nhận `visibleColumnKeys` (từ `adminVisibleColumnKeys`, xuyên suốt `KanbanBoard → Column → SortableCard → TaskCard`) và ẩn đúng 3 badge đó khi cột bị ẩn.
- **Cơ chế dùng chung** (để tránh lặp lại kiểu "bảng dịch hard code" mà session này đã bác bỏ 1 lần cho Required-field): mỗi component cha (`TaskBoardClient.tsx`, `EnrollmentClient.tsx`) build 1 `columnByKey: Map<key, column>` DUY NHẤT từ danh sách cột ĐÃ resolve sẵn cho List view (`taskListColumnConfig`/`columns` — vốn đã đúng label/Medicare-relabel), không tạo file/hàm helper dùng chung mới, không build lại từ config thô lần 2 (tránh mất Medicare relabel).
- **Vì sao**: user yêu cầu review toàn bộ code tìm điểm hard code liên quan cột không tuân theo config; đã cho 2 agent research độc lập + 2 agent debate kiến trúc trước khi viết plan cuối, tránh vừa thiếu (bỏ sót Kanban) vừa thừa (không thêm custom-field render lên Kanban card — đó là tính năng mới, ngoài phạm vi).
- **File**: `tasks/_components/{NewTaskDialog,TaskDetailDrawer,TaskToolbar,KanbanBoard,TaskCard,TaskBoardClient}.tsx`, `enrollment/_components/EnrollmentClient.tsx`
- **Ảnh hưởng**: Vài field đổi hiển thị NGAY LẬP TỨC không cần admin làm gì, vì label thật trong DB khác chữ hard code cũ — đã audit riêng bằng 1 subagent review + query DB trực tiếp để phân biệt 2 loại: (a) **thống nhất lại đúng ý** — CS "Created by"→"Opened by", "QC Review"→"QC", "Assignees"→"Assignee" (số ít), Enrollment "Payment"→"Payment status": tất cả các field này List view VỐN ĐÃ hiện đúng label live này từ trước, chỉ có Detail/Create/Toolbar bị kẹt ở chữ cứng cũ — sau fix mọi nơi khớp nhau, không phải lỗi. (b) **lỗi thật, đã sửa**: CS field Title/Client Name đọc default DB là "Task" (seed cũ có từ trước, chưa ai đổi) — nếu để vậy sẽ LÙI LẠI đúng việc vừa đổi "Title"→"Client Name" ở fix ngay phía trên. Đã sửa tận gốc: update `table_column.label` (`cs.summary`) từ "Task" → "Client Name" trực tiếp trên DB (script tạm, đã chạy + xoá), đồng thời sửa luôn default seed trong `queries.ts` và `schema.sql` để khớp — không hardcode fallback đè lên, giữ đúng nguyên tắc "config là nguồn thật".
- **Ref**: `docs/superpowers/plans/2026-08-07-column-config-hardcoding-audit.md`, `-DRAFT.md`, `-fix.md` (plan cuối sau debate); user "review lại all code, list mọi điểm hard code liên quan đến cột... đáng lẽ mình phải lấy từ database lên á"; 1 subagent review bug sau khi code xong tìm ra 5 điểm nhãn lệch, phân loại 4 OK + 1 lỗi thật đã fix

## 2026-08-07 — Đồng bộ UI Create/Detail giữa CS và Enrollment (ACA/Medicare) + xiết quyền Archive
- **Loại**: breaking (quyền), fix
- **Cái gì**: Rà lại toàn bộ UI 2 cặp Create/Detail (CS: `NewTaskDialog`/`TaskDetailDrawer`; Enrollment: `NewEnrollmentDialog`/`EnrollmentDrawer`), lấy CS làm chuẩn. Sửa 3 điểm lệch thật: (1) field Title/Client Name — CS Create ghi "Title" trong khi CS Detail + cả 2 dialog Enrollment đều ghi "Client Name" → đổi CS Create thành "Client Name" cho khớp. (2) Header của Enrollment Detail có thêm badge màu hiển thị Stage cạnh mã ticket — CS Detail không có (Stage đã hiện đủ ở khối field bên phải) → bỏ badge này. (3) Khung dialog CS Create dùng `rounded` + nền mờ `/45`, còn CS Detail và cả 2 dialog Enrollment đều dùng `rounded-lg` + `/40` → đổi CS Create theo số đông cho khớp. **Quyền Archive (Enrollment)**: nút "Archive record" trước giờ hiện cho bất kỳ ai xem được record (server chặn sau qua `canMutateEnrollmentRecord` — cho phép cả caller/responsible/creator, rộng hơn CS). CS's "Delete task" chỉ hiện cho Manager hoặc chủ Agent (`canDeleteTask`). User xác nhận xiết Enrollment giống CS → thêm `canArchiveEnrollmentRecord()` (server, `lib/enrollment/access.ts`) + `canArchiveEnrollmentRecordClient()` (client, mirror) = Manager HOẶC người tạo record (`created_by_email`) — hẹp hơn hẳn quyền sửa field thường, vì Enrollment không có khái niệm "chủ Agent" như CS nên dùng "người tạo" làm tương đương gần nhất.
- **Vì sao**: user yêu cầu review tổng thể "UI display phải giống nhau... làm giống bên CS á" cho cả 3 phần CS/ACA/Medicare (2 dialog Enrollment dùng chung code, chỉ khác field theo `program`).
- **File**: `tasks/_components/NewTaskDialog.tsx`, `enrollment/_components/EnrollmentClient.tsx`, `lib/enrollment/access.ts` (hàm mới `canArchiveEnrollmentRecord`), `api/enrollment/[id]/route.ts` (DELETE dùng hàm mới thay vì `canMutateEnrollmentRecord`)
- **Ảnh hưởng**: non-manager KHÔNG PHẢI người tạo record (vd chỉ là caller/responsible) sẽ **mất quyền Archive** dù vẫn sửa được field bình thường — cần thông báo trước cho CS Enrollment nếu có ai đang dựa vào việc archive record người khác tạo.
- **Ref**: user "tao cần mày review lại tất cả UI phần create task / xem task... hãy làm giống bên CS á"; AskUserQuestion xác nhận xiết quyền Archive

## 2026-08-07 — Bỏ hết bảng dịch field hardcode trong Required-check + thêm Stage vào Create/Detail (CS)
- **Loại**: refactor-logic, feat
- **Cái gì**: (1) **Xoá hardcode còn sót trong hệ Required**: sau 2 lần fix (2 mục dưới) `findMissingRequiredFields()`/`isAutoGeneratedColumn()` vẫn dựa vào 1 bảng dịch tên cố định (`SYSTEM_COLUMN_FIELD_MAP`) giữa `table_column.key` và tên field DB thật — user chỉ ra đây vẫn là "hardcode column list", không tuân theo config trong DB. Thiết kế lại: `findMissingRequiredFields()` giờ đọc thẳng `column.key` từ `table_column` (live, mỗi request) và tra đúng key đó trong object `fieldValues` caller truyền vào — không còn bảng dịch giá trị nào cả. Việc dịch tên (vd DB dùng `agent_email`, cột config dùng key `agent`) chỉ còn ở đúng nơi cần: từng route tự gán inline 1 lần (`{ agent: patch.agent_email }`), không qua module dùng chung — nên không thể "trôi" ra khỏi DB nữa. Riêng `REQUIRED_CAPABLE_SYSTEM_KEYS` (`columns.ts`) chỉ còn là 1 tập hợp **key** (không phải bảng dịch giá trị) để biết field hệ thống nào có ô nhập thật lúc tạo — dùng khoá Required cho field tự sinh (Key, Created by, QC...). Loại "assignee" (cs) khỏi tập này: unassigned là trạng thái hợp lệ (tự về Backlog), không phải "thiếu giá trị". (2) **Thêm Stage/Trạng thái vào Create + Detail (CS)**: trước giờ chỉ chọn được Stage gián tiếp qua cột Kanban/List; nay `NewTaskDialog` có picker Stage (khoá cứng "Backlog" khi chưa chọn Assignee — đúng luật `resolveCreateAssignment()`, mở khoá thành dropdown khi đã có Assignee) và `TaskDetailDrawer` hiện Stage full-width ngay dưới Assignees, tái dùng nguyên logic tương tác của `StatusPill` (khoá overdue cần unlock, Done/Cancel chỉ Reopen qua flow có lý do, ẩn "To Do" sau khi đã từng In Progress) qua prop `size="field"` mới thêm — style row (List/Board) giữ nguyên không đổi.
- **Vì sao**: (1) user yêu cầu lặp lại nhiều lần trong buổi — bất kỳ bảng dịch cố định nào cũng là 1 chỗ có thể lệch khỏi Config thật trong DB theo thời gian (đúng như đã xảy ra 2 lần trước với Priority/In-Detail). (2) user xem task chi tiết + tạo task mới đều muốn thấy/đổi Stage tại chỗ, không phải quay ra bảng ngoài.
- **File**: `lib/table-config/required.ts` (viết lại, không còn bảng dịch), `lib/table-config/columns.ts` (`REQUIRED_CAPABLE_SYSTEM_KEYS` đổi từ map sang set key), `api/tasks/route.ts` + `api/tasks/[id]/route.ts` + `api/enrollment/route.ts` + `api/enrollment/[id]/route.ts` (dịch tên field inline tại chỗ), `tasks/_components/TaskRowItem.tsx` (`StatusPill` export + prop `size`), `tasks/_components/NewTaskDialog.tsx`, `tasks/_components/TaskDetailDrawer.tsx`, `tasks/_components/TaskBoardClient.tsx`
- **Ảnh hưởng**: không đổi RBAC/schema/hành vi Required đã có (chỉ đổi cách code tự kiểm tra chính nó); Stage field mới chỉ ở CS, chưa làm cho Enrollment. Tất cả 4 route Required-check verify lại đúng field cũ (title/description/fub/priority/category/agent CS; 15 field Enrollment).
- **Ref**: user "check cực kì kĩ... không hard code" (lặp 3 lần), "cái stage cũng phải hiện ở đây chứ" + "thêm cái stage vào này cho tao coi"

## 2026-08-07 — Fix 2 lỗi phát hiện lúc test trực tiếp tính năng Required (mục ngay dưới)
- **Loại**: fix
- **Cái gì**: (1) **Toggle "In Detail" hiện sai cho field hệ thống**: `ConfigClient.tsx` hardcode `checked=false` cho mọi field hệ thống bất kể `show_in_detail` thật là gì — nên Client Name/Agent (đã seed `show_in_detail=true`, thật sự có hiện trên form) lại hiện toggle tắt, gây hiểu lầm "field này không có trên form". Sửa: bỏ nhánh hardcode, luôn hiện đúng `column.show_in_detail || column.required` (vẫn giữ `disabled` cho field hệ thống/required — chỉ sửa phần hiển thị, không đổi quyền chỉnh). (2) **Tạo task báo "Priority required." dù đã chọn Medium**: `POST /api/tasks` validate Required ở server nhưng object `fieldValues` truyền vào chỉ có `title/agent_email/category_id` (3 field vốn đã hardcode check riêng) — thiếu hẳn `priority`, `description`, `fub_link`. User tự tick Required cho Priority lúc test Config (xem entry trước) → field này khi tạo task luôn bị báo thiếu dù có giá trị thật, vì server tra `fieldValues.priority` ra `undefined`. Sửa: bổ sung đủ cả 6 field vào `fieldValues`.
- **Vì sao**: cả 2 phát hiện qua test trực tiếp UI, không phải yêu cầu mới — thuộc phạm vi "Required field" đang làm dở, sửa liền không tách task riêng.
- **File**: config/_components/ConfigClient.tsx:769,871 (đã gộp thành 1 chỗ dùng chung), api/tasks/route.ts (thêm `description` làm biến dùng chung, bổ sung `fieldValues`)
- **Ảnh hưởng**: không đổi RBAC/schema. Sửa (2) là **blocker thật** — nếu không sửa, bất kỳ field nào ngoài Title/Agent/Category được tick Required sẽ khiến CS Task không tạo được nữa dù đã điền đủ.
- **Ref**: user test trực tiếp, ảnh chụp màn hình "Priority required."

## 2026-08-04 — Feature mới: Required field thật (Config) + fix đúng cơ chế Hidden/Detail cho Create/Detail (CS + Enrollment)
- **Loại**: feat, fix, breaking (đổi hành vi nút Create: không còn tự khoá, chuyển sang validate-khi-bấm)
- **Cái gì**: Sau 2 lần fix trong ngày (mục dưới) vẫn còn thiếu — user yêu cầu mở rộng thành 1 hệ thống hoàn chỉnh, không chỉ vá bug:
  1. **Required field thật**: `table_column.required` (cột có sẵn nhưng trước giờ chết, không được đọc ở đâu) nay có tác dụng thật — admin bật được cho **mọi cột** (hệ thống lẫn custom) qua toggle switch mới trong `/config` → Table Columns (đổi luôn 4 checkbox Pinned/Hidden/Detail cũ + Required mới sang dạng toggle switch, bỏ chữ label rối mắt). Field tự sinh (Key, Created by/date, Last edited by/time, QC) bị khoá không cho tick Required (không có ô nhập nào để mà thiếu/đủ).
  2. **Khoá chéo**: Required=true tự ép `hidden_default=false` (không ai ẩn được field bắt buộc khỏi Create/Detail, kể cả admin) và tự ép `show_in_detail=true` cho custom field; nút Archive bị khoá khi cột đang Required (phải tắt Required trước). Chặn luôn ở server (không chỉ UI) — 1 cột không thể vừa `pinned=true` vừa `hidden_default=true`, và không thể `required=true` mà `hidden_default=true`.
  3. **Bỏ luật either/or cũ của Enrollment** (Client Name HOẶC FUB Link, 1 trong 2) — thay bằng 2 field độc lập, mỗi field tự có Required riêng. Seed mặc định: Client Name = required, FUB Link = không (giữ gần đúng hành vi cũ nhất — luôn có tên khách khi tạo mới).
  4. **Validate kiểu mới trên Create + Detail** (CS: `NewTaskDialog`, `TaskDetailDrawer`; Enrollment: `NewEnrollmentDialog`, `EnrollmentDrawer`): nút Create **luôn bấm được** (không tự xám nữa) — bấm vào mới kiểm tra, nếu thiếu field Required thì **chặn gửi API, không đóng form**, tô viền đỏ đúng field thiếu (tái dùng style `ring-2 ring-[#ff5630]` có sẵn) + dấu `*` đỏ cạnh label mọi field Required. Detail drawer không có nút Save chung (mỗi field tự lưu khi blur) — field Required bị xoá trống rồi blur thì chặn lưu, **tự trả lại giá trị cũ**, tô đỏ tạm thời cho tới khi user bắt đầu sửa lại (focus vào ô).
  5. **Validate ở server cho cả 4 route** (`POST /api/tasks`, `PATCH /api/tasks/[id]`, `POST /api/enrollment`, `PATCH /api/enrollment/[id]`) qua hàm chung mới `findMissingRequiredFields()` (`src/lib/table-config/required.ts`) — tự đọc `table_column.required` theo scope, không tin riêng client. PATCH chỉ kiểm tra field mà chính request đó đang đổi (không chặn nhầm 1 patch không liên quan).
  6. **Khôi phục đúng cơ chế Hidden cho Create/Detail** (2 lần fix sáng nay bị lỗi — lần 1 gỡ sạch không phân biệt per-user vs admin, lần 2 chỉ áp cho field hệ thống bỏ sót custom field) — giờ Hidden áp dụng **thống nhất cho cả field hệ thống lẫn custom**, hoàn toàn tách khỏi state List View cá nhân của từng user. `show_in_detail`/"Detail" checkbox giữ đúng vai trò cũ: chỉ có ý nghĩa với custom field (opt-in thêm, ngoài việc hiện cột List), field hệ thống không cần nó nên checkbox bị khoá.
  7. Seed data: CS Title/Agent/Category, Enrollment Agent/Client Name → `required=true`; mọi field hệ thống có ô nhập thật trên Create → `show_in_detail=true` (thuần data-hygiene, app không đọc cờ này cho field hệ thống nhưng để dữ liệu phản ánh đúng thực tế). Áp trực tiếp lên Supabase production (data update, không đổi schema) + ghi vào `schema.sql` để môi trường mới cũng có sẵn.
- **Vì sao**: bug gốc (PCP2025 tick Hidden vẫn hiện ở Create) lộ ra 1 lỗ hổng thiết kế lớn hơn — Hidden/Detail/Required/Archive chưa từng được nghĩ như 1 hệ thống thống nhất. User yêu cầu review toàn bộ rồi thiết kế lại cho "hoàn hảo", qua nhiều vòng hỏi-đáp chốt từng quyết định (custom field Hidden luôn thắng Detail; field bắt buộc dùng cờ Required thật thay vì fallback ngầm; validate kiểu chặn-gửi-tô-đỏ thay vì khoá nút; bỏ either/or cũ).
- **File**: lib/table-config/columns.ts, lib/table-config/required.ts (mới), api/config/columns/[id]/route.ts, api/tasks/route.ts, api/tasks/[id]/route.ts, api/enrollment/route.ts, api/enrollment/[id]/route.ts, config/_components/ConfigClient.tsx, tasks/_components/TaskBoardClient.tsx, tasks/_components/NewTaskDialog.tsx, tasks/_components/TaskDetailDrawer.tsx, enrollment/_components/EnrollmentClient.tsx, supabase/schema.sql
- **Ảnh hưởng**: Create/Detail của cả CS lẫn Enrollment đổi hành vi validate (nút không tự khoá nữa, chuyển sang chặn-lúc-bấm + tô đỏ). Enrollment mất luật either/or cũ. Admin có thêm quyền lực mới (Required cho bất kỳ field nào) — cần cẩn thận vì đánh dấu 1 custom field Required cho Enrollment tạo mới sẽ **luôn không thoả được** vì Create dialog của Enrollment chưa có UI custom field (chỉ set được qua Detail sau khi tạo) — validator đã né việc này (`checkCustom: false` khi tạo mới) nhưng admin cần biết giới hạn này. Không đổi RBAC/permission.
- **Ref**: docs/superpowers/plans/2026-08-04-fix-admin-hidden-field-visibility.md (plan gốc hẹp hơn, đã mở rộng nhiều qua hỏi-đáp trực tiếp với user)

## 2026-08-04 — Fix: field hệ thống biến mất khỏi form Tạo/Sửa khi user tự ẩn cột List View (CS + Enrollment)
- **Loại**: fix
- **Cái gì**: `NewTaskDialog`/`TaskDetailDrawer` (CS) và `NewEnrollmentDialog`/`EnrollmentDrawer` (ACA/Medicare) đang dùng chung 1 hàm `isFieldVisible`/`showField` để quyết định field nào hiện trong form Tạo task/record và Chi tiết task/record. Hàm này lại đọc từ `visibleCreateColumnKeys` — tập cột đang hiện trong **List View của chính người dùng đó** (`hiddenTaskListColumnKeys`/`hiddenColumnKeys`, lưu per-user ở bảng `user_table_layout`). Hậu quả: **ai tự ẩn 1 cột hệ thống trong bảng List (chỉ để gọn bảng) thì field đó biến mất luôn khỏi form Tạo task/record và Chi tiết** — kể cả field bắt buộc như Title/Client Name, Category, Priority, Agent, Assignee, Stage. Bug có từ commit `24e9eaa` (2026-08-02, "Fix task and enrollment field visibility") khi generalize nhầm cơ chế `show_in_detail` (vốn chỉ dành cho **custom field**, vẫn đúng và giữ nguyên) sang áp luôn cho **field hệ thống**. Fix: gỡ hoàn toàn `isFieldVisible`/`showField`/`configuredColumnKeys`/`visibleColumnKeys` khỏi 4 component trên — field hệ thống giờ **luôn hiện không điều kiện** (khôi phục đúng hành vi gốc trước commit `24e9eaa`, đã verify bằng diff `git show 24e9eaa~1`), chỉ giữ lại điều kiện nghiệp vụ thật (vd `!isMedicare` cho Payment/Carrier-AC/Consent/Platform/Caller/PCP-2026 ở Enrollment). Cơ chế `show_in_detail` cho custom field không đổi.
- **Vì sao**: user báo "task CS chỉ còn điền được ô Note khi tạo task". Điều tra + verify trực tiếp DB (read-only) xác nhận `table_column.hidden_default` toàn bộ `false` (không phải admin ẩn cột toàn công ty) — nguyên nhân là chính user đã tự ẩn `category, status, priority, slaRemaining, agent, reporter` ở List View của mình lúc 2026-08-04 15:23 UTC, và bug coupling khiến hành động "ẩn cột bảng" (cosmetic, per-user) vô tình xoá luôn khả năng set field đó trên task. Kiểm tra thêm phát hiện Enrollment dính y hệt (cùng commit gây lỗi, cùng cơ chế) dù chưa ai report — sửa gộp luôn theo yêu cầu "fix kĩ".
- **File**: tasks/_components/NewTaskDialog.tsx, tasks/_components/TaskDetailDrawer.tsx, tasks/_components/TaskBoardClient.tsx (xoá `configuredCreateColumnKeys`/`visibleCreateColumnKeys`, giữ nguyên `taskListColumnConfig`/`visibleTaskListColumnConfig` vì vẫn cần cho List/Board table + export), enrollment/_components/EnrollmentClient.tsx (xoá tương tự trong `NewEnrollmentDialog`/`EnrollmentDrawer`, giữ nguyên `visibleColumns`/`hiddenColumnKeys` cho List table)
- **Ảnh hưởng**: **Không đổi RBAC/mutate permission, không đổi schema, không đổi chức năng `/config`** — checkbox Pinned/Hidden/Detail ở `/config` → Table Columns vẫn hoạt động y nguyên cho List/Board table view và cho custom field; chỉ gỡ 1 coupling sai khiến nó lan sang Create/Detail. `user_table_layout` hiện có của `bao.vo@excelplannings.com` (scope cs) không cần xoá — giờ chỉ còn tác dụng đúng phạm vi List View như dự định ban đầu. Đã chạy `tsc --noEmit` (0 lỗi), `vitest run` (419 pass), `eslint` trên 4 file đổi (0 lỗi/cảnh báo).
- **Ref**: bug report trực tiếp từ user + root cause verify qua Supabase read-only query

## 2026-08-03 — Khôi phục đính kèm file trong comment + chuyển composer xuống dưới
- **Loại**: fix, feat
- **Cái gì**: (1) **Khôi phục regression**: tính năng đính kèm file trong comment (nút Attach, chip file đã chọn, preview ảnh inline + modal phóng to, link tải file thường) đã bị gỡ khỏi `CommentThread.tsx` ở commit `2b185f0` (2026-07-13, "simplify detail visibility and attachments") — nay port lại vào cấu trúc hiện tại (không revert thẳng vì file đã thay đổi nhiều: mention encoding, edit history, prop `apiBase`). Kèm theo: bật lại `includeCommentAttachments: true` ở `/api/tasks/[id]/detail` (đang bị tắt cứng `false`), và cho phép comment **chỉ có file, không có chữ** ở cả 2 route POST comments (trước đó chặn `400 "Comment is empty."`). (2) **Đổi layout**: ô soạn comment chuyển từ trên xuống **dưới** danh sách, để tin nhắn mới hiện ngay phía trên chỗ đang gõ, giống giao diện chat.
- **Vì sao**: user báo mất nút đính kèm và muốn layout kiểu chat. Điều tra git xác nhận là regression thật (backend `/api/{tasks,enrollment}/[id]/attachments` nhận `comment_id`, `groupCommentAttachments`, signed URL, magic-byte validation đều còn nguyên vẹn — chỉ mất UI + 1 cờ bị tắt).
- **File**: src/app/(authed)/tasks/_components/CommentThread.tsx, src/app/api/tasks/[id]/detail/route.ts, src/app/api/tasks/[id]/comments/route.ts, src/app/api/enrollment/[id]/comments/route.ts
- **Ảnh hưởng**: `CommentThread` dùng chung qua prop `apiBase` nên **enrollment cũng được khôi phục đính kèm cùng lúc** (enrollment vốn đã load sẵn comment attachments). Không đổi schema/RBAC — quyền attach giữ nguyên: phải xem được task/record **và** là tác giả của comment đó. Blob URL của preview lạc quan được revoke khi server trả về URL thật (tránh memory leak).
- **Ref**: regression từ commit 2b185f0

## 2026-08-03 — Fix comment hiện 2 lần khi gửi kèm file
- **Loại**: fix
- **Cái gì**: gửi comment có đính kèm thì nội dung hiện **2 lần** rồi vài giây sau mới còn 1. Nguyên nhân: POST comment bắn realtime broadcast → `onReload()` chạy sau ~300ms mang comment **thật** về, trong khi bản **lạc quan** vẫn còn trên màn hình do đang upload file → cả 2 cùng render. Cửa sổ trùng đúng bằng thời gian upload (nên user thấy ~5s). Fix: khi server trả về id thật, gắn `realId` vào bản lạc quan; lúc dựng danh sách thì ẩn bản server tương ứng và **giữ bản lạc quan** (vì nó có preview ảnh cục bộ), tới khi upload xong `releaseOptimistic` mới hoán đổi sang bản thật.
- **Vì sao**: lỗi do chính đợt khôi phục đính kèm ở entry trên gây ra — trước đó comment không có file nên `persistComment` chạy gần như tức thì, cửa sổ trùng không nhìn thấy được.
- **File**: src/app/(authed)/tasks/_components/CommentThread.tsx
- **Ảnh hưởng**: chỉ hiển thị; không đổi API/schema. Chọn giữ bản lạc quan thay vì bản server để ảnh preview không bị nháy (biến mất rồi hiện lại) trong lúc upload.

## 2026-08-03 — Ô soạn comment luôn mở & ghim đáy (kiểu Messenger)
- **Loại**: feat
- **Cái gì**: ô soạn comment trước đây **thu gọn** thành 1 nút, phải bấm mới mở. Nay thêm chế độ `alwaysOpen`: luôn mở sẵn, `sticky bottom-0` nên **ghim ở đáy vùng cuộn** — cuộn danh sách comment thì ô nhập vẫn nằm nguyên dưới cùng, giống Messenger. Kèm: textarea gọn hơn (2 dòng thay vì 3), nút "Cancel" đổi thành "Clear" và **chỉ hiện khi đã có nội dung** (ô luôn-mở thì không có gì để "cancel" về).
- **Vì sao**: user yêu cầu "lúc nào nó cũng nằm bên dưới sẵn giống Messenger".
- **File**: src/app/(authed)/tasks/_components/CommentThread.tsx
- **Ảnh hưởng**: chỉ ô soạn cấp cao nhất dùng `alwaysOpen`; ô **trả lời** (reply) giữ nguyên hành vi cũ (mở khi bấm Reply, có Cancel để đóng). Cố ý **không autofocus** ô luôn-mở, nếu không mỗi lần mở task sẽ bị cướp con trỏ. Enrollment dùng chung component nên cũng được cập nhật.

## 2026-08-03 — Comment thread dựng đúng layout Messenger (list cuộn riêng, ô nhập dính đáy)
- **Loại**: feat
- **Cái gì**: bản trước dùng `sticky bottom-0` nên ô nhập chỉ dính đáy khi comment đủ dài để cuộn — ít comment thì nó trôi lên giữa drawer. Nay dựng đúng kiểu Messenger: **danh sách comment có vùng cuộn riêng** (`flex-1` + `overflow-y-auto`), **ô nhập docked cố định** ngay dưới nó và không bao giờ di chuyển, bất kể có 0 hay 100 comment. Thêm **tự cuộn xuống tin mới nhất** khi mở/khi có comment mới (bỏ qua khi đang deep-link tới 1 comment cụ thể để không phá luồng đó).
- **Vì sao**: user yêu cầu "y xì Messenger" — ô nhập phải luôn nằm đáy.
- **File**: src/app/(authed)/tasks/_components/CommentThread.tsx, src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx, src/app/(authed)/enrollment/_components/EnrollmentClient.tsx
- **Ảnh hưởng**: để vùng cuộn hoạt động, khu tab trong drawer phải giãn đầy chiều cao — đã đổi `<main>` sang flex-column và section tab sang `flex-1 min-h-0` ở **cả 2 drawer** (task + enrollment). Không đổi API/schema/logic.

## 2026-08-03 — Khoá chiều cao drawer để ô nhập comment thật sự dính đáy
- **Loại**: fix
- **Cái gì**: bản trước vẫn sai — có nhiều comment thì ô nhập bị đẩy khỏi màn hình, phải kéo xuống mới thấy. Nguyên nhân: vùng cuộn nội bộ **không bị chặn chiều cao** (grid dùng `min-h-full` + body vẫn `overflow-y-auto`), nên `flex-1` cứ nở ra theo nội dung thay vì cuộn. Fix: ở màn hình lớn (`lg:`), body chuyển `overflow-hidden`, grid dùng `h-full`, `<main>` thêm `min-h-0 overflow-hidden`, sidebar tự cuộn riêng — mỗi cột có vùng cuộn độc lập, đúng kiểu app chat. Các field phía trên (Client Name/FUB/Description) thêm `shrink-0` để không bị bóp lại khi chỗ chật.
- **Vì sao**: user báo "ô comment phải stick chứ sao mất khi có nhiều comment" — đúng, 2 lần trước tao chưa khoá chiều cao nên dock không có tác dụng.
- **File**: src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx, src/app/(authed)/enrollment/_components/EnrollmentClient.tsx
- **Ảnh hưởng**: chỉ áp dụng từ breakpoint `lg` trở lên; màn hình hẹp giữ layout cuộn-một-mạch như cũ (2 cột xếp dọc mà khoá chiều cao sẽ quá chật). Không đổi API/schema/logic.

## 2026-08-03 — Thu gọn composer + thiết kế lại tab Comments/Activity
- **Loại**: style
- **Cái gì**: (1) ô soạn comment chiếm quá nhiều chỗ → thu còn ~nửa chiều cao: 1 dòng thay vì 2-3, padding sát, nút cao 28px, nút Attach chỉ còn icon (có tooltip). Áp cho **cả ô docked lẫn ô Reply** (lần đầu quên Reply). (2) Tab Comments/Activity/Overdue (task) và Comments/Activity/Files (enrollment) đổi từ pill trên nền xám sang **tab gạch chân** + số đếm tách thành badge tròn riêng thay vì nhét trong ngoặc `(5)`; active = chữ xanh + gạch chân xanh, hover = gạch chân xám nhạt.
- **Vì sao**: user báo composer chiếm hết chỗ, và tab bar "xấu quá". Tab gạch chân cũng thấp hơn pill nên trả thêm chỗ cho danh sách comment.
- **File**: src/app/(authed)/tasks/_components/CommentThread.tsx, src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx, src/app/(authed)/enrollment/_components/EnrollmentClient.tsx
- **Ảnh hưởng**: `DetailTabButton`/`DrawerTab` đổi API từ `label`-gộp-số (hoặc `children`) sang `label` + `count` riêng — đã cập nhật đủ 6 call site. Tiện thể dọn: bỏ hết nhánh `alwaysOpen ? ... : ...` trong class kích thước, giờ `alwaysOpen` chỉ quyết định **hành vi** (thu gọn hay không, nút phụ "Clear" hay "Cancel").

## 2026-08-03 — Merge Dropdown Values into one unified nav (Custom + Category + Option Sets)
- **Loại**: refactor-logic
- **Cái gì**: gộp `ConfigValueSection` + `ConfigOptionSetSection` (2 khối riêng của đợt consolidate cùng ngày) thành 1 component `ConfigDropdownValuesSection` — 1 nav trái liệt kê mọi nhóm giá trị (Option Set nếu aca/medicare + Category nếu cs + mọi custom dropdown), chọn 1 mục hiện value tương ứng ở panel phải, dùng chung 1 form/table. Field đặc thù (Terminal/QC, cảnh báo archive theo usage-count, guard Consent 2-giá-trị) hiện có điều kiện theo nhóm đang chọn thay vì cố định theo khối.
- **Vì sao**: user test UI thật thấy 2 khối tách rời gây cảm giác rời rạc (vd scope=aca báo "No dropdown columns yet" ở khối trên dù Stage/Carrier/... có đủ ở khối dưới) — phản hồi trực tiếp: "tất cả là dropdown value, không nên tách riêng option set". Trước khi gộp đã audit lại DB (`table_column` 3 scope + `enrollment_option_sets`) xác nhận danh sách nhóm hiển thị đúng, không thiếu/thừa.
- **File**: config/_components/ConfigClient.tsx (xoá `ConfigValueSection`+`ConfigOptionSetSection`, thêm `ConfigDropdownValuesSection`), enrollment/_components/EnrollmentClient.tsx (bỏ prop `optionSets` đã hết dùng), enrollment/page.tsx
- **Ảnh hưởng**: thuần UI, không đổi schema/API/RBAC — tái dùng nguyên logic CRUD đã viết ở đợt trước.
- **Ref**: docs/superpowers/plans/2026-08-03-consolidate-dropdown-values.md (mục 6)

## 2026-08-03 — Consolidate dropdown values (Custom + Category + Option Sets) into /config
- **Loại**: feat, refactor-logic, fix
- **Cái gì**: gộp quản lý mọi dropdown value (custom column + CS Category + Enrollment Option Sets) vào `/config` → tab Dropdown Values, 2 khối theo scope (Custom+Category chung 1 form, nâng cấp thêm màu + sửa-tên-inline; Option Sets port gần nguyên vẹn giữ đủ Terminal/QC + cảnh báo usage-count khi archive, tính qua query mới ở server thay vì load nguyên enrollment records). Loại CS Status/Priority khỏi picker (dropdown system nhưng giá trị hardcode enum, không có nơi lưu). Xoá UI setup cũ khỏi `/tasks` (nút+modal Categories) và `/enrollment` (nút+modal Option sets). Kèm 2 fix có sẵn: Consent giới hạn đúng 2 giá trị active (chặn bug im lặng trong `EnrollmentConsentToggle` khi có option thứ 3 — nó chỉ hiểu "Yes" + 1 option khác); category giờ bắn `broadcastTasksChanged()` (3 route trước đó thiếu) và `/tasks` tự refresh category qua realtime thay vì chỉ lúc mở modal cũ; tương tự `/enrollment` giờ tự refresh option set qua realtime.
- **Vì sao**: user muốn 1 nơi duy nhất set up mọi dropdown, không rải rác 3 trang. Kiến trúc (3 khối, không migrate schema, không gộp 1 picker chung) đã qua review đối kháng 2-agent (1 agent bảo vệ hướng "1 picker chung", 1 agent phản biện độc lập) — agent phản biện thắng vì bằng chứng cụ thể: 3 hệ thống có tính năng lệch cấp (Option Sets có cảnh báo an toàn xuất phát từ 1 sự cố thật, Custom dropdown thì không), ép chung 1 abstraction vẫn rò rỉ field đặc thù (is_terminal/triggers_qc) và cần map-ngược-key dễ vỡ.
- **File**: config/_components/ConfigClient.tsx (mở rộng `ConfigValueSection` + thêm `ConfigOptionSetSection`/`ConfirmDialog`), config/page.tsx, tasks/_components/TaskBoardClient.tsx, tasks/_components/CategoryManager.tsx (xoá), enrollment/_components/EnrollmentClient.tsx (xoá `OptionSetManager` ~260 dòng), enrollment/page.tsx, api/tasks/categories/route.ts, api/tasks/categories/[id]/route.ts
- **Ảnh hưởng**: không đổi schema, không đổi RBAC, không đổi API route sẵn có (trừ thêm broadcast vào category). Admin set up category/option sets chỉ còn ở `/config`.
- **Ref**: docs/superpowers/specs/2026-08-03-consolidate-dropdown-values-design.md, docs/superpowers/plans/2026-08-03-consolidate-dropdown-values.md

## 2026-08-02 — Consolidate Agent/Assistant config into /config + fix Assistant picker source
- **Loại**: refactor-logic, fix
- **Cái gì**: dồn toàn bộ quản lý "ai là Agent" + "ai là Assistant của agent nào" về `/config` → tab Assistant Membership (thêm panel Agents dùng API mới `/api/config/agents`, gate `loadConfigAdmin()`). Khai tử Agent Groups modal trên `/tasks` + 2 route `/api/admin/task-agents`, `/api/admin/agent-members` (đổi gate `isTaskViewAdmin`/`isManager` rời rạc về 1 chuẩn `loadConfigAdmin()`). **Fix bug**: dropdown "Assistant" trước đó cho chọn bất kỳ account active nào trong hệ thống (nguồn `fetchTaskAgentCandidates()`), giờ giới hạn đúng người có quyền `task.work`/`task.manage` (nguồn `fetchTaskAssignees()`, khớp hành vi gốc của Agent Groups modal) — vì Assistant được cấp quyền ngang agent-owner trên task, người không có quyền task.work không vào được `/tasks` nên gán họ là vô nghĩa.
- **Vì sao**: 2 nơi cấu hình cùng 1 dữ liệu (task_agents/agent_members) gây trùng lặp API + UI; user muốn 1 nguồn duy nhất. Nhân tiện sửa luôn nguồn dữ liệu sai của Assistant picker phát hiện trong lúc rà soát.
- **File**: api/config/agents/route.ts (mới), api/admin/{task-agents,agent-members}/route.ts (xoá), config/page.tsx, ConfigClient.tsx, tasks/_components/TaskBoardClient.tsx, tasks/_components/AgentGroupsModal.tsx (xoá)
- **Ảnh hưởng**: không đổi schema, không đổi RBAC permission/role, không đổi ai xem được gì (Enrollment vẫn agent/assistant-agnostic — đã verify). Assistant picker giờ chặt hơn (đúng ý), Agent picker không đổi (vẫn mọi account).
- **Ref**: docs/superpowers/specs/2026-08-02-consolidate-agent-assistant-config-design.md, docs/superpowers/plans/2026-08-02-consolidate-agent-assistant-config.md

## 2026-08-02 — Fix DropdownSelect off-screen popup + Assistant list hidden by single-agent filter
- **Loại**: fix
- **Cái gì**: 2 bug phát hiện lúc test trực tiếp trang `/config` sau đợt consolidate ở trên. (1) `DropdownSelect` (dùng ở 6 chỗ trong `ConfigClient.tsx`) luôn mở popup xuống dưới, không kiểm tra còn chỗ trong viewport hay không — thêm section "Agents" phía trên đẩy form Assistant xuống cuối trang khiến popup mở ra ngoài màn hình; giờ tự tính chỗ trống và lật lên khi cần (giống pattern `useAnchoredMenu`). (2) List "Assistant membership" chỉ hiện assistant của agent đang chọn trong dropdown Agent (mặc định là agent đầu bảng chữ cái), khiến admin tưởng mất data các team khác dù DB vẫn còn nguyên đủ 5 team/13 quan hệ — giờ hiện toàn bộ, sắp theo tên agent rồi tên assistant.
- **Vì sao**: user báo lỗi UI ngay sau khi deploy đợt trên; đã verify trực tiếp DB xác nhận không mất data trước khi sửa, tránh sửa nhầm hướng.
- **File**: config/_components/ConfigClient.tsx (`DropdownSelect`, `ConfigAssistantSection`)
- **Ảnh hưởng**: thuần UI/UX, không đổi API, không đổi dữ liệu.
- **Ref**: bug report trực tiếp từ user kèm screenshot, 2026-08-02/03

## 2026-08-02 — Add Agent column to Enrollment ACA + Medicare
- **Loại**: feat, schema
- **Cái gì**: thêm cột hệ thống `agent_email` cho `enrollment_records` (ACA + Medicare) — agent sở hữu khách hàng, dùng chung danh sách `task_agents` với CS (không phải toàn bộ `portal_account` như Caller/Responsible). Hiện ngay sau Client Name trong list/filter/create dialog/drawer, bắt buộc khi tạo enrollment mới (client + server validate), có trong export và import (system column key `agent`).
- **Vì sao**: user quên thêm cột này lúc thiết kế ban đầu; cần biết record thuộc khách hàng của agent nào để lọc/báo cáo, giống mô hình CS.
- **File**: supabase/schema.sql, src/lib/table-config/queries.ts, src/lib/enrollment/types.ts, src/lib/enrollment/queries.ts, src/app/(authed)/enrollment/page.tsx, src/app/(authed)/enrollment/_components/EnrollmentClient.tsx, src/app/api/enrollment/route.ts, src/app/api/enrollment/[id]/route.ts, src/app/api/enrollment/export/route.ts, src/app/api/config/imports/[id]/route.ts, src/app/api/config/imports/route.ts
- **Ảnh hưởng**: chỉ dữ liệu/filter/hiển thị — KHÔNG đụng quyền xem (enrollment vẫn shared theo Q1) hay quyền sửa (`canMutateEnrollmentRecord` không đổi). Import validate Agent bằng danh sách person chung (parity với Caller/Responsible), không siết theo `task_agents`. User cần tự chạy `schema.sql` để tạo cột `agent_email` + index trước khi dùng.
- **Ref**: docs/superpowers/specs/2026-08-02-enrollment-agent-column-design.md

## 2026-08-02 — Add CS detail custom fields to task creation
- **Loại**: feat
- **Cái gì**: custom columns được bật `show_in_detail` trong CS table configuration giờ xuất hiện trong modal tạo task và được gửi/lưu vào `tasks.custom_values` khi tạo record mới.
- **Vì sao**: detail custom fields cần nhập được ngay lúc tạo task, không chỉ sau khi task đã tồn tại.
- **File**: src/app/(authed)/tasks/_components/TaskBoardClient.tsx, src/app/(authed)/tasks/_components/NewTaskDialog.tsx, src/app/api/tasks/route.ts
- **Ảnh hưởng**: CS New Task modal và create API nhận thêm custom field scalar values; RBAC/assignment/status logic không đổi.
- **Ref**: bug report detail columns missing from New Task modal

## 2026-08-02 — Fix CS custom column value save
- **Loại**: fix
- **Cái gì**: `resolveTaskPatch` giờ công nhận `custom_values` là patch hợp lệ, route task merge custom values đã clean với JSON hiện tại trước khi update DB.
- **Vì sao**: custom-only update từ list/drawer bị `Nothing to update` trước khi tới Supabase nên value không được lưu.
- **File**: src/lib/tasks/transitions.ts, src/app/api/tasks/[id]/route.ts, src/lib/tasks/transitions.test.ts
- **Ảnh hưởng**: custom column values trong CS Task List/Task Drawer lưu được vào `tasks.custom_values`; các rule status/assign/QC không đổi.
- **Ref**: bug report custom column save returns `Nothing to update`

## 2026-08-02 — CS company-wide view + Enrollment shared view + import fixes
- **Loại**: feat, security, refactor-logic
- **Cái gì**:
  - CS plain-CS thấy tất cả task; agent/assistant vẫn bị scope; manager không đổi.
  - CS plain-CS mở/xem/comment được mọi task: thêm `actorSeesAllTasks` short-circuit vào các route view (detail, comments, comments/[cid], comments/[cid]/edits, attachments, attachments/[aid]); activity vẫn owner-only; sửa/status/assign/xóa vẫn khóa. (Fix gap: Q1 mở list nhưng /detail vẫn 403 khi mở task lạ.)
  - Enrollment worker thấy tất cả record, nhưng sửa vẫn giữ manager/stakeholder; non-manager mặc định filter responsible=self.
  - Import có thể close/reject request failed/processing bị kẹt; update import không đổi assignee task.
  - Fix cache assignee list, log activity lỗi khi archive enrollment, xóa dead table-config permissions, normalize person compare và thêm save-error feedback cho custom cell.
- **Vì sao**: CS là hàng đợi chung công ty; enrollment dùng shared view với filter cá nhân; import cần recovery và không được làm mất đa-assignee.
- **File**: lib/tasks/queries.ts, lib/tasks/assignees.ts, lib/tasks/membership.ts, app/api/tasks/[id]/{detail,comments,comments/[cid],comments/[cid]/edits,attachments,attachments/[aid]}/route.ts, lib/enrollment/access.ts, lib/enrollment/queries.ts, lib/enrollment/overview-data.ts, app/api/enrollment/*, app/api/config/imports/[id]/route.ts, ConfigClient.tsx, EnrollmentClient.tsx, EditableCustomCell.tsx
- **Ảnh hưởng**: plain-CS và enrollment workers thấy dữ liệu rộng hơn có chủ ý; mutate/RBAC không đổi.
- **Ref**: docs/superpowers/plans/2026-08-02-view-model-and-batch-fixes.md
