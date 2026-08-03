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
