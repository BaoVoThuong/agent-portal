# Plan tổng — Mọi thao tác phản hồi tức thì (hết cảm giác app "đứng")

Ngày lập: 2026-10-02. Đây là **bản gộp** của hai nguồn:

1. Audit của mình: mọi `fetch` POST/PATCH/PUT/DELETE trong `src/app/(authed)/**` và các API tương ứng.
2. Plan của Codex, [`2026-10-02-ui-action-responsiveness-plan.md`](./2026-10-02-ui-action-responsiveness-plan.md). Plan này **thay thế** file đó. Phần nào lấy, phần nào không và lý do: Phụ lục A.

Bản này đã qua **review vòng 2** (mình và Codex, cùng ngày). Các lỗi tìm được và cách xử lý: Phụ lục B.

Code tính tới commit `cfaa6cd` trên `main`.

**Trạng thái (2026-10-02):** đã code xong Phase 1 (T1.0–T1.2), Phase 2 (T2.0–T2.5, T2.7, T2.8), Phase 3 (T3.1–T3.3, T3.5–T3.7), Phase 4, và phần code của Phase 0 (Server-Timing, log). Chưa làm: đo 13 thao tác trên production (Phase 0 bước 3, người dùng làm tay), đưa checklist vào `AGENTS.md` (Phase 5 bước 3, chờ đồng ý). T2.6 bỏ vì nhắm vào component không còn được dùng (Phụ lục B, dòng 23). Chưa commit.

**Liên quan:**
- [`2026-09-18-task-board-latency.md`](./2026-09-18-task-board-latency.md): đã giảm độ trễ phía server của Task Board (middleware 451 → 25 ms). Cách đo bằng cookie phiên ở mục 1 của plan đó. **Không sửa file này.**
- [`2026-10-02-enrollment-golive-fixes.md`](./2026-10-02-enrollment-golive-fixes.md), đã commit ở `a317b94`. T1.2 ở đây làm luôn phần cuối mục **D3** bên đó (dùng dòng RPC trả về thay cho lần đọc lại). Mục **E1** (`client_request_id` cho tạo hồ sơ) và **H5** (outbox thông báo) bên đó là bước tiếp theo của T2.1 và QĐ-A.
- [`2026-10-02-notification-alerts-mute.md`](./2026-10-02-notification-alerts-mute.md), đã commit ở `39da093`, `9966499`, `4b30a26`.

## Quy ước

- **Node 22:** chạy `export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"` trước các lệnh.
- **Lệnh kiểm:** `npm run typecheck`, `npm run test:run`, `npm run lint`, `npm run build`.
- **Next.js 16:** đọc `node_modules/next/dist/docs/` trước khi dùng API của Next (`after()`, router…). Xem `AGENTS.md`.
- **Changelog:** mọi thay đổi logic ghi vào `changelog.md`.
- **Commit:** **mỗi task một commit riêng**, để revert được từng phần (QĐ-D).
- **Test:** repo chỉ có vitest cho hàm thuần, chưa có test giao diện hay E2E. Hàm thuần mới phải có test. Phần giao diện kiểm tay theo mục 14.

---

## 1. Vấn đề

Người dùng ở **Texas** (agent) và **Việt Nam** (CS). Server chạy ở Vercel **sin1** (Singapore). Từ Texas, **mỗi request** tốn khoảng 200–300 ms đi về, chưa tính thời gian server xử lý.

Nhiều thao tác bắt người dùng chờ **từ 1 tới 4 request nối tiếp** rồi giao diện mới đổi. Cộng lại là 1–5 giây "đứng".

Audit tìm ra **bốn nguyên nhân**, thường chồng lên nhau:

| | Nguyên nhân | Ví dụ |
|---|---|---|
| **A** | **Giao diện không đổi trước.** Nút xoay, form khoá, chờ API trả lời rồi mới hiện kết quả | Tạo task, tạo lead, gán lead, sửa/xoá comment, ghi tương tác lead, gán người ở ACA Overview |
| **B** | **Chờ thêm một lượt tải lại** sau khi API đã trả lời, nhiều khi tải lại **cả danh sách** hoặc **cả trang** | Tạo lead chờ tải lại toàn bộ lead. Xoá comment Enrollment chờ tải lại chi tiết **và** cả danh sách. Bật/tắt hàng đợi ACA tải lại cả Overview. Account Manager, Time Off gọi `router.refresh()` |
| **C** | **Server giữ response** để chạy cho xong realtime, push, rồi mới trả lời | `insertNotifications` tự chờ một lượt phát realtime (`src/lib/tasks/notifications.ts:100`), nên mọi API Task có gửi thông báo đều chờ realtime. Mỗi lượt phát thử tối đa 2 lần, mỗi lần tối đa 1,5 giây (`src/lib/tasks/realtime.ts:30-32`): Realtime chậm thì một lần sửa task bị giữ tới **khoảng 3 giây**. Customer Registration chờ Google Apps Script ghi xong Google Sheet (`src/lib/sheets.ts:90-110`) |
| **D** | **Chưa có quy ước chung** cho thao tác ghi. Cùng một kiểu thao tác, màn này đổi ngay, màn kia khoá cả bảng | Sửa trường Task đổi ngay. Xoá dòng Customer Registration phủ loading lên cả bảng. Một thao tác ở Config khoá cả trang vì một cờ `busy` chung |

Những chỗ đã làm tốt, dùng làm mẫu:
- **Client:** sửa trường, kéo đổi stage, gán người cho task; archive; đăng comment kèm file; reaction comment; đánh dấu đã đọc thông báo; sửa thuộc tính cột ở Config (`ConfigClient.tsx:771-810`); bật/tắt agent trong hộp Distribute (`LeadDistributeDialog.tsx:462-500`); bật/tắt Alerts ở Account Manager (`9966499`). Tất cả **đổi giao diện trước**, lỗi thì hoàn lại.
- **Chống lượt tải cũ đè dữ liệu mới:** Task (`tasksWriteVersionRef` + `taskRefetchDisposition`, `src/lib/tasks/live-sync.ts:48-72`) và danh sách Enrollment (`writeVersionRef` + `beginPending`, `EnrollmentClient.tsx:910-960`).
- **Server:** các API Leads, API comment và file đính kèm của Task đưa realtime và thông báo vào `after()` (chạy nền sau khi đã trả lời).

---

## 2. Mục tiêu đo được

1. **Có phản hồi nhìn thấy trong ≤ 100 ms** sau khi bấm, cho mọi thao tác thường ngày (mức P0/P1 ở mục 4).
2. **Không khoá cả bảng hay cả trang** vì một thao tác trên một dòng.
3. **Lỗi thì luôn hoàn lại** đúng trạng thái trước đó, kèm thông báo đỏ nói rõ cái gì chưa lưu.
4. **Server trả lời ngay sau khi ghi xong dữ liệu.** Phát realtime và push chạy trong `after()`.
5. **Mọi thao tác ghi thuộc một trong ba loại ở mục 3** và làm đúng loại đó.
6. **Không trùng, không mất.** Bấm đúp, thử lại, tải lại giữa chừng đều không tạo bản ghi trùng, không làm mất dòng vừa tạo, không mất thông báo.
7. **Server vẫn quyết định** phân quyền, kiểm tra dữ liệu và mọi kết quả do server tính. Giao diện chỉ hiển thị trước.

---

## 3. Ba loại thao tác ghi

| Loại | Khi bấm, màn hình làm gì | Dùng khi | Ví dụ |
|---|---|---|---|
| **Tức thì** | Hiện **kết quả cuối** ngay. Server trả lời thì thay bằng dữ liệu server; lỗi thì trả về đúng bản trước | Client biết chắc kết quả | Sửa trường, đổi stage, gán một người cụ thể, xoá, bật/tắt, sửa/xoá comment |
| **Lai** | Hiện ngay **trạng thái đang xử lý** tại đúng chỗ: dòng tạm chữ mờ, "Saving…", "Approving…", hộp đóng. **Không** hiện thứ chỉ server tính được. Server trả lời mới hiện kết quả thật | Kết quả cần server: mã CS-…/ACA-…, id, duyệt nghỉ, số dư, số liệu Overview, file tải lên | Tạo task/lead/hồ sơ, ghi tương tác, tải file, duyệt Time Off, thêm người vào hàng đợi ACA |
| **Chờ server** | Giữ cách chờ, nhưng chỉ khoá **đúng nút hoặc hộp** đó, có chữ tiến trình rõ | Bảo mật, phân quyền, số dư, kết quả chia do server tính, xử lý dài, API chưa chống ghi đè | Mật khẩu, đổi role, xoá tài khoản, điều chỉnh số dư phép, chia lead, import/export, chạy statement, AI, hộp lý do Reopen/Unlock (QĐ-C) |

---

## 4. Kết quả audit và phân loại

✅ đã tức thì · ⚠️ đổi ngay nhưng vẫn khoá hoặc chờ thêm · ❌ chờ API mới đổi. Cột **Loại** là loại đích theo mục 3.

### Task CS (`src/app/(authed)/tasks/_components/`)

| Thao tác | Hiện tại | Phải chờ | Loại | Mức | Việc |
|---|---|---|---|---|---|
| Kéo đổi stage, sửa trường, gán/bỏ gán người, archive, QC | ✅ `patchTask` / `changeAssignee` / `deleteTask` (`TaskBoardClient.tsx:1479-1573, 1663, 1863`). Nhưng server giữ response (C), nên lượt sửa kế tiếp trên cùng task phải xếp hàng chờ | C | Tức thì | **P0** | T1.1 |
| **Tạo task** (kèm file) | ❌ `NewTaskDialog.tsx:250-336`: chờ `POST /api/tasks`, rồi **tải từng file một, tuần tự**, rồi mới đóng form | 1 + N request, cộng C | Lai | **P0** | T1.1, T2.1 |
| Gán task ở Overview | ⚠️ `TaskBoardClient.tsx:1773-1820`: Overview đổi ngay, nhưng vòng xoay chờ POST **và** `await loadOverview(true)` | 2 request, cộng C | Tức thì | P1 | T1.1, T2.7 |
| Reopen / Unlock overdue (hộp lý do) | ❌ `:1579-1661`: hộp chờ API | 1 request, cộng C | Chờ server | P2 | T1.1 làm nhanh hơn |
| Công tắc hàng đợi ở Overview | ✅ `:676-709` | — | Tức thì | — | Giữ |
| Sửa đúng lúc người khác vừa đổi task (409) | ❌ Lượt sửa bị **bỏ** (`:1528-1539`; gán người `:1730-1737`) | Phải sửa lại tay | Tức thì | P2 | Phase 4 |

### Comment, dùng chung cho Task CS và Enrollment (`CommentThread.tsx`)

| Thao tác | Hiện tại | Phải chờ | Loại | Mức | Việc |
|---|---|---|---|---|---|
| Đăng comment (kèm file), reaction | ✅ Comment tạm cùng ảnh xem trước, file tải nền (`:889-1060`); reaction có lớp phủ riêng (`:520-530`) | — | Tức thì | — | Giữ, là mẫu chuẩn |
| **Sửa / xoá comment** | ❌ `remove` `:1273-1301`, `edit` `:1303-1345`: chờ API, **rồi chờ `await onReload()`**. Ở Enrollment, `onReload = reloadDetailAndParent` tải lại chi tiết **và cả danh sách** | 2–3 request | Tức thì | **P0** | T2.4 |

### Đính kèm (`AttachmentPanel.tsx`)

| Thao tác | Hiện tại | Phải chờ | Loại | Mức | Việc |
|---|---|---|---|---|---|
| Tải lên | ❌ `:34-72`: chờ API rồi `await onReload()` | 2 request | Lai | — | Bỏ: component không được import ở đâu (T2.6) |
| Xoá | ❌ `:74-111`: như trên | 2 request | Tức thì | — | Bỏ (T2.6) |

### Leads (`src/app/(authed)/tasks/leads/_components/`)

| Thao tác | Hiện tại | Phải chờ | Loại | Mức | Việc |
|---|---|---|---|---|---|
| Sửa ô, archive | ✅ `patchLead` `LeadsClient.tsx:683-759`, `archiveLead` `:761-810`. Nhưng `reload` (`:346`) ghi đè cả danh sách, không phủ lại các lượt sửa đang chờ: lượt tải nền chạy đúng lúc đang lưu làm ô nháy về giá trị cũ | — | Tức thì | P1 | T2.2 |
| **Gán một lead** (từ ô hoặc drawer) | ❌ `assignLead` `:812-846`: ô vẫn hiện người cũ cho tới khi `POST /api/leads/assign` trả lời | 1 request | Tức thì | **P0** | T2.2 |
| Gán hàng loạt | ❌ `assignSelected` `:848-883` | 1 request | Tức thì | P1 | T2.2 |
| **Tạo lead** | ❌ `LeadAddDialog.tsx:355-428`: chờ POST, rồi **chờ `onCreated()` = `reload()` tải lại toàn bộ danh sách lead** (`LeadsClient.tsx:1571`), rồi tải file tuần tự | 2 + N request, một trong số đó nặng | Lai | **P0** | T2.3 |
| **Ghi tương tác, comment trong drawer** | ❌ `InteractionLog.tsx:181-236`: form khoá chờ POST. Comment Leads dùng ô nhập riêng, **không** dùng `CommentThread` | 1 request | Lai | **P0** | T2.5 |
| Bật/tắt agent trong hộp Distribute | ✅ `LeadDistributeDialog.tsx:462-500` | — | Tức thì | — | Giữ |
| Lưu tỉ lệ chia, chia lead, import | Chờ API, khoá đúng hộp (`LeadDistributeDialog.tsx:353-383, 528-576`, `LeadImportDialog.tsx`) | — | Chờ server | — | Giữ. Kết quả chia do server tính |

### Enrollment (`src/app/(authed)/enrollment/_components/`)

| Thao tác | Hiện tại | Phải chờ | Loại | Mức | Việc |
|---|---|---|---|---|---|
| Sửa trường, đổi stage/người/QC, archive | ✅ `patchRecord`, `archiveRecord` (`EnrollmentClient.tsx:1777`). Nhưng server giữ response cho realtime thông báo và một lần đọc lại hồ sơ (C) | C | Tức thì | **P0** | T1.2 |
| **Tạo hồ sơ** | ❌ `createRecord` `EnrollmentClient.tsx:1712` và `onCreate` `:2109`: chờ POST (cộng C), rồi file, rồi đọc lại hồ sơ, rồi mới đóng form | 3+ request, cộng C | Lai | **P0** | T1.2, T2.1 |
| Reopen (hộp lý do) | ❌ Hộp chờ API | 1 request | Chờ server | P2 | Giữ |
| Sửa / xoá comment | ❌ Xem bảng Comment | | Tức thì | **P0** | T2.4 |
| **ACA Overview: gán người phụ trách** | ❌ `AcaAssignPicker.tsx:8-17`: ô vẫn hiện người cũ và bị khoá tới khi `PATCH /api/enrollment/[id]` xong | 1 request, cộng C | Tức thì | P1 | T1.2, T2.8 |
| **ACA Overview: bật/tắt hàng đợi** | ❌ `AcaOverviewDashboard.tsx:69-80`: ô tick khoá, chờ PATCH **rồi `await load()` tải lại cả Overview** | 2 request, một nặng | Lai | P1 | T2.8 |
| Import | Chờ API | — | Chờ server | — | Mục 12 |

### Customer Registration (`customer-registration/health/EntryGrid.tsx`, `customer-registration/pc/PcEntryGrid.tsx`)

Màn agent dùng hằng ngày. Mọi API ghi ở đây (`src/app/api/entries/**`, `src/app/api/pc-entries/**`) còn chờ Google Apps Script ghi Sheet xong mới trả lời (C, xem QĐ-F). Hai file grid có cùng các hàm; bên P&C lệch khoảng 15 dòng. `loadHistory` (`EntryGrid.tsx:381-393`) **tự bật `setLoading(true)`**, mà `loading` gắn vào overlay của cả bảng (`:693`): mọi lượt tải lại, kể cả chạy nền, đều phủ loading lên cả bảng.

| Thao tác | Hiện tại | Phải chờ | Loại | Mức | Việc |
|---|---|---|---|---|---|
| Gửi dòng mới | ❌ `handleSubmit` `EntryGrid.tsx:469-530` (P&C `:484`): chờ POST rồi `await loadHistory()` | 2 request + Apps Script | Chờ server (QĐ-F) | P1 | T3.3 |
| Xoá dòng | ❌ `handleDelete` `:395-410` (P&C `:410`): **phủ loading lên cả bảng** tới khi xoá và tải lại xong | 2 request + Apps Script | Tức thì | P1 | T3.3 |
| Sửa trong hộp | ❌ `handleUpdate` `:412-435` (P&C `:427`): chờ PATCH rồi tải lại | 2 request + Apps Script | Tức thì | P1 | T3.3 |
| Sửa thẳng trong ô | ✅ AG Grid hiện giá trị mới. Lỗi thì tải lại **cả bảng** (có overlay) để lấy giá trị cũ (`onHistoryCellValueChanged` `:442-460`, P&C `:457`) | — | Tức thì | P3 | T3.3 |

### Màn khác

| Màn | Thao tác | Hiện tại | Loại | Mức | Việc |
|---|---|---|---|---|---|
| Chuông thông báo | Đánh dấu đã đọc, đọc hết | ⚠️ Đổi ngay, nhưng lỗi thì **không** hoàn lại và không kiểm `response.ok` (`NotificationBell.tsx:482-503`) | Tức thì | P3 | T3.5 |
| Account Manager | Bật/tắt Alerts | ⚠️ Đổi ngay (`9966499`), nhưng `busyUserId` khoá **cả dòng**: các nút Edit, Role, Reset, Delete (`AccountManagerClient.tsx:386, 501, 531-608`) | Tức thì | P2 | T3.1 |
| Account Manager | Sửa tên, agent ID | ❌ Chờ API; bảng chỉ đổi sau `router.refresh()` dựng lại cả trang (`:245-316`) | Tức thì | P2 | T3.1 |
| Account Manager | Tạo tài khoản, đổi role, reset mật khẩu, xoá | Chờ API + `router.refresh()` (`:209-243`, `:317-365`) | Chờ server | — | Giữ. `POST /api/admin/users` chỉ trả trường cơ bản, chưa đủ để dựng dòng (Phụ lục B) |
| Time Off | Duyệt, từ chối, huỷ đơn | ❌ Chờ PATCH; khi duyệt còn `await refreshVisibleCalendar()` (`TimeOffClient.tsx:560-586`) | Lai | P1 | T3.2 |
| Time Off | Thêm, xoá ngày lễ | ❌ Chờ API rồi `await refreshVisibleCalendar()` (`:588-609`, `:688-700`) | Chờ server | P2 | T3.2 |
| Time Off | Gửi đơn; điều chỉnh số dư, cộng phép tháng, điều chỉnh hàng loạt | Chờ API, khoá đúng hộp (`:526-550`, `:611-686`) | Chờ server | — | Giữ. Số dư do server tính |
| Provider List | Sửa provider (hộp sửa) | Hộp chờ PATCH xong mới đóng (`ProviderListClient.tsx:252-268`, `ProviderEditDialog.tsx:48-61`). API **chưa chống ghi đè**: cập nhật theo `id`, `custom_values` đọc rồi ghi lại (`src/app/api/automation/provider-list/[id]/route.ts:38-112`) | Chờ server (tạm) | P3 | Mục 12 |
| Settings | Đổi tên hiển thị, đổi mật khẩu | Form chờ API; ô nhập đã hiện giá trị mới (`SettingsClient.tsx:52-121`) | Chờ server | — | Giữ |
| Settings | Đổi, xoá ảnh đại diện | ❌ Chờ tải lên rồi `router.refresh()` (`:123-170`) | Lai | P3 | T3.6 |
| Config | Sửa thuộc tính cột | ✅ `patchColumn` (`ConfigClient.tsx:771-810`) | Tức thì | — | Giữ, là mẫu chuẩn |
| Config | Bật/tắt SLA | ⚠️ Khoá riêng từng ô, nhưng công tắc chỉ đổi sau API (`ConfigSlaSection.tsx:142-184`). API có `expected_updated_at` và trả về rule chuẩn | Tức thì | P3 | **T2.0 (thí điểm)** |
| Config | Bật/tắt rule stage (Terminal, QC) | ⚠️ Khoá riêng từng stage, nhưng công tắc chỉ đổi sau PATCH **và** tải lại (`ConfigClient.tsx:1885-1920`) | Tức thì | P3 | T3.7 |
| Config | Kéo sắp xếp cột; thêm, đổi tên, đổi màu, archive giá trị; assistant | ❌/⚠️ Đều chạy qua `run()` (`:367-392`), bật **một cờ `busy` chung** truyền xuống mọi mục (`:469, 494, 526`) | Chờ server (tạm) | P3 | Mục 12 |
| Role Manager | Tạo, sửa, xoá role | Chờ API + `router.refresh()` (`RoleManagerClient.tsx:194-295`) | Chờ server | — | Giữ (phân quyền) |
| Config alert Leads, mặc định tháng báo cáo | Lưu form (`ConfigAlertSection.tsx:71`, `ReportMonthDefaultEditor.tsx:96`) | Chờ API | Chờ server | — | Giữ |
| Import (Lead, Enrollment, Provider), Statement P&C/Health, Provider Finder, AI chat | Xử lý dài | Chờ API | Chờ server | — | Mục 12 |

### Server (nguyên nhân C)

`insertNotifications` (Task) và `insertEnrollmentNotifications` đều **ghi dòng thông báo rồi tự chờ một lượt phát realtime** (`src/lib/tasks/notifications.ts:89-110`, `src/lib/enrollment/notifications.ts:14-62`). Vì vậy **chờ thông báo là chờ cả realtime**. Phần ghi dòng là dữ liệu nghiệp vụ, phải giữ trong request (QĐ-A); phần phát realtime/push thì dời được.

| API | Đang giữ response cho | Mức | Việc |
|---|---|---|---|
| `POST /api/tasks` | Rotation, thông báo, realtime (`settleSideEffects`, `src/app/api/tasks/route.ts:368`) | **P0** | T1.1 |
| `PATCH /api/tasks/[id]` | Thông báo (`:628`), **2 lượt phát realtime** (`:641`) | **P0** | T1.1 |
| `DELETE /api/tasks/[id]` (archive) | Phát realtime (`:723`) | P1 | T1.1 |
| `POST /api/tasks/[id]/assign` (Overview) | Thông báo + 2 lượt realtime (`:99`) | **P0** | T1.1 |
| `POST /api/tasks/[id]/assignees`, `DELETE …/assignees/[email]` | Thông báo cho người được gán (`assignees/route.ts:173`, `assignees/[email]/route.ts:137`). Realtime chính đã ở `after()` | **P0** | T1.1 |
| `POST /api/tasks/[id]/reopen`, `POST …/overdue-unlock` | Thông báo + realtime (`reopen/route.ts:128, 150`; `overdue-unlock/route.ts:170, 194`) | P2 | T1.1 |
| `POST /api/enrollment` | Thông báo (`src/app/api/enrollment/route.ts:363-399`) | **P0** | T1.2 |
| `PATCH /api/enrollment/[id]` | Thông báo (`:607`), **đọc lại hồ sơ** (3 truy vấn, `:627`) | **P0** | T1.2 |
| `/api/entries/**`, `/api/pc-entries/**` | Google Apps Script ghi Sheet (`entries/route.ts:132`, `entries/[id]/route.ts:114, 168`; P&C tương tự) | P2 | QĐ-F |
| Các API Leads; comment và file đính kèm Task | Đã đưa vào `after()` | — | Mẫu chuẩn |

---

## 5. Nguyên tắc (dùng khi review code)

1. **Đổi giao diện trước, gọi API sau.** Lưu bản trước khi đổi; lỗi thì hoàn lại đúng bản đó và hiện thông báo đỏ nói rõ cái gì chưa lưu.
2. **Dữ liệu server trả về là chuẩn.** Thành công thì thay phần tạm bằng dữ liệu server trả về, kể cả khi sau đó còn một lượt tải lại nền.
3. **Không `await` việc tải lại sau khi ghi.** Cần tải lại thì gọi chạy nền, không khoá nút, không bật overlay.
4. **Form tạo đóng ngay khi server tạo xong** (QĐ-B). File đính kèm tải **nền**, song song tối đa 3 file, có tiến trình. Lỗi file thì báo kèm cách thử lại. Còn file đang tải mà người dùng đóng tab thì trình duyệt hỏi lại (`beforeunload`); đây chỉ là lời nhắc, không bảo đảm file tải xong.
5. **Khoá đúng phạm vi.** Chỉ khoá ô, dòng hoặc nút đang lưu, không phủ loading lên cả bảng hay cả trang. Chống bấm đúp bằng khoá theo key (`usePendingKeys`, T2.0).
6. **Không bịa kết quả do server tính.** Người được chia round-robin, kết quả duyệt nghỉ, số dư phép, số liệu Overview (Open, Over limit), mã CS-…/ACA-…: chỉ hiện khi server trả về. Trong lúc chờ thì hiện trạng thái đang xử lý (loại Lai).
7. **Tải lại nền không được đè thay đổi đang chờ.** Giá trị tạm nằm ở **lớp phủ** (map theo id) và được áp lên dữ liệu tải về; một lượt tải bắt đầu **trước** một lần ghi thì không được áp kết quả mà phải chạy lại. Task và danh sách Enrollment đã có cơ chế này (mục 1). Leads chưa có: T2.2 thêm.
8. **Server trả lời ngay sau khi ghi xong dữ liệu.** Thứ là **dữ liệu nghiệp vụ** (dòng thông báo, rotation) vẫn ghi trong request. Thứ chỉ là **phát đi** (realtime, push) chạy trong `after()`. Chỉ gọi `after()` sau khi ghi DB thành công.
9. **Thao tác lặp phải an toàn.** Tạo mới phải có `client_request_id` (Task, Lead đã có; Enrollment chưa có, là mục E1 ở plan go-live). File tải lên giữ một key cố định cho mỗi file. Các lượt ghi nối tiếp trên cùng một bản ghi phải xếp hàng (`createKeyedSerializer`, `state.tail`).
10. **Lượt cũ không đè lượt mới.** Khi nhiều lượt ghi cùng một bản ghi chồng nhau, lượt cũ xong sau (thành công hay lỗi) không được ghi đè kết quả của lượt mới hơn (`isLatest`, T2.0).
11. **Phân quyền vẫn ở server.** Đổi giao diện trước chỉ là hiển thị; server từ chối thì hoàn lại. Phần tạm không được chèn dữ liệu mà người dùng không được xem.

---

## 6. Quyết định

| QĐ | Câu hỏi | Chốt |
|---|---|---|
| **QĐ-A** | Dời thông báo vào `after()` tới đâu? | **Chỉ dời phần phát đi.** `after()` là chạy nền, không phải hàng đợi bền: function hỏng giữa chừng thì việc trong đó mất. Nên **ghi dòng thông báo vẫn trong request**, như hiện tại; chỉ **phát realtime và push** chạy trong `after()`. Nhờ vậy `warnings` vẫn báo đúng khi ghi dòng lỗi, toast "Saved. Some notifications could not be sent." của Enrollment vẫn đúng nghĩa. Đích lâu dài là outbox thông báo (H5 ở plan go-live) |
| **QĐ-B** | Tạo task/lead/hồ sơ: đóng form khi server **đã tạo xong**, hay **ngay khi bấm**? | **Khi server đã tạo xong.** Lỗi kiểm tra dữ liệu vẫn hiện ngay trên form. Cái chậm nhất là **file** và **lượt tải lại**, đều được bỏ khỏi đường chờ |
| **QĐ-C** | Hộp lý do (Reopen, Unlock overdue) có đóng ngay không? | **Giữ cách chờ.** Ít dùng và có kiểm tra phía server. T1.1 làm nó nhanh hơn |
| **QĐ-D** | Deploy xong mà hỏng thì quay lại bằng feature flag hay bằng revert? | **Revert, không dùng flag.** Mỗi task một commit; deploy theo từng module, không gom cả Phase 1–3 vào một lần. Hỏng thì `git revert` đúng commit đó, hoặc Promote bản deploy trước trên Vercel |
| **QĐ-E** | Bộ khung optimistic dùng chung (T2.0) áp cho mọi chỗ hay chỉ chỗ mới? | **Chỉ cho luồng mới hoặc luồng được sửa trong plan này.** `patchTask`, `patchLead`, `patchRecord` đã có hàng đợi, rebase, hoàn lại và đang chạy ổn |
| **QĐ-F** | Customer Registration chờ Google Apps Script ghi Sheet. Có dời việc này vào `after()` không? | **Chưa dời.** Lúc tạo, cảnh báo "Google Sheet sync failed" là tín hiệu duy nhất agent thấy khi Sheet thiếu dòng. Sửa và xoá sẽ đổi giao diện ngay nhờ T3.3. Phase 0 đo; nếu tạo mất trên 2 giây thì lập plan riêng: `after()`, cột đánh dấu dòng ghi Sheet lỗi, cron ghi bù |
| **QĐ-G** | Hai manager gán cùng một lead gần như cùng lúc thì sao? | **Giữ quy tắc hiện tại: ai ghi sau thắng.** `POST /api/leads/assign` không kiểm `updated_at`; RPC `assign_leads_manual` ghi lịch sử nên lần gán đè vẫn nhìn thấy được. Plan này không đổi quy tắc đó; `createKeyedSerializer` chỉ xếp hàng trong một trình duyệt |

---

## 7. Phase 0 — Đo mốc (khoảng nửa ngày)

1. **Thêm đo thời gian phía server** (`RouteTiming`, `src/lib/server-timing.ts`) cho các API ghi: `POST /api/tasks`, `PATCH /api/tasks/[id]`, `POST /api/enrollment`, `PATCH /api/enrollment/[id]`, `POST /api/entries`. Mỗi route đánh dấu các mốc: `auth`, `write` (RPC/insert), `notify` (ghi dòng thông báo) hoặc `sheet`. Kết quả hiện trong DevTools → Network → Timing → Server Timing.
2. **Log có tên cố định**, thay cho telemetry phía client trong plan Codex (Phụ lục A). Chỉ ghi id, **không** ghi nội dung khách hàng hay tên file:
   - API Task, Enrollment khi trả 409: `console.warn("mutation.conflict", { route, id })`.
   - Việc chạy trong `after()` bị lỗi: `"<module>.<action>.delivery_failed"`, ví dụ `task.update.delivery_failed`.
3. **Đo 13 thao tác** (danh sách ở mục 13). Mỗi thao tác ghi hai con số: **(a)** từ lúc bấm tới khi màn hình đổi; **(b)** từ lúc bấm tới khi xong hẳn. Đo bằng tab Performance hoặc Network; giả lập Texas bằng cách thêm khoảng 250 ms trễ (Network → Throttling → Add custom profile).
   - Đo trên production nghĩa là **tạo dữ liệu thật**. Dùng bản ghi thử có tên dễ nhận ("TEST perf …") và archive ngay sau khi đo. Bước này do người dùng làm tay.
4. Điền bảng số liệu ở mục 13. Sau mỗi phase đo lại đúng 13 thao tác đó.

Thời gian **tải trang** `/tasks` (danh sách đầy đủ, đếm, gán người, config) là việc riêng, không thuộc plan này: xem plan latency và plan scale của Task Board.

---

## 8. Phase 1 — Server trả lời ngay sau khi ghi xong dữ liệu

Việc rẻ nhất mà lợi rộng nhất. Mọi thao tác Task/Enrollment đều nhanh lên, kể cả những thao tác client đã đổi giao diện trước, vì lượt sửa sau trên cùng bản ghi đang xếp hàng chờ lượt trước.

### T1.0 — Tách "ghi dòng thông báo" khỏi "phát đi"

`src/lib/tasks/notifications.ts:89-110` và `src/lib/enrollment/notifications.ts:14-62` thêm một tuỳ chọn, mặc định giữ nguyên hành vi cũ để các nơi gọi khác (cron, comment…) không đổi:

```ts
export async function insertNotifications(
  rows: NotificationInsertInput[],
  options: { deliverAfterResponse?: boolean } = {},
): Promise<boolean> {
  if (rows.length === 0) return true;
  // Ghi dòng: dữ liệu nghiệp vụ, luôn trong request.
  const { error } = await getSupabaseAdmin().from("task_notifications").insert(toNotificationInsertRows(rows));
  if (error) throw new Error(error.message);
  // Phát realtime + push: chạy sau response nếu được yêu cầu và đang trong request scope.
  if (options.deliverAfterResponse && (await runAfterResponse(() => deliverTaskNotifications(rows)))) {
    return true;
  }
  return deliverTaskNotifications(rows);
}
```

- `deliverTaskNotifications(rows)`: `broadcastNotif` rồi push **gọi thẳng**, không lồng `after()` bên trong (`after()` lồng nhau vẫn hợp lệ theo docs, `after.md:56`, nhưng gọi thẳng thì dễ đọc và log đúng chỗ). Lỗi chỉ ghi log `task.notification.delivery_failed`, không ném.
- `runAfterResponse(run)`: gọi `after(run)`; trả `false` nếu đang ngoài request scope (script, test) để nơi gọi chạy luôn.
- Enrollment làm y hệt: lọc người nhận theo quyền xem và ghi dòng vẫn trong request; chỉ `broadcastNotif` và push dời đi.

**Test:** với `deliverAfterResponse`, hàm trả về ngay sau khi ghi dòng và không gọi `broadcastNotif` trước khi trả (mock `after`); không có tuỳ chọn thì hành vi như cũ.

### T1.1 — API Task: realtime và push vào `after()`

Mẫu đã có ở API Leads, ví dụ `src/app/api/leads/[id]/route.ts:274-277`:

```ts
after(async () => {
  await broadcastLeadsChanged(sourceId, [id]);
});
return NextResponse.json({ lead: withEventName(data) });
```

**Lưu ý chung:**
- **Rotation giữ trong request.** `bumpAssignmentRotation` (`src/lib/tasks/rotation.ts:31`) quyết định ai được gán kế tiếp ở Overview. Dời ra sau response thì hai task tạo sát nhau có thể tính trên hàng đợi cũ.
- **Ghi dòng thông báo giữ trong request** (QĐ-A), gọi `insertNotifications(rows, { deliverAfterResponse: true })`.
- **Chỉ gọi `after()` sau khi ghi DB thành công.** Callback của `after()` vẫn chạy kể cả khi route trả lỗi sau đó (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md:54`).
- **Đọc header trước `after()`**: `const sourceId = readTaskMutationSourceId(req)`, như route comment (`src/app/api/tasks/[id]/comments/route.ts:183-186`).

1. **`POST /api/tasks`** (`src/app/api/tasks/route.ts:368-432`): rotation và thông báo vẫn trong `settleSideEffects` đang `await`, nhưng thông báo gọi với `deliverAfterResponse`. Mục broadcast (`broadcastTasksChanged`) ra khỏi danh sách đó, vào `after()`.
2. **`PATCH /api/tasks/[id]`** (`src/app/api/tasks/[id]/route.ts:628-659`): thông báo dùng `deliverAfterResponse`; `broadcastResults` (2 lượt phát) vào `after()`. Khoản chờ tới khoảng 3 giây ở mục 1 biến khỏi đường chờ.
3. **`DELETE /api/tasks/[id]`** (archive, `:723-730`): `broadcastResult` vào `after()`.
4. **`POST /api/tasks/[id]/assign`** (`assign/route.ts:99-130`): thông báo dùng `deliverAfterResponse`; 2 mục broadcast vào `after()`.
5. **`POST /api/tasks/[id]/assignees`** (`assignees/route.ts:172-195`) và **`DELETE …/assignees/[email]`** (`assignees/[email]/route.ts:136-160`): thông báo dùng `deliverAfterResponse`. Rotation phía trên và `after()` broadcast sẵn có giữ nguyên.
6. **`POST /api/tasks/[id]/reopen`** (`reopen/route.ts:128, 150`) và **`POST …/overdue-unlock`** (`overdue-unlock/route.ts:170, 194`): thông báo dùng `deliverAfterResponse`; broadcast vào `after()`.

**Kiểm tay:** sửa task ở tab A → tab B vẫn cập nhật trong khoảng 1 giây. Người được gán vẫn nhận thông báo và tiếng "ting".

### T1.2 — API Enrollment: realtime thông báo vào `after()`, bỏ lần đọc lại thừa

> Trước khi sửa: `git status` và `git log -3 --` hai file route dưới đây, để chắc phiên go-live không còn sửa dở.

1. **`POST /api/enrollment`** (`src/app/api/enrollment/route.ts:363-399`): `insertEnrollmentNotifications(rows, { deliverAfterResponse: true })`. Tra manager (`:347-354`) vẫn trong request vì cần để dựng danh sách người nhận.
2. **`PATCH /api/enrollment/[id]`** (`src/app/api/enrollment/[id]/route.ts`):
   - `insertEnrollmentNotifications(notifications, { deliverAfterResponse: true })` (`:606-612`).
   - **Bỏ** `record = await fetchEnrollmentRecordById(id)` (`:625-632`, 3 truy vấn). RPC `patch_enrollment_atomic` trả về **cả dòng** (`to_jsonb(next_record)`, `supabase/schema.sql:5264`), nên ghép với số đếm đã có là đủ:

     ```ts
     record: {
       description: null,
       custom_values: {},
       ...updated,
       comment_count: scoped.record.comment_count,
       attachment_count: scoped.record.attachment_count,
     },
     ```

     `scoped.record` có kiểu `EnrollmentRecordWithStats` (`src/lib/enrollment/scope.ts:168-190`); biến `current` ở `:143` đã ép về `EnrollmentRecord` nên không dùng được cho số đếm. Hai giá trị mặc định là đúng việc `coerceEnrollmentRecord` (`src/lib/enrollment/queries.ts:329-335`) đang làm.
   - Đây là phần cuối mục **D3** ở plan go-live.

**Kiểm tay:** tạo hồ sơ có stage bắt QC → form đóng nhanh; manager vẫn nhận `qc_needed`. Đổi stage hồ sơ → dòng đổi ngay, số comment và số file trên dòng không bị về 0.

---

## 9. Phase 2 — Bộ khung dùng chung và thao tác hằng ngày

### T2.0 — Bộ khung dùng chung, ba mẫu, thí điểm ở công tắc SLA

**1. `src/lib/collaboration/optimistic.ts`** (thuần, có test):

```ts
export class MutationError extends Error {
  constructor(message: string, readonly status: number, readonly payload: unknown = null) {
    super(message);
    this.name = "MutationError";
  }
  /** 0 = không tới được server (mất mạng, request bị chặn). */
  get isNetwork() { return this.status === 0; }
  get isConflict() { return this.status === 409; }
}

/** fetch + đọc JSON. Mất mạng thì status 0; HTTP lỗi thì ném kèm `error` API trả về. */
export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T>;

/** Đánh số các lượt ghi theo key, để lượt cũ không đè kết quả của lượt mới hơn (nguyên tắc 10). */
export function createMutationTracker(): {
  begin(key: string): { isLatest(): boolean; end(): void };
};

export type OptimisticResult<T> = { ok: true; value: T } | { ok: false; error: MutationError };

/**
 * Đổi giao diện (`apply`) → gọi API (`request`) → thành công thì `commit` bằng dữ liệu
 * server, lỗi thì `rollback`. `commit`/`rollback` chỉ chạy khi lượt này còn là lượt mới
 * nhất (`isLatest`); lượt mới hơn sẽ tự quyết trạng thái cuối. Không tự hiện lỗi.
 */
export async function runOptimistic<T>(steps: {
  apply: () => void;
  request: () => Promise<T>;
  commit?: (value: T) => void;
  rollback: (error: MutationError) => void;
  isLatest?: () => boolean;
}): Promise<OptimisticResult<T>>;
```

`apply` nằm trong `try`: nó ném thì coi như lượt ghi hỏng, không gọi API.

**2. `createKeyedSerializer`:** chuyển từ `src/lib/leads/list-state.ts:43-58` sang `src/lib/collaboration/keyed-serializer.ts`. `list-state.ts` export lại để import cũ vẫn chạy.

**3. `src/lib/collaboration/use-pending-keys.ts`:** khoá theo key, chống bấm đúp. Kiểm bằng ref nên bấm đúp trong cùng một tick vẫn bị chặn; trả về `pending` (state để render), `start(key)` (false nếu key đang chạy), `finish(key)`.

**Ba mẫu áp dụng.** Các task sau trỏ tới đây:

- **Mẫu A — Thao tác trên ô hoặc dòng** (gán, bật/tắt, xoá): `runOptimistic`. Giá trị tạm nằm ở lớp phủ theo id nếu màn hình có tải lại nền (nguyên tắc 7). `rollback` chỉ trả lại đúng các field của lượt đó.
- **Mẫu B — Hộp sửa nhiều trường:** bấm Save thì hộp đóng ngay và dòng đổi ngay theo Mẫu A. Lỗi thì dòng trả lại, hộp **mở lại** với đúng dữ liệu vừa nhập kèm lỗi.
- **Mẫu C — Tạo mới (Lai):** theo QĐ-B. Form đóng khi server tạo xong, chèn dòng server trả về (lượt ghi này đi qua cơ chế chống đè, nguyên tắc 7). File tải nền bằng `uploadWithConcurrency` (T2.1).

**Thí điểm: công tắc SLA** (`ConfigSlaSection.toggle`, `:142-184`). Chọn chỗ này vì: chỉ admin dùng, một hàm, API **đã** có `expected_updated_at`, trả 409 và trả rule chuẩn. (Bản trước chọn Provider List; review vòng 2 bỏ vì API Provider chưa chống ghi đè, Phụ lục B.)
- Lớp phủ `enabledOverrides: Map<key, boolean>`; công tắc hiển thị override nếu có.
- `apply`: đặt override. `commit`: `onRulesChange` với rule server trả về, bỏ override. `rollback`: bỏ override, hiện lỗi; 409 thì tải lại rules như hiện tại.
- Khoá theo ô giữ nguyên (`markSaving(key)`), vì lượt sau cần `updated_at` mới.

**Test** (`src/lib/collaboration/optimistic.test.ts`):
1. `apply` chạy trước khi `request` xong.
2. Thành công: `commit` nhận dữ liệu server, `rollback` không chạy.
3. HTTP 409: `rollback` nhận lỗi có `isConflict`; mất mạng: lỗi có `status` 0.
4. Lượt cũ xong sau lượt mới: không `commit`, không `rollback`.
5. `requestJson`: body là chuỗi thì tự thêm `Content-Type: application/json`; body là `FormData` thì không.

### T2.1 — Tạo task / tạo hồ sơ Enrollment: đóng form khi server đã tạo, file tải nền song song

Mẫu C. **Hàm dùng chung mới**, `src/lib/attachments/background-uploads.ts` (thuần, có test):

```ts
/**
 * Chạy `upload` cho từng mục, tối đa `concurrency` mục cùng lúc (ít nhất 1).
 * Trả về các mục lỗi THEO THỨ TỰ ĐẦU VÀO. `onSettled` báo tiến trình từng mục.
 */
export async function uploadWithConcurrency<T>(
  items: readonly T[],
  upload: (item: T) => Promise<boolean>,
  options: { concurrency?: number; onSettled?: (item: T, ok: boolean) => void } = {},
): Promise<T[]>;
```

**Task** (`NewTaskDialog.tsx:250-336`, `TaskBoardClient.tsx:1822-1861`):
1. `submit()`: sau khi `onCreate(...)` trả về `created`, **đóng form ngay**, rồi giao file cho `TaskBoardClient` qua prop mới `onBackgroundUpload(created, files)`. Mỗi file giữ key cố định (`item.key`) làm `client_request_id`.
2. `TaskBoardClient` chạy `uploadWithConcurrency` với `POST /api/tasks/{id}/attachments` (`silent=1`), báo tiến trình qua dòng thông báo ("Uploading 2 files to CS-123…"); xong thì "Files attached"; lỗi thì "1 file did not upload to CS-123 — open the task to attach it again". Xong thì `publishTaskDataInvalidation({ taskId })`.
3. Task mới không cần thêm gì để sống qua lượt tải nền: `createTask` ghi qua `updateTasks` (`:1380-1390`), làm tăng `tasksWriteVersionRef`.
4. Còn file đang tải thì đăng ký `beforeunload` (mẫu ở `NewEnrollmentDialog`, `EnrollmentClient.tsx:4920-4928`).

**Enrollment** (`EnrollmentClient.tsx:1712`, `:2109`):
- `createRecord` trả về ngay khi POST xong; form đóng, drawer mở.
- File và lần đọc lại hồ sơ (bản sửa lỗi Cheryl) chạy nền. Phần đọc lại phải giữ vì nó cập nhật `updated_at`; nếu người dùng sửa trong lúc file đang tải, `patchRecord` đã tự gửi lại khi bị 409 (`canRetryAfterConflict`).
- Danh sách đã an toàn: `createRecord` tăng `writeVersionRef` và giữ `beginPending` trong lúc POST.
- `uploadEnrollmentFiles` (`:1688-1710`) đang tạo `client_request_id` mới mỗi lần gọi. Đổi sang key cố định cho mỗi file, và dùng `uploadWithConcurrency` thay `Promise.all` không giới hạn.
- Chưa có `client_request_id` cho chính hồ sơ (E1 ở plan go-live): mất mạng đúng lúc tạo rồi bấm lại vẫn có thể ra hồ sơ trùng, như hiện nay.

**Test:** `uploadWithConcurrency` không bao giờ chạy quá giới hạn; `concurrency` ≤ 0 vẫn chạy 1; trả mục lỗi theo thứ tự đầu vào; danh sách rỗng thì trả `[]`; `onSettled` được gọi đủ.

### T2.2 — Leads: lớp phủ cho tải lại nền, gán lead đổi ngay

`LeadsClient.tsx`:
1. **Sửa `reload`** (`:328-372`):
   - Phủ lại các lượt sửa đang chờ lên dữ liệu tải về: mỗi lead có trong `pendingPatchesRef` (`:676`) thì `overlayPendingPatches(lead, pending)`, như `patchLead` đang làm với response (`:721`).
   - Thêm bộ đếm ghi `leadsWriteVersionRef`, tăng mỗi lần ghi cục bộ (chèn lead mới, gán). Lượt tải bắt đầu trước một lần ghi thì không áp, đặt `pendingRefresh.current = true` để chạy lại (giống `taskRefetchDisposition`).
2. **Gán một lead** (`assignLead`, `:812-846`): đi đúng đường của `patchLead`. Đẩy `{ assigned_to_email: toEmail }` vào `pendingPatchesRef`, đổi dòng và drawer bằng `mergeLeadPatch`, gửi `POST /api/leads/assign` qua `patchSerializerRef.current(id, …)` để xếp hàng chung với lượt sửa. Thành công thì `updateLead(overlayPendingPatches(saved, pending))`; lỗi thì trả bản trước (giữ các lượt sau đang chờ) như `patchLead` (`:735-756`).
3. **Gán hàng loạt** (`assignSelected`, `:848-883`): đổi ngay mọi dòng trong `selected` (cùng lớp phủ), bỏ chọn, gửi một request. Dòng có trong `selected` mà không có trong kết quả thì hoàn lại riêng dòng đó và báo "2 of 10 leads were not assigned". Lỗi cả request thì hoàn lại cả nhóm. Nhánh `await reload()` đổi thành `void`.
4. Chỉ đổi `assigned_to_email`; các field server tự đổi (`assigned_at`…) để server trả về (nguyên tắc 6). Quy tắc ai ghi sau thắng giữ nguyên (QĐ-G).

**Kiểm tay:** đổi Agent của lead → tên đổi ngay. Chặn `api/leads/assign` → tên quay về, hiện lỗi. Sửa một ô rồi bấm Refresh ngay → ô không nháy về giá trị cũ.

### T2.3 — Tạo lead: không chờ tải lại cả danh sách

`LeadAddDialog.tsx:355-428`, `LeadsClient.tsx:1571`:
1. Đổi prop `onCreated()` thành `onCreated(lead: LeadRow)`, **không** `await`.
2. `LeadsClient` tăng `leadsWriteVersionRef`, rồi gọi `patchLeadsByIdRef.current([lead.id])` (`:383-430`): một request nhẹ, mang bộ lọc đang bật, trả dòng đúng dạng danh sách (có `event_name`, `interaction_history`) và tự chèn lead nếu nó khớp bộ lọc. Lỗi thì `void reload()`. **Không** chèn thẳng `payload.lead` của POST: dòng đó thiếu `event_name` và `interaction_history` (POST chọn `LEAD_COLUMNS`, `src/app/api/leads/route.ts:51`, còn danh sách dùng `LEAD_LIST_COLUMNS`, `src/lib/leads/queries.ts:135-136`).
3. File: theo T2.1. Đóng form ngay, tải nền bằng `uploadWithConcurrency`, báo tiến trình.

### T2.4 — Sửa / xoá comment: đổi ngay, tải lại chạy nền

Mẫu A. `CommentThread.tsx`:
1. Hai lớp phủ:
   - `pendingDeletes: Set<id>` (tombstone): ẩn comment đó. **Chỉ gỡ** khi danh sách comment từ server (prop `comments`) không còn id đó, hoặc khi API báo lỗi. Gỡ ngay sau response thì một lượt tải bắt đầu từ trước có thể làm comment đã xoá hiện lại.
   - `editOverrides: Map<id, comment>`: hiện bản đang sửa (chữ "Saving…"), rồi thay bằng `comment` mà PATCH trả về (`src/app/api/tasks/[id]/comments/[cid]/route.ts:199`, Enrollment `:106`). Gỡ khi prop `comments` đã có bản có `updated_at` ≥ bản trong override.
2. `remove(id)` (`:1273-1301`) và `edit(...)` (`:1303-1345`): đặt lớp phủ **trước** khi gọi API; thành công thì `void onReload()`, không `await`; lỗi thì gỡ lớp phủ và trả `{ ok: false, … }` như hiện tại; 409 khi sửa giữ cách hiện tại.
3. `confirmDelete` (`:1689-1706`) và nút lưu khi sửa (`:2218-2232`) đóng ngay.
4. Áp cho cả Task CS và Enrollment.

**Kiểm tay:** xoá comment → biến mất ngay, không hiện lại sau lượt tải nền. Sửa → chữ mới hiện ngay. Chặn request → comment trở lại, hiện lỗi.

### T2.5 — Lead: ghi tương tác và comment hiện ngay

Loại Lai. `InteractionLog.tsx:181-236`, `LeadDetailDrawer.tsx:469-512`:
1. **Ghi tương tác:** bấm Save → đóng hộp ngay; chèn dòng tạm (chữ mờ, "Saving…") vào danh sách tương tác. Thành công → thay bằng `result.interaction`, cập nhật lead qua `onLeadUpdated` (status, follow-up, số lần liên hệ: server tính, chỉ hiện khi server trả về). Lỗi → bỏ dòng tạm, mở lại hộp với nội dung cũ và lỗi. Giữ `client_request_id`, nên thử lại không tạo trùng.
2. **Comment:** hiện comment tạm ngay và xoá ô nhập; lỗi thì trả lại nội dung vào ô nhập.

### T2.6 — Panel đính kèm: BỎ

Lúc làm mới thấy `AttachmentPanel.tsx` không được import ở đâu (code chết). File của Task chỉ được tải qua comment (đã tức thì) và lúc tạo task (T2.1). Không sửa. Có thể xoá file này trong một lượt dọn riêng.

### T2.7 — Gán task ở Overview: bỏ vòng xoay chờ tải lại

`TaskBoardClient.tsx:1773-1820`: sau khi POST thành công thì `setAssigningOverviewTaskId(null)` **ngay**, đổi `await loadOverview(true)` (`:1792`, `:1809`) thành chạy nền.

### T2.8 — ACA Overview: gán người phụ trách, bật/tắt hàng đợi

> `AcaOverviewDashboard.tsx` từng crash vì hook đặt sau các `return` sớm (comment ở `:64-68`). Mọi hook mới phải đặt **trước** các `return` đó.

**Gán người phụ trách** (`AcaAssignPicker.tsx:8-17`), Mẫu A trong một ô:
- State `pending: { email: string | null } | null`. Ô hiển thị `pending ? pending.email : currentEmail`.
- `assign(email)`: đặt `pending` **trước** khi gọi API. Ô này vẫn khoá tới khi xong, vì lượt gán sau cần `expected_updated_at` mới (khoá đúng một ô).
- Thành công: `onAssigned(...)` như hiện tại, rồi bỏ `pending`. Lỗi: bỏ `pending` (ô về người cũ), giữ chữ "Failed" kèm lỗi.

**Bật/tắt hàng đợi** (`AcaOverviewDashboard.tsx:69-80`), loại Lai:
- Lớp phủ `queueOverrides: Map<email, boolean>`. Ô tick (`:132`) hiển thị override nếu có.
- Khoá theo email bằng `usePendingKeys`, thay cho `updatingQueueEmail` (chỉ giữ được một người).
- **Không** tự thêm thẻ người vào hàng đợi khi bật: số Open, Over limit, lần gán cuối do server tính. Tắt thì ẩn thẻ ngay.
- Thành công: tải lại Overview chạy nền; snapshot mới về thì bỏ override. Lỗi: bỏ override, hiện `queueError`.

**Kiểm tay:** gán người ở bảng Unassigned → tên đổi ngay. Chặn `api/enrollment` → ô về trống, hiện "Failed". Bật/tắt 3 người liên tiếp → cả 3 ô đổi ngay.

---

## 10. Phase 3 — Màn phụ và quản trị

### T3.1 — Account Manager

- **Alerts** (`toggleAlerts`, `:366-431`): bỏ `setBusyUserId` (`:386`, `:429`); thay bằng `usePendingKeys` với key `alerts:<userId>`, chỉ truyền vào `AlertToggle busy` (`:531`). Các nút khác trên dòng không bị khoá nữa.
- **Sửa tên, agent ID** (`handleEditAccount` `:301-316` → `updateUser` `:245-283`): Mẫu B. Lớp phủ `userOverrides: Map<id, { name, agent_id }>` áp lên `initialUsers`. `router.refresh()` vẫn gọi; khi `initialUsers` đổi (bản mới từ server đã có thay đổi) thì bỏ override không còn request đang chờ.
- Tạo tài khoản, đổi role, reset mật khẩu, xoá: giữ nguyên (Chờ server).

### T3.2 — Time Off

Duyệt, từ chối, huỷ đơn: loại Lai. `decide()` (`TimeOffClient.tsx:560-586`):
1. Đóng hộp **ngay** khi bấm. State `decidingIds: Map<requestId, action>`; dòng đó hiện "Approving…", "Declining…" hoặc "Cancelling…" và khoá nút trên dòng.
2. **Không** đổi số dư hay lịch trước khi server xác nhận.
3. Thành công: thêm vào `decidedIds` như hiện tại, hiện notice; tải lại lịch chạy nền; `router.refresh()` giữ nguyên.
4. Lỗi: bỏ khỏi `decidingIds`, mở lại hộp với ghi chú vừa nhập và lỗi.

Thêm, xoá ngày lễ (`:588-609`, `:688-700`): vẫn chờ server, nhưng tải lại lịch chạy nền.

### T3.3 — Customer Registration (Health, P&C)

`EntryGrid.tsx` và `PcEntryGrid.tsx` sửa giống nhau:
- `loadHistory({ silent })`: chế độ chạy nền **không** bật `loading` (overlay cả bảng). Chỉ lần tải đầu mới hiện overlay.
- **Xoá** (`handleDelete`), Mẫu A: bỏ `setLoading(true)`; bỏ dòng khỏi `history` ngay; lỗi thì báo và tải lại im lặng để dòng hiện lại.
- **Sửa trong hộp** (`handleUpdate`), Mẫu B: đóng hộp, cập nhật dòng ngay; lỗi thì trả dòng cũ, mở lại hộp với dữ liệu vừa nhập và lỗi.
- **Sửa thẳng trong ô** (`onHistoryCellValueChanged`): lỗi thì trả **đúng ô đó** về `event.oldValue` qua `setHistory` (bảng dùng `getRowId`, `:694`, nên AG Grid tự cập nhật đúng dòng), thay vì tải lại cả bảng.
- **Gửi dòng mới** (`handleSubmit`): giữ chờ POST (QĐ-F). Bỏ `await loadHistory()`: POST đã trả `entries` (`src/app/api/entries/route.ts:120-141`, P&C tương tự) → chèn vào đầu `history`, tải lại im lặng chạy nền.

### T3.4 — Provider List

Chuyển sang mục 12: API cần chống ghi đè trước.

### T3.5 — Chuông thông báo: hoàn lại khi đánh dấu đã đọc bị lỗi

`NotificationBell.tsx:482-503`:
- Chỉ đổi và chỉ hoàn lại **những thông báo chính lượt này đã đổi** (đang chưa đọc lúc bấm). Sửa luôn lỗi nhỏ: code hiện tại trừ `ids.length`, tính cả thông báo đã đọc rồi.
- Kiểm `response.ok`. Lỗi thì trả các thông báo đó về chưa đọc, rồi gọi `loadSummary()` (`:304`) lấy **số chưa đọc chuẩn từ server** thay vì cộng trừ tay (poll hay realtime có thể đã đổi số đó).
- `markAllRead`: tương tự, nhớ danh sách id chưa đọc trước khi đổi; lỗi thì trả lại và gọi `loadSummary()`.

### T3.6 — Settings: ảnh đại diện hiện ngay

`SettingsClient.tsx`, loại Lai:
- `uploadAvatar` (`:123-151`): sau `resizeImageToSquare`, hiện ngay ảnh xem trước (`URL.createObjectURL`), giữ URL cũ. Thành công thì dùng URL server trả về và thu hồi URL xem trước; lỗi thì trả URL cũ, hiện lỗi.
- `removeAvatar` (`:153-170`): ẩn ảnh ngay; lỗi thì trả lại.

### T3.7 — Config: công tắc rule stage hiện ngay

`toggleStageRule` (`ConfigClient.tsx:1885-1920`): lớp phủ `stageRuleOverrides: Map<id, patch>`; ô hiển thị giá trị trong lớp phủ khi đang lưu, bỏ khi lượt cuối của stage đó xong (thành công hay lỗi). Hai ô này trước đây chạy qua `run()` nên bật cờ `busy` chung khoá **cả trang**; nay gọi `run(..., { lock: false })` (vẫn hiện thông báo), vì `toggleStageRule` đã tự khoá đúng stage. Việc tải lại option data giữ nguyên. Các thao tác khác của Config: mục 12.

---

## 11. Phase 4 — Không bỏ lượt sửa khi bị 409 (Task CS)

`TaskBoardClient.tsx`: bị 409 thì code hiện tại **bỏ** lượt sửa và báo "This task changed elsewhere; reloaded the current version.", ở cả `patchTask` (`:1528-1539`) lẫn `changeAssignee` (`:1730-1737`). Đây đúng là kiểu lỗi đã sửa cho Enrollment ở `6da7ee0`.

1. Tách `canRetryAfterConflict` (`src/lib/enrollment/optimistic-patch.ts:82`) thành `src/lib/collaboration/conflict-retry.ts`, nhận thêm bảng riêng của từng module: `canRetryAfterConflict(patch, before, canonical, { requestOnlyKeys, relatedColumns })`. Enrollment truyền bảng đang có; test cũ (`optimistic-patch.test.ts`) phải vẫn qua.
2. `patchTask`: các field của lượt sửa không bị ai đổi (so bản người dùng đang thấy với bản mới nhất) thì gửi lại **một** lần với `updated_at` mới; ngược lại giữ cách hiện tại.
3. `changeAssignee`: bản mới nhất đã đúng ý người dùng (đã có, hoặc đã không còn người đó) thì coi như xong; chưa thì gửi lại một lần.

**Kiểm tay:** hai tab cùng mở một task. Tab A đổi priority, tab B ngay sau đó đổi due date → cả hai thay đổi đều được lưu. Hai tab cùng đổi priority → tab sau nhận báo xung đột như hiện tại.

---

## 12. Phase 5 — Dọn và giữ chuẩn

1. Tìm các handler còn chờ tải lại hoặc `router.refresh()` sau thao tác ghi:

   ```bash
   grep -rn -A12 -E 'method: "(POST|PATCH|PUT|DELETE)"' "src/app/(authed)" \
     | grep -E "await (load|reload|refresh)[A-Za-z]*\(|router\.refresh\(\)"
   ```

   Mỗi kết quả: hoặc sửa, hoặc ghi lý do giữ vào bảng mục 4.
2. Bỏ các cờ `saving`/`loading`/`busy` chung không còn dùng.
3. Đưa checklist review ở mục 14 vào `AGENTS.md`, mục "Thao tác ghi". **Hỏi user trước**, vì file này áp cho mọi phiên.

**Ngoài phạm vi, để sau:**
- **Provider List:** thêm `expected_updated_at` + cập nhật có điều kiện + 409 vào `PATCH /api/automation/provider-list/[id]` (đang đọc `custom_values` rồi ghi lại, hai người sửa cùng lúc có thể mất dữ liệu của nhau). Xong thì mới làm sửa provider tức thì theo Mẫu B.
- **Config** (sắp xếp cột, thêm, đổi tên, đổi màu, archive, assistant): không đổi hàng loạt `await refresh…()` thành chạy nền, vì nhiều route không trả dữ liệu chuẩn hay `updated_at` mới; thao tác sau có thể chạy trên dữ liệu cũ. Muốn làm thì từng thao tác cần route trả dữ liệu chuẩn, hoặc một hàng đợi tải lại theo phạm vi.
- **Account Manager:** tạo, đổi role, xoá đổi bảng ngay. Cần `POST /api/admin/users` trả đủ dạng `ManagedAccountUser` (roles, alert) trước.
- Tiến trình, huỷ, thử lại cho import (Lead, Enrollment, Provider), export, Statement, Provider Finder, AI chat.
- Comment Leads chuyển sang dùng chung `CommentThread`.
- Gộp phần logic trùng giữa `EntryGrid.tsx` và `PcEntryGrid.tsx`.
- Outbox thông báo (H5 ở plan go-live): đích lâu dài của QĐ-A.
- Ghi Sheet trong `after()` kèm ghi bù: chỉ làm nếu Phase 0 cho thấy cần (QĐ-F).
- Thời gian tải trang `/tasks`: thuộc plan latency/scale của Task Board.

---

## 13. Thứ tự, phối hợp, ước lượng

| Bước | Việc | Phụ thuộc | Ước lượng |
|---|---|---|---|
| 1 | Phase 0 (đo mốc, log) | — | 0,5 ngày |
| 2 | **T1.0, T1.1** | — | 1 ngày |
| 3 | **T2.0** (bộ khung + thí điểm SLA) | — | 0,5 ngày |
| 4 | **T2.2, T2.3, T2.4, T2.5, T2.7** | Bước 3 | 2 ngày |
| 5 | **T2.1** (Task), T2.6 | Bước 3 | 1 ngày |
| 6 | **T1.2**, T2.1 (Enrollment), **T2.8** | Phiên go-live không còn sửa dở các file Enrollment | 1 ngày |
| 7 | T3.2, T3.3 | Bước 3 | 1 ngày |
| 8 | T3.1, T3.5, T3.6, T3.7 | — | 0,5 ngày |
| 9 | Phase 4 | — | 0,5 ngày |
| 10 | Phase 5 | Các bước trên | 0,5 ngày |

Tổng khoảng 8,5 ngày code. Cộng **30–40%** cho kiểm thử xung đột, kiểm tay ở điều kiện Texas, đo trên production và tập rollback: khoảng 11–12 ngày. Deploy theo module, mỗi task một commit (QĐ-D).

**Tránh đụng file với phiên khác:** trước khi sửa `EnrollmentClient.tsx`, các API Enrollment, `NotificationBell.tsx`, `AccountManagerClient.tsx`: chạy `git status` và `git log -3 -- <file>`. Có phiên khác đang sửa dở thì để bước đó sau.

**Quay lại khi hỏng** (QĐ-D): sau deploy mà thấy tạo trùng, mất dòng vừa tạo, giá trị cũ đè giá trị mới, mất thông báo, hoặc lộ dữ liệu ngoài phạm vi, thì revert đúng commit đó hoặc Promote bản deploy trước trên Vercel.

**Bảng số liệu** (điền ở Phase 0 và sau mỗi phase):

| Thao tác | (a) tới khi màn hình đổi — trước | (b) tới khi xong — trước | (a) — sau | (b) — sau |
|---|---|---|---|---|
| Tạo task + 2 file | | | | |
| Sửa task (đổi stage) | | | | |
| Gán lead | | | | |
| Tạo lead | | | | |
| Ghi tương tác lead | | | | |
| Sửa comment | | | | |
| Xoá comment | | | | |
| Tạo hồ sơ Enrollment + 1 file | | | | |
| Đổi stage hồ sơ Enrollment | | | | |
| Gán người ở ACA Overview | | | | |
| Duyệt Time Off | | | | |
| Gửi 1 dòng Customer Registration | | | | |
| Xoá dòng Customer Registration | | | | |

---

## 14. Kiểm chứng

### Tự động

`npm run typecheck && npm run test:run && npm run lint && npm run build`. Test mới cho các hàm thuần: `runOptimistic`, `requestJson`, `createMutationTracker`, `uploadWithConcurrency`, phần tách thông báo (T1.0), `conflict-retry`.

### Sáu kịch bản kiểm tay, cho mọi thao tác "Tức thì" và "Lai"

| # | Kịch bản | Cách tạo | Kết quả đúng |
|---|---|---|---|
| 1 | Thành công | Mạng thường; rồi giả lập Texas (thêm khoảng 250 ms trễ) | Màn hình đổi ngay. Chỉ thông báo "đã lưu" hoặc tiến trình là tới sau |
| 2 | Server từ chối | Nhập dữ liệu sai, hoặc dùng tài khoản thiếu quyền | Trở về đúng như trước, thông báo đỏ nói rõ cái gì chưa lưu |
| 3 | Mất mạng | DevTools → Network → Block request URL, hoặc Offline | Như kịch bản 2 |
| 4 | Xung đột 409 | Hai tab cùng sửa một bản ghi | Không đè thay đổi của tab kia. Sau Phase 4: sửa khác trường thì cả hai được lưu |
| 5 | Bấm đúp, thử lại | Bấm nhanh hai lần; chặn mạng sau khi gửi rồi bấm lại | Không có bản ghi trùng |
| 6 | Tải lại giữa chừng | Thao tác rồi lập tức đổi bộ lọc, bấm Refresh, hoặc để realtime từ tab khác về | Dòng vừa tạo không biến mất; giá trị không nháy về bản cũ; comment đã xoá không hiện lại |

Thêm: **hai tab** (thao tác ở tab A thì tab B cập nhật trong vài giây); **thông báo** (người nhận vẫn nhận đủ và vẫn kêu "ting"); **phân quyền** (tài khoản agent không thấy dữ liệu ngoài phạm vi, kể cả trong lúc có phần tạm).

### Kịch bản riêng phải thử

| Task | Kịch bản |
|---|---|
| T1.1, T1.2 | Gán task, tạo hồ sơ bắt QC: người nhận vẫn có thông báo trong chuông và push |
| T2.1 | Tạo task kèm 3 file trên mạng giả lập Texas: form đóng trước khi file xong, có tiến trình. Tạo rồi tải lại trang ngay: task vẫn còn, file nào chưa xong thì báo |
| T2.1 (Enrollment) | Tạo hồ sơ kèm file rồi sửa ngay khi file còn đang tải: lượt sửa vẫn được lưu |
| T2.2 | Gán khi danh sách đang tải lại nền. Gán hàng loạt có dòng bị server từ chối: chỉ dòng đó trở lại |
| T2.3 | Tạo lead khi một lượt tải lại đang chạy: lead mới không nháy mất; cột Event hiện đúng tên |
| T2.4 | Xoá comment rồi bấm tải lại ngay: comment không hiện lại |
| T2.8 | Bật/tắt hàng đợi với PATCH bị chặn: ô trở lại, có lỗi |
| T3.3 | Xoá, sửa dòng ở Health và P&C: bảng không phủ loading; request bị chặn thì đúng dòng/ô đó trở lại |
| T3.5 | Đánh dấu đã đọc với request bị chặn: thông báo trở lại chưa đọc, số trên chuông đúng |

### Sau khi deploy

Đo lại 13 thao tác ở mục 13 và điền cột "sau". So số `mutation.conflict` và `*.delivery_failed` trong Vercel Logs trước và sau.

### Checklist review cho mọi thao tác ghi (từ nay về sau)

1. Thao tác này thuộc loại nào: Tức thì, Lai hay Chờ server? Nếu không hiển nhiên thì ghi một dòng comment cạnh handler.
2. Giao diện có đổi **trước** `await fetch` không?
3. Có bản trước để hoàn lại không? Lỗi có thông báo nói rõ cái gì chưa lưu không?
4. Có `await reload()` hay `router.refresh()` nằm trong đường chờ không? Lượt tải nền có bật overlay không?
5. Khoá có đúng phạm vi (nút, ô, dòng) không?
6. Bấm đúp hoặc thử lại có tạo trùng không? (`client_request_id`, key cố định cho file, hàng đợi theo bản ghi)
7. Lượt tải nền, hoặc lượt ghi cũ xong sau, có đè được giá trị đang chờ không?
8. Có hiện kết quả mà chỉ server tính được không?
9. Phía API: dữ liệu nghiệp vụ ghi trong request; realtime, push nằm trong `after()`?

### Xong khi

- [ ] Mọi thao tác ghi ở mục 4 có loại đích và đã làm đúng loại đó.
- [ ] Thao tác "Tức thì" có hoàn lại, xử lý 409 và thay bằng dữ liệu server.
- [ ] Tạo mới không còn chờ file đính kèm.
- [ ] Thao tác trên một dòng không còn tải lại cả bảng hay cả trang trong đường chờ.
- [ ] Không còn cờ loading/busy chung khoá control không liên quan ở các màn trong phạm vi.
- [ ] Các API ở bảng Server (mục 4) trả lời ngay sau khi ghi xong dữ liệu; không còn chờ realtime.
- [ ] Không mất thông báo: dòng thông báo vẫn ghi trong request.
- [ ] Phân quyền vẫn do server quyết.
- [ ] Bảng số liệu: cột (a) giảm; số 409 và số lỗi phát đi trong log không tăng.
- [ ] `changelog.md` ghi đủ.

---

## Phụ lục A — Gộp từ plan của Codex

| Điểm trong plan Codex | Xử lý ở đây | Lý do |
|---|---|---|
| Ba loại thao tác: optimistic, hybrid, server-confirmed | **Lấy.** Mục 3, cột "Loại" ở mục 4 | Cho mọi thao tác một quy ước chung (nguyên nhân D) |
| Không bịa kết quả server tính; dữ liệu server là chuẩn; tải lại nền không đè thay đổi đang chờ | **Lấy.** Nguyên tắc 2, 6, 7 | |
| ACA Overview: gán người phụ trách, bật/tắt hàng đợi | **Lấy.** T2.8 | Audit đầu của mình sót hai chỗ này do lỗi lọc kết quả grep |
| Gán lead hàng loạt mức P1, lỗi một phần | **Lấy.** T2.2 | |
| Giữ dòng vừa tạo khi tải lại nền | **Lấy ý**, dùng cơ chế bộ đếm ghi sẵn có (nguyên tắc 7) | Task, Enrollment đã có; Leads thêm ở T2.2 |
| Time Off không bịa kết quả duyệt hay số dư | **Lấy.** T3.2 thành loại Lai | |
| Mark-read có hoàn lại | **Lấy, hạ xuống P3.** T3.5 | Đã đổi ngay từ trước, chỉ thiếu phần hoàn lại |
| Settings: ảnh đại diện hiện ngay, mật khẩu chờ server | **Lấy, P3.** T3.6 | |
| Config: công tắc tức thì | **Lấy một phần.** T2.0 (SLA), T3.7 (rule stage) | Các thao tác Config khác: mục 12 |
| Bộ khung optimistic dùng chung, thí điểm ở một module ít rủi ro | **Lấy có giới hạn.** T2.0 | Chỉ cho luồng mới (QĐ-E) |
| Ma trận test | **Lấy.** Mục 14, kiểm tay | Repo chưa có test giao diện hay E2E |
| Definition of done, checklist review | **Lấy.** Mục 14 | |
| Phân loại mọi thao tác ghi | **Làm ngay** ở mục 4 | |
| Telemetry sự kiện mutation phía client | **Không lấy** | Chưa có hạ tầng đo; thay bằng log server có tên cố định (Phase 0) |
| Feature flag theo module | **Không lấy** | QĐ-D |
| Tiến trình, huỷ, thử lại cho import, export, AI, Provider Finder | **Để sau.** Mục 12 | Không phải thao tác hằng ngày |
| Tách logic chung giữa Health và P&C grid | **Để sau.** Mục 12 | Refactor, không làm nhanh hơn |

## Phụ lục B — Review vòng 2

| # | Nguồn | Vấn đề | Xử lý |
|---|---|---|---|
| 1 | Codex, mình | Dời rotation vào `after()` làm sai lượt gán kế tiếp | Rotation giữ trong request (T1.1) |
| 2 | Codex | `after()` không bền; dời cả việc ghi dòng thông báo thì có thể mất thông báo bắt buộc | Ghi dòng giữ trong request, chỉ phát realtime/push dời đi (QĐ-A, T1.0) |
| 3 | Codex | Không lồng `after()`; tách ghi dòng, phát realtime, push | T1.0 tách hàm phát đi, gọi thẳng trong `after()`. Docs cho phép lồng (`after.md:56`), nhưng tách cho rõ |
| 4 | Codex | Thiếu đo thời gian tải trang `/tasks` | Ngoài phạm vi, thuộc plan latency/scale Task Board (mục 7, mục 12) |
| 5 | Codex | `runOptimistic` cần biết lượt mới nhất; `apply` phải trong `try` | `isLatest` + `createMutationTracker`, nguyên tắc 10 (T2.0) |
| 6 | Codex, mình | `keepRecentCreates` dựa vào giờ client, và đi ngược thiết kế có chủ ý ở `src/lib/tasks/live-sync.ts:62-72` | Bỏ hàm; dùng bộ đếm ghi như Task/Enrollment (nguyên tắc 7) |
| 7 | Codex | API Provider chưa chống ghi đè; không hợp làm thí điểm | Thí điểm chuyển sang công tắc SLA; Provider để sau (mục 12) |
| 8 | Codex | `uploadWithConcurrency` thiếu giới hạn dưới, tiến trình; thứ tự lỗi không ổn định; `beforeunload` không bảo đảm | Thêm `onSettled`, giới hạn ≥ 1, trả lỗi theo thứ tự đầu vào; ghi rõ ở nguyên tắc 4 |
| 9 | Codex | Gán lead là ai ghi sau thắng | Chốt giữ nguyên quy tắc (QĐ-G) |
| 10 | Codex | Comment: dùng `comment` PATCH trả về; xoá cần tombstone tới khi server hết id | T2.4 |
| 11 | Codex | `POST /api/admin/users` thiếu trường để dựng dòng | Tạo, đổi role, xoá giữ chờ server (T3.1, mục 12) |
| 12 | Codex | Hoàn lại số chưa đọc bằng cộng trừ tay có thể sai | Gọi `loadSummary()` lấy số chuẩn (T3.5) |
| 13 | Codex | Không đổi hàng loạt `await refresh` thành chạy nền ở Config | Bỏ khỏi phạm vi; chỉ làm công tắc rule stage (T3.7) |
| 14 | Codex | Ước lượng thiếu thời gian kiểm thử, đo, rollback | Cộng 30–40%, deploy theo module (mục 13) |
| 15 | Mình | `EnrollmentClient.tsx:4014` là tải lại drawer, không phải danh sách | Sửa T2.1; danh sách đã có cơ chế chống đè |
| 16 | Mình | `reload` của Leads ghi đè cả danh sách, không phủ lượt sửa đang chờ (lỗi có sẵn) | T2.2 sửa `reload` |
| 17 | Mình | Lead do POST trả về thiếu `event_name`, `interaction_history` | T2.3 dùng `patchLeadsById` |
| 18 | Mình | `loadHistory` tự bật overlay cả bảng, kể cả khi chạy nền | T3.3 thêm chế độ im lặng |
| 19 | Mình | `refreshScope` ném lỗi lại; chạy nền thì thành lỗi không ai bắt | Không áp nữa (mục 12) |
| 20 | Mình | Code mẫu thí điểm bỏ mất bước kiểm `!payload.provider`, quên mở lại hộp | Thí điểm đổi sang SLA |
| 21 | Mình | `AcaOverviewDashboard.tsx` từng crash vì thứ tự hook | Ghi rõ ở T2.8 |
| 22 | Mình | `uploadEnrollmentFiles` tạo key mới mỗi lần, thử lại có thể trùng file | T2.1 dùng key cố định |
| 23 | Mình (lúc code) | `AttachmentPanel.tsx` không được import ở đâu | Bỏ T2.6 |
| 24 | Mình (lúc code) | Ô Final Stage / QC chạy qua `run()` nên khoá cả trang Config | T3.7 thêm `run(..., { lock: false })` |
| 25 | Mình (lúc code) | `ApprovalQueue` của Time Off khoá mọi nút Approve/Decline bằng một cờ `busy` chung | T3.2 khoá theo từng đơn (`decidingIds`) |
