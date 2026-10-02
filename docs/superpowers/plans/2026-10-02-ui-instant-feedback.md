# Plan tổng — Mọi thao tác phản hồi tức thì (hết cảm giác app "đứng")

Ngày lập: 2026-10-02. Đây là **bản gộp** của hai nguồn:

1. Audit của mình: mọi `fetch` POST/PATCH/PUT/DELETE trong `src/app/(authed)/**` và các API tương ứng.
2. Plan của Codex, [`2026-10-02-ui-action-responsiveness-plan.md`](./2026-10-02-ui-action-responsiveness-plan.md). Plan này **thay thế** file đó. Phần nào lấy, phần nào không và lý do: xem Phụ lục.

Code tính tới commit `9966499` trên `main`, cộng một thay đổi chưa commit của phiên khác ở `AccountManagerClient.tsx` (bỏ dòng báo thành công khi bật/tắt Alerts).

**Liên quan:**
- [`2026-09-18-task-board-latency.md`](./2026-09-18-task-board-latency.md): đã giảm độ trễ phía server của Task Board (middleware 451 → 25 ms). Cách đo bằng cookie phiên ở mục 1 của plan đó. **Không sửa file này.**
- [`2026-10-02-enrollment-golive-fixes.md`](./2026-10-02-enrollment-golive-fixes.md), đã commit ở `a317b94`. T1.2 ở đây làm luôn phần cuối mục **D3** bên đó (dùng dòng RPC trả về thay cho lần đọc lại). Mục **E1** (`client_request_id` cho tạo hồ sơ) và **H5** (outbox thông báo) bên đó là bước tiếp theo của T2.1 và QĐ-A.
- [`2026-10-02-notification-alerts-mute.md`](./2026-10-02-notification-alerts-mute.md), đã commit ở `39da093` và `9966499`.

## Quy ước

- **Node 22:** chạy `export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"` trước các lệnh.
- **Lệnh kiểm:** `npm run typecheck`, `npm run test:run`, `npm run lint`, `npm run build`.
- **Next.js 16:** đọc `node_modules/next/dist/docs/` trước khi dùng API của Next (`after()`, router…). Xem `AGENTS.md`.
- **Changelog:** mọi thay đổi logic ghi vào `changelog.md`.
- **Commit:** plan này chỉ vào git cùng lượt với code hiện thực nó. **Mỗi task một commit riêng**, để revert được từng phần (QĐ-D).
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
| **C** | **Server giữ response** để chạy cho xong thông báo, push, realtime, rồi mới trả lời | `insertNotifications` tự chờ một lượt phát realtime (`src/lib/tasks/notifications.ts:100`), nên mọi API Task có gửi thông báo đều chờ realtime. Mỗi lượt phát thử tối đa 2 lần, mỗi lần tối đa 1,5 giây (`src/lib/tasks/realtime.ts:30-32`): Realtime chậm thì một lần sửa task bị giữ tới **khoảng 3 giây**. Customer Registration chờ Google Apps Script ghi xong Google Sheet (`src/lib/sheets.ts:90-110`) |
| **D** | **Chưa có quy ước chung** cho thao tác ghi. Cùng một kiểu thao tác, màn này đổi ngay, màn kia khoá cả bảng | Sửa trường Task đổi ngay. Xoá dòng Customer Registration phủ loading lên cả bảng. Một thao tác ở Config khoá cả trang vì một cờ `busy` chung |

Những chỗ đã làm tốt, dùng làm mẫu:
- **Client:** sửa trường, kéo đổi stage, gán người cho task; archive; đăng comment kèm file; đánh dấu đã đọc thông báo; sửa thuộc tính cột ở Config (`ConfigClient.tsx:771-810`); bật/tắt agent trong hộp Distribute (`LeadDistributeDialog.tsx:462-500`); bật/tắt Alerts ở Account Manager (`9966499`). Tất cả **đổi giao diện trước**, lỗi thì hoàn lại.
- **Server:** các API Leads, API comment và file đính kèm của Task đưa thông báo, realtime vào `after()` (chạy nền sau khi đã trả lời).

---

## 2. Mục tiêu đo được

1. **Có phản hồi nhìn thấy trong ≤ 100 ms** sau khi bấm, cho mọi thao tác thường ngày (mức P0/P1 ở mục 4).
2. **Không khoá cả bảng hay cả trang** vì một thao tác trên một dòng.
3. **Lỗi thì luôn hoàn lại** đúng trạng thái trước đó, kèm thông báo đỏ nói rõ cái gì chưa lưu.
4. **Server trả lời ngay sau khi ghi DB.** Thông báo, push, realtime, các bước phụ chạy trong `after()`.
5. **Mọi thao tác ghi thuộc một trong ba loại ở mục 3** và làm đúng loại đó.
6. **Không trùng, không mất.** Bấm đúp, thử lại, tải lại giữa chừng đều không tạo bản ghi trùng, không làm mất dòng vừa tạo.
7. **Server vẫn quyết định** phân quyền, kiểm tra dữ liệu và mọi kết quả do server tính. Giao diện chỉ hiển thị trước.

---

## 3. Ba loại thao tác ghi

| Loại | Khi bấm, màn hình làm gì | Dùng khi | Ví dụ |
|---|---|---|---|
| **Tức thì** | Hiện **kết quả cuối** ngay. Server trả lời thì thay bằng dữ liệu server; lỗi thì trả về đúng bản trước | Client biết chắc kết quả | Sửa trường, đổi stage, gán một người cụ thể, xoá, bật/tắt, đổi tên/màu, sửa/xoá comment |
| **Lai** | Hiện ngay **trạng thái đang xử lý** tại đúng chỗ: dòng tạm chữ mờ, "Saving…", "Approving…", hộp đóng. **Không** hiện thứ chỉ server tính được. Server trả lời mới hiện kết quả thật | Kết quả cần server: mã CS-…/ACA-…, id, duyệt nghỉ, số dư, số liệu Overview, file tải lên | Tạo task/lead/hồ sơ, ghi tương tác, tải file, duyệt Time Off, thêm người vào hàng đợi ACA |
| **Chờ server** | Giữ cách chờ, nhưng chỉ khoá **đúng nút hoặc hộp** đó, có chữ tiến trình rõ | Bảo mật, phân quyền, số dư, kết quả chia do server tính, xử lý dài | Mật khẩu, đổi role, xoá tài khoản, điều chỉnh số dư phép, chia lead, import/export, chạy statement, AI, hộp lý do Reopen/Unlock (QĐ-C) |

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
| Đăng comment (kèm file) | ✅ Hiện comment tạm cùng ảnh xem trước; file tải nền (`:889-1060`) | — | Tức thì | — | Giữ, là mẫu chuẩn |
| **Sửa / xoá comment** | ❌ `remove` `:1273-1301`, `edit` `:1303-1345`: chờ API, **rồi chờ `await onReload()`**. Ở Enrollment, `onReload = reloadDetailAndParent` tải lại chi tiết **và cả danh sách** | 2–3 request | Tức thì | **P0** | T2.4 |

### Đính kèm (`AttachmentPanel.tsx`)

| Thao tác | Hiện tại | Phải chờ | Loại | Mức | Việc |
|---|---|---|---|---|---|
| Tải lên | ❌ `:34-72`: chờ API rồi `await onReload()` | 2 request | Lai | P1 | T2.6 |
| Xoá | ❌ `:74-111`: như trên | 2 request | Tức thì | P1 | T2.6 |

### Leads (`src/app/(authed)/tasks/leads/_components/`)

| Thao tác | Hiện tại | Phải chờ | Loại | Mức | Việc |
|---|---|---|---|---|---|
| Sửa ô, archive | ✅ `patchLead` `LeadsClient.tsx:683-759`, `archiveLead` `:761-810` | — | Tức thì | — | Giữ |
| **Gán một lead** (từ ô hoặc drawer) | ❌ `assignLead` `:812-846`: ô vẫn hiện người cũ cho tới khi `POST /api/leads/assign` trả lời | 1 request | Tức thì | **P0** | T2.2 |
| Gán hàng loạt | ❌ `assignSelected` `:848-883` | 1 request | Tức thì | P1 | T2.2 |
| **Tạo lead** | ❌ `LeadAddDialog.tsx:355-428`: chờ POST, rồi **chờ `onCreated()` = `reload()` tải lại toàn bộ danh sách lead** (`LeadsClient.tsx:1571`), rồi tải file tuần tự | 2 + N request, một trong số đó nặng | Lai | **P0** | T2.3 |
| **Ghi tương tác, comment trong drawer** | ❌ `InteractionLog.tsx:181-236`: form khoá chờ POST. Comment Leads dùng ô nhập riêng, **không** dùng `CommentThread` | 1 request | Lai | **P0** | T2.5 |
| Bật/tắt agent trong hộp Distribute | ✅ `LeadDistributeDialog.tsx:462-500` | — | Tức thì | — | Giữ |
| Lưu tỉ lệ chia, chia lead, import | Chờ API, khoá đúng hộp (`LeadDistributeDialog.tsx:353-383, 528-576`, `LeadImportDialog.tsx`) | — | Chờ server | — | Giữ. Kết quả chia do server tính |

### Enrollment (`src/app/(authed)/enrollment/_components/`)

| Thao tác | Hiện tại | Phải chờ | Loại | Mức | Việc |
|---|---|---|---|---|---|
| Sửa trường, đổi stage/người/QC, archive | ✅ `patchRecord`, `archiveRecord` (`EnrollmentClient.tsx:1777`). Nhưng server giữ response cho thông báo và một lần đọc lại hồ sơ (C) | C | Tức thì | **P0** | T1.2 |
| **Tạo hồ sơ** | ❌ `createRecord` `EnrollmentClient.tsx:1712` và `onCreate` `:2109`: chờ POST (cộng C), rồi file, rồi đọc lại hồ sơ, rồi mới đóng form | 3+ request, cộng C | Lai | **P0** | T1.2, T2.1 |
| Reopen (hộp lý do) | ❌ Hộp chờ API | 1 request | Chờ server | P2 | Giữ |
| Sửa / xoá comment | ❌ Xem bảng Comment | | Tức thì | **P0** | T2.4 |
| **ACA Overview: gán người phụ trách** | ❌ `AcaAssignPicker.tsx:8-17`: ô vẫn hiện người cũ và bị khoá tới khi `PATCH /api/enrollment/[id]` xong | 1 request, cộng C | Tức thì | P1 | T1.2, T2.8 |
| **ACA Overview: bật/tắt hàng đợi** | ❌ `AcaOverviewDashboard.tsx:69-80`: ô tick khoá, chờ PATCH **rồi `await load()` tải lại cả Overview** | 2 request, một nặng | Lai | P1 | T2.8 |
| Import | Chờ API | — | Chờ server | — | Mục 12 |

### Customer Registration (`customer-registration/health/EntryGrid.tsx`, `customer-registration/pc/PcEntryGrid.tsx`)

Màn agent dùng hằng ngày. Mọi API ghi ở đây (`src/app/api/entries/**`, `src/app/api/pc-entries/**`) còn chờ Google Apps Script ghi Sheet xong mới trả lời (C, xem QĐ-F). Hai file grid có cùng các hàm; bên P&C lệch khoảng 15 dòng.

| Thao tác | Hiện tại | Phải chờ | Loại | Mức | Việc |
|---|---|---|---|---|---|
| Gửi dòng mới | ❌ `handleSubmit` `EntryGrid.tsx:469-530` (P&C `:484`): chờ POST rồi `await loadHistory()` | 2 request + Apps Script | Chờ server (QĐ-F) | P1 | T3.3 |
| Xoá dòng | ❌ `handleDelete` `:395-410` (P&C `:410`): `setLoading(true)` **phủ loading lên cả bảng** tới khi xoá và tải lại xong | 2 request + Apps Script | Tức thì | P1 | T3.3 |
| Sửa trong hộp | ❌ `handleUpdate` `:412-435` (P&C `:427`): chờ PATCH rồi tải lại | 2 request + Apps Script | Tức thì | P1 | T3.3 |
| Sửa thẳng trong ô | ✅ AG Grid hiện giá trị mới. Lỗi thì tải lại **cả bảng** để lấy giá trị cũ (`onHistoryCellValueChanged` `:442-460`, P&C `:457`) | — | Tức thì | P3 | T3.3 |

### Màn khác

| Màn | Thao tác | Hiện tại | Loại | Mức | Việc |
|---|---|---|---|---|---|
| Chuông thông báo | Đánh dấu đã đọc, đọc hết | ⚠️ Đổi ngay, nhưng lỗi thì **không** hoàn lại và không kiểm `response.ok` (`NotificationBell.tsx:482-503`) | Tức thì | P3 | T3.5 |
| Account Manager | Bật/tắt Alerts | ⚠️ Đổi ngay (`9966499`), nhưng `busyUserId` khoá **cả dòng**: các nút Edit, Role, Reset, Delete (`AccountManagerClient.tsx:386, 501, 531-608`) | Tức thì | P2 | T3.1 |
| Account Manager | Sửa tên, agent ID | ❌ Chờ API; bảng chỉ đổi sau `router.refresh()` dựng lại cả trang (`:245-316`) | Tức thì | P2 | T3.1 |
| Account Manager | Tạo tài khoản, đổi role, reset mật khẩu, xoá | ❌ Như trên (`:209-243`, `:317-365`) | Chờ server | P2 | T3.1 |
| Time Off | Duyệt, từ chối, huỷ đơn | ❌ Chờ PATCH; khi duyệt còn `await refreshVisibleCalendar()` (`TimeOffClient.tsx:560-586`) | Lai | P1 | T3.2 |
| Time Off | Thêm, xoá ngày lễ | ❌ Chờ API rồi `await refreshVisibleCalendar()` (`:588-609`, `:688-700`) | Chờ server | P2 | T3.2 |
| Time Off | Gửi đơn; điều chỉnh số dư, cộng phép tháng, điều chỉnh hàng loạt | Chờ API, khoá đúng hộp (`:526-550`, `:611-686`) | Chờ server | — | Giữ. Số dư do server tính |
| Provider List | Sửa provider (hộp sửa) | ❌ Hộp chờ PATCH xong mới đóng; dòng giữ giá trị cũ tới lúc đó (`ProviderListClient.tsx:252-268`, `ProviderEditDialog.tsx:48-61`) | Tức thì | P2 | T2.0 (thí điểm) |
| Settings | Đổi tên hiển thị, đổi mật khẩu | Form chờ API; ô nhập đã hiện giá trị mới (`SettingsClient.tsx:52-121`) | Chờ server | — | Giữ |
| Settings | Đổi, xoá ảnh đại diện | ❌ Chờ tải lên rồi `router.refresh()` (`:123-170`) | Lai | P3 | T3.6 |
| Config | Sửa thuộc tính cột | ✅ `patchColumn` (`ConfigClient.tsx:771-810`) | Tức thì | — | Giữ, là mẫu chuẩn |
| Config | Kéo sắp xếp cột; thêm, đổi tên, đổi màu, archive giá trị; assistant | ❌/⚠️ Đều chạy qua `run()` (`:367-392`). Hàm này bật **một cờ `busy` chung** truyền xuống mọi mục (`:469, 494, 526`): một thao tác khoá cả trang Config tới khi lưu **và** tải lại xong | Tức thì: sắp xếp, đổi tên, đổi màu. Chờ server: thêm, archive, assistant | P3 | T3.7 |
| Config | Bật/tắt rule stage (Terminal, QC); bật/tắt, sửa thời hạn SLA | ⚠️ Khoá riêng từng mục, nhưng công tắc chỉ đổi sau API; rule stage còn chờ tải lại (`ConfigClient.tsx:1885-1920`, `ConfigSlaSection.tsx:142-244`) | Tức thì | P3 | T3.7 |
| Role Manager | Tạo, sửa, xoá role | Chờ API + `router.refresh()` (`RoleManagerClient.tsx:194-295`) | Chờ server | — | Giữ (phân quyền) |
| Config alert Leads, mặc định tháng báo cáo | Lưu form (`ConfigAlertSection.tsx:71`, `ReportMonthDefaultEditor.tsx:96`) | Chờ API | Chờ server | — | Giữ |
| Import (Lead, Enrollment, Provider), Statement P&C/Health, Provider Finder, AI chat | Xử lý dài | Chờ API | Chờ server | — | Mục 12 |

### Server (nguyên nhân C)

`insertNotifications` (Task) và `insertEnrollmentNotifications` đều tự chờ một lượt phát realtime (`src/lib/tasks/notifications.ts:100`, `src/lib/enrollment/notifications.ts:47`). Vì vậy **chờ thông báo là chờ cả realtime**.

| API | Đang giữ response cho | Mức | Việc |
|---|---|---|---|
| `POST /api/tasks` | Rotation, thông báo, realtime (`settleSideEffects`, `src/app/api/tasks/route.ts:368`) | **P0** | T1.1 |
| `PATCH /api/tasks/[id]` | Thông báo (`:628`), **2 lượt phát realtime** (`:641`) | **P0** | T1.1 |
| `DELETE /api/tasks/[id]` (archive) | Phát realtime (`:723`) | P1 | T1.1 |
| `POST /api/tasks/[id]/assign` (Overview) | Thông báo + 2 lượt realtime (`:99`) | **P0** | T1.1 |
| `POST /api/tasks/[id]/assignees`, `DELETE …/assignees/[email]` | Thông báo cho người được gán (`assignees/route.ts:173`, `assignees/[email]/route.ts:137`). Realtime chính đã ở `after()` | **P0** | T1.1 |
| `POST /api/tasks/[id]/reopen`, `POST …/overdue-unlock` | Thông báo + realtime (`reopen/route.ts:128, 150`; `overdue-unlock/route.ts:170, 194`) | P2 | T1.1 |
| `POST /api/enrollment` | Tra danh sách manager + thông báo (`src/app/api/enrollment/route.ts:347-399`) | **P0** | T1.2 |
| `PATCH /api/enrollment/[id]` | Tra manager (`:546`), thông báo (`:607`), **đọc lại hồ sơ** (3 truy vấn, `:627`) | **P0** | T1.2 |
| `/api/entries/**`, `/api/pc-entries/**` | Google Apps Script ghi Sheet (`entries/route.ts:132`, `entries/[id]/route.ts:114, 168`; P&C tương tự) | P2 | QĐ-F |
| Các API Leads; comment và file đính kèm Task | Đã đưa vào `after()` | — | Mẫu chuẩn |

---

## 5. Nguyên tắc (dùng khi review code)

1. **Đổi giao diện trước, gọi API sau.** Lưu bản trước khi đổi; lỗi thì hoàn lại đúng bản đó và hiện thông báo đỏ nói rõ cái gì chưa lưu.
2. **Dữ liệu server trả về là chuẩn.** Thành công thì thay phần tạm bằng dòng server trả về.
3. **Không `await` việc tải lại sau khi ghi.** Cần tải lại thì gọi `void reload()` chạy nền, không khoá nút.
4. **Form tạo đóng ngay khi server tạo xong** (QĐ-B). File đính kèm tải **nền**, song song tối đa 3 file, có tiến trình. Lỗi file thì báo kèm cách thử lại. Còn file đang tải mà người dùng đóng tab thì trình duyệt hỏi lại (`beforeunload`).
5. **Khoá đúng phạm vi.** Chỉ khoá ô, dòng hoặc nút đang lưu, không phủ loading lên cả bảng hay cả trang. Chống bấm đúp bằng khoá theo key (`usePendingKeys`, T2.0).
6. **Không bịa kết quả do server tính.** Người được chia round-robin, kết quả duyệt nghỉ, số dư phép, số liệu Overview (Open, Over limit), mã CS-…/ACA-…: chỉ hiện khi server trả về. Trong lúc chờ thì hiện trạng thái đang xử lý (loại Lai).
7. **Tải lại nền không được đè thay đổi đang chờ.** Phần tạm nằm riêng và được áp lên dữ liệu tải về khi render, như pending overlay của Leads hay `state.tail` của Task. Dòng vừa tạo không được biến mất vì một lượt tải bắt đầu **trước** lúc tạo (`keepRecentCreates`, T2.0).
8. **Server trả lời ngay sau khi ghi DB.** Thông báo, push, realtime, rotation… đưa vào `after()`, như các API Leads. Response trả về dòng vừa ghi.
9. **Thao tác lặp phải an toàn.** Tạo mới phải có `client_request_id` (Task, Lead đã có; Enrollment chưa có, là mục E1 ở plan go-live). Các lượt ghi nối tiếp trên cùng một bản ghi phải xếp hàng (`createKeyedSerializer` của Leads, `state.tail` của Task/Enrollment).
10. **Phân quyền vẫn ở server.** Đổi giao diện trước chỉ là hiển thị; server từ chối thì hoàn lại. Phần tạm không được chèn dữ liệu mà người dùng không được xem.

> [codex] **Blocker:** không đưa assignment rotation vào `after()`. Rotation quyết định lượt assign tiếp theo; nếu hai task được tạo liên tiếp trước khi background work chạy, trạng thái cũ có thể chọn lại cùng người. Rotation phải nằm trong `create_task_atomic` hoặc vẫn hoàn tất trước response. Chỉ realtime, push và delivery không ảnh hưởng state nghiệp vụ mới được chạy sau response.

---

## 6. Quyết định

| QĐ | Câu hỏi | Đề xuất |
|---|---|---|
| **QĐ-A** | Đưa thông báo vào `after()` thì response không còn báo được "thông báo gửi lỗi" (`warnings`). Toast "Saved. Some notifications could not be sent." của Enrollment (`EnrollmentClient.tsx:1645, 1739`) sẽ gần như không còn hiện | **Đồng ý đưa vào `after()`.** Lỗi gửi thông báo ghi log có tên cố định để theo dõi. Người dùng không làm gì được với lỗi thông báo, nên không đáng bắt họ chờ. Code toast giữ nguyên, vô hại. Đích lâu dài là outbox thông báo (H5 ở plan go-live) |
| **QĐ-B** | Tạo task/lead/hồ sơ: đóng form khi server **đã tạo xong**, hay **ngay khi bấm**? | **Khi server đã tạo xong.** Lỗi kiểm tra dữ liệu vẫn hiện ngay trên form. Sau T1.1/T1.2 bước này chỉ còn khoảng 0,3–0,6 giây. Cái chậm nhất là **file** và **lượt tải lại**, đều được bỏ khỏi đường chờ. Đóng ngay khi bấm thì phức tạp hơn nhiều (chưa có mã CS-…/ACA-…, lỗi phải mở lại form) |
| **QĐ-C** | Hộp lý do (Reopen, Unlock overdue) có đóng ngay không? | **Giữ cách chờ.** Ít dùng và có kiểm tra phía server. T1.1 làm nó nhanh hơn |
| **QĐ-D** | Deploy xong mà hỏng thì quay lại bằng feature flag hay bằng revert? | **Revert, không dùng flag.** Mỗi task một commit; hỏng thì `git revert` đúng commit đó, hoặc Promote bản deploy trước trên Vercel (khoảng 1 phút). Flag buộc giữ hai đường code song song, tốn công mà với khoảng 50 người dùng thì không cần |
| **QĐ-E** | Bộ khung optimistic dùng chung (T2.0) áp cho mọi chỗ hay chỉ chỗ mới? | **Chỉ cho luồng mới hoặc luồng được sửa trong plan này.** `patchTask`, `patchLead`, `patchRecord` đã có hàng đợi, rebase, hoàn lại và đang chạy ổn. Viết lại chúng là rủi ro mà không nhanh thêm |
| **QĐ-F** | Customer Registration chờ Google Apps Script ghi Sheet. Có dời việc này vào `after()` không? | **Chưa dời.** Lúc tạo, cảnh báo "Google Sheet sync failed" là tín hiệu duy nhất agent thấy khi Sheet thiếu dòng. Sửa và xoá sẽ đổi giao diện ngay nhờ T3.3, nên việc server chờ không còn ảnh hưởng người dùng. Phase 0 đo thời gian thật; nếu tạo mất trên 2 giây thì lập plan riêng: `after()`, thêm cột đánh dấu dòng ghi Sheet lỗi, cron ghi bù |

> [codex] `after()` là background execution, không phải durable queue. `insertNotifications` và `insertEnrollmentNotifications` hiện vừa ghi notification row vừa broadcast/push. Không được chuyển phần **ghi notification row** sang `after()` cho các event bắt buộc (`assigned`, `qc_needed`, `record_created`) nếu chưa có outbox/retry bền vững. Hướng an toàn: ghi notification/outbox trong transaction hoặc synchronous path; chỉ realtime broadcast và web push delivery đi vào `after()`.

---

## 7. Phase 0 — Đo mốc (khoảng nửa ngày)

1. **Thêm đo thời gian phía server** (`RouteTiming`, `src/lib/server-timing.ts`, đã dùng ở `GET /api/enrollment` và `GET /api/tasks/notifications`) cho các API ghi: `POST /api/tasks`, `PATCH /api/tasks/[id]`, `POST /api/tasks/[id]/assign`, `POST /api/enrollment`, `PATCH /api/enrollment/[id]`, `POST /api/leads`, `POST /api/leads/assign`, `POST /api/entries`. Mỗi route đánh dấu ba mốc: `auth`, `write` (RPC/insert), `side_effects` (ở `/api/entries` là `sheet`). Kết quả hiện trong DevTools → Network → Timing → Server Timing.
2. **Log có tên cố định**, thay cho telemetry phía client trong plan Codex (xem Phụ lục). Chỉ ghi id, **không** ghi nội dung khách hàng hay tên file:
   - API Task, Enrollment, Leads khi trả 409: `console.warn("mutation.conflict", { route, id })`.
   - Việc phụ chạy trong `after()` bị lỗi: `"<module>.<action>.side_effects_failed"`, ví dụ `task.create.side_effects_failed`.

   Xem trong Vercel → Logs, lọc theo tên. Dùng để so số 409 và số lỗi trước và sau mỗi phase.
3. **Đo 13 thao tác** trên production (danh sách ở mục 13). Mỗi thao tác ghi hai con số:
   - **(a)** từ lúc bấm tới khi màn hình đổi;
   - **(b)** từ lúc bấm tới khi xong hẳn.

   Đo bằng tab Performance hoặc Network. Muốn giả lập người ở Texas thì thêm khoảng 250 ms trễ: Network → Throttling → Add custom profile.
4. Điền bảng số liệu ở mục 13. Sau mỗi phase đo lại đúng 13 thao tác đó.

> [codex] Cần thêm một nhóm đo riêng cho `GET /tasks`, vì plan này mới đo mutation. Request `/tasks` hiện còn chờ full task list, exact count, assignee/metadata enrichment, config và membership trước khi render. Đo riêng từng mốc này trên production warm request; phân biệt với lần compile đầu của Next dev. Đây là workstream P0 độc lập với instant feedback.

---

## 8. Phase 1 — Server trả lời ngay sau khi ghi DB

Việc rẻ nhất mà lợi rộng nhất. Mọi thao tác Task/Enrollment đều nhanh lên, kể cả những thao tác client đã đổi giao diện trước, vì lượt sửa sau trên cùng bản ghi đang xếp hàng chờ lượt trước.

### T1.1 — API Task: đưa thông báo, rotation, realtime vào `after()`

> [codex] Khi tách side effects, không gọi `after()` lồng nhau. `insertNotifications()` hiện tự schedule push qua `after()`. Cần tách rõ `persistNotificationRows`, `broadcastNotifications`, `deliverPush`; background callback gọi các delivery function trực tiếp và log theo request/event id.

Mẫu đã có ở API Leads, ví dụ `src/app/api/leads/[id]/route.ts:274-277`:

```ts
after(async () => {
  await broadcastLeadsChanged(sourceId, [id]);
});
return NextResponse.json({ lead: withEventName(data) });
```

1. **`POST /api/tasks`** (`src/app/api/tasks/route.ts:368-432`): hiện là `const warnings = result.was_created ? await settleSideEffects([...rotation, notification, broadcast]) : []`. Đổi thành:

   ```ts
   if (result.was_created) {
     after(async () => {
       const warnings = await settleSideEffects([ /* giữ nguyên 3 mục */ ]);
       if (warnings.length > 0) console.error("task.create.side_effects_failed", { taskId, warnings });
     });
   }
   ```

   Response trả `warnings: []`. Bước `attachAssigneesToTasks` (`:439`) **giữ nguyên**: nó dựng dòng task đầy đủ để trả về.
2. **`PATCH /api/tasks/[id]`** (`src/app/api/tasks/[id]/route.ts:628-659`): chuyển cả `notificationResults` lẫn `broadcastResults` vào **một** `after()`. Khoản chờ tới khoảng 3 giây ở mục 1 biến khỏi đường chờ.
3. **`DELETE /api/tasks/[id]`** (archive, `:723-730`): `broadcastResult` vào `after()`.
4. **`POST /api/tasks/[id]/assign`** (`src/app/api/tasks/[id]/assign/route.ts:99`): `Promise.all([taskSelect, settleSideEffects(...)])` thành chỉ `await` truy vấn task; `settleSideEffects` đưa vào `after()`.
5. **`POST /api/tasks/[id]/assignees`** (`assignees/route.ts:172-195`) và **`DELETE …/assignees/[email]`** (`assignees/[email]/route.ts:136-160`): lệnh `insertNotifications` chuyển vào `after()` sẵn có ngay bên dưới (`:201` và `:165`).
6. **`POST /api/tasks/[id]/reopen`** (`reopen/route.ts:128, 150`) và **`POST …/overdue-unlock`** (`overdue-unlock/route.ts:170, 194`): thông báo và realtime vào một `after()`.
7. Client không đọc `warnings` của các API này: `grep -n "warnings" "src/app/(authed)/tasks/_components/"*.tsx` hiện không ra kết quả. Kiểm lại lúc làm.

**Kiểm tay:** sửa task ở tab A → tab B vẫn cập nhật trong khoảng 1 giây (realtime vẫn phát, chỉ là sau khi đã trả lời). Server Timing của PATCH không còn mốc thông báo hay realtime.

### T1.2 — API Enrollment: thông báo vào `after()`, bỏ lần đọc lại thừa

> Trước khi sửa: `git status` và `git log -3 --` hai file route dưới đây, để chắc phiên go-live không còn sửa dở.

1. **`POST /api/enrollment`** (`src/app/api/enrollment/route.ts`): lần tra manager (`fetchEnrollmentManagerEmails`, `:347-354`) và `notificationPromises` (`record_created`, `assigned`, `qc_needed`, `:363-399`) chuyển vào `after()` sẵn có ở `:401-408` (đang chỉ phát realtime).
2. **`PATCH /api/enrollment/[id]`** (`src/app/api/enrollment/[id]/route.ts`):
   - Lần tra manager (`:546`, bên trong `if (stageChanged)`) cùng `insertEnrollmentNotifications(notifications)` (`:606-612`) chuyển vào `after()` sẵn có ở `:613-623`.
   - **Bỏ** `record = await fetchEnrollmentRecordById(id)` (`:625-632`, 3 truy vấn). Thay bằng dòng RPC trả về, ghép với số đếm đã có:

     ```ts
     record: {
       description: null,
       custom_values: {},
       ...updatedData,
       comment_count: scoped.record.comment_count,
       attachment_count: scoped.record.attachment_count,
     },
     ```

     `scoped.record` có kiểu `EnrollmentRecordWithStats` (`src/lib/enrollment/scope.ts:168-190`). Biến `current` ở `:143` đã ép về `EnrollmentRecord` nên không dùng được cho số đếm. Hai giá trị mặc định là đúng việc `coerceEnrollmentRecord` (`src/lib/enrollment/queries.ts:329-335`) đang làm. PATCH không đổi số comment hay số file.
   - Đây là phần cuối mục **D3** ở plan go-live. Làm xong thì ghi chú bên đó.
3. **Phân quyền:** việc lọc người nhận theo quyền xem nằm trong `insertEnrollmentNotifications`. Chạy trong `after()` thì vẫn lọc như cũ.

**Kiểm tay:** tạo hồ sơ có stage bắt QC → form đóng nhanh; vài giây sau manager vẫn nhận `qc_needed`. Đổi stage hồ sơ → dòng đổi ngay, số comment và số file trên dòng không bị về 0.

---

## 9. Phase 2 — Bộ khung dùng chung và thao tác hằng ngày

### T2.0 — Bộ khung dùng chung, ba mẫu, thí điểm ở Provider List

Theo QĐ-E, chỉ dùng cho luồng mới hoặc luồng được sửa trong plan này.

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
export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new MutationError("Connection lost — the change was not saved.", 0);
  }
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new MutationError(payload?.error ?? `Request failed (${response.status}).`, response.status, payload);
  }
  return payload as T;
}

export type OptimisticResult<T> = { ok: true; value: T } | { ok: false; error: MutationError };

/**
 * Đổi giao diện (`apply`) → gọi API (`request`) → thành công thì `commit` bằng dữ liệu
 * server, lỗi thì `rollback`. Không tự hiện lỗi: nơi gọi quyết định hiện ở đâu.
 */
export async function runOptimistic<T>(steps: {
  apply: () => void;
  request: () => Promise<T>;
  commit?: (value: T) => void;
  rollback: (error: MutationError) => void;
}): Promise<OptimisticResult<T>> {
  steps.apply();
  try {
    const value = await steps.request();
    steps.commit?.(value);
    return { ok: true, value };
  } catch (cause) {
    const error = cause instanceof MutationError
      ? cause
      : new MutationError(cause instanceof Error ? cause.message : "Could not save the change.", 0);
    steps.rollback(error);
    return { ok: false, error };
  }
}

/**
 * Giữ dòng vừa tạo nếu lượt tải này BẮT ĐẦU trước lúc server tạo xong dòng đó,
 * vì kết quả tải chưa thể có nó. Lượt tải bắt đầu sau thì tin kết quả tải.
 */
export function keepRecentCreates<T extends { id: string }>(
  fetched: readonly T[],
  recent: ReadonlyMap<string, { row: T; createdAt: number }>,
  fetchStartedAt: number,
): T[] {
  const ids = new Set(fetched.map((row) => row.id));
  const kept = [...recent.values()]
    .filter(({ row, createdAt }) => createdAt > fetchStartedAt && !ids.has(row.id))
    .map(({ row }) => row);
  return kept.length > 0 ? [...kept, ...fetched] : [...fetched];
}
```

> [codex] `runOptimistic` cần nhận `mutationId` hoặc version theo resource. Nếu request A fail sau khi request B thành công, rollback của A không được ghi đè state canonical của B. Đặt `apply()` trong `try` và chỉ rollback khi mutation đang là bản mới nhất của resource.

> [codex] `keepRecentCreates` không nên quyết định bỏ overlay chỉ bằng `createdAt <= fetchStartedAt`: thời gian client không phản ánh database snapshot do network delay. Giữ `pendingCreates[id]` cho tới khi một server snapshot thật sự chứa id đó; TTL chỉ dùng để báo reconcile bị kẹt, không được làm row biến mất âm thầm.

`createdAt` (lúc client nhận response tạo) và `fetchStartedAt` đều lấy bằng `Date.now()` ở client. Mỗi lần áp kết quả tải, xoá khỏi `recent` những mục có `createdAt <= fetchStartedAt`: lượt tải đó đủ mới để tin.

**2. `createKeyedSerializer`:** chuyển từ `src/lib/leads/list-state.ts:43-58` sang `src/lib/collaboration/keyed-serializer.ts`. `list-state.ts` export lại để import cũ vẫn chạy. Dùng để xếp hàng các lượt ghi trên cùng một bản ghi.

**3. `src/lib/collaboration/use-pending-keys.ts`:** khoá theo key, chống bấm đúp.

```ts
"use client";
import { useCallback, useRef, useState } from "react";

/**
 * Khoá theo key (id dòng, `alerts:<userId>`…). Kiểm bằng ref nên bấm đúp trong
 * cùng một tick vẫn bị chặn; `pending` là bản state để render.
 */
export function usePendingKeys() {
  const live = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const start = useCallback((key: string) => {
    if (live.current.has(key)) return false;
    live.current.add(key);
    setPending(new Set(live.current));
    return true;
  }, []);
  const finish = useCallback((key: string) => {
    if (!live.current.delete(key)) return;
    setPending(new Set(live.current));
  }, []);
  return { pending, start, finish };
}
```

**Ba mẫu áp dụng.** Các task sau trỏ tới đây:

- **Mẫu A — Thao tác trên ô hoặc dòng** (gán, bật/tắt, xoá, đổi tên): dùng `runOptimistic`. `apply` chỉ đổi đúng các field đó; `rollback` chỉ trả lại đúng các field đó, không ghi đè cả dòng, để không xoá thay đổi khác đang chờ trên cùng dòng. Nhiều lượt trên cùng bản ghi thì xếp hàng bằng `createKeyedSerializer`.
- **Mẫu B — Hộp sửa nhiều trường:** bấm Save thì hộp đóng ngay và dòng đổi ngay theo Mẫu A. Lỗi thì dòng trả lại, hộp **mở lại** với đúng dữ liệu vừa nhập kèm dòng lỗi đỏ. Hộp nhận thêm hai prop `initialDraft` và `initialError`.
- **Mẫu C — Tạo mới (Lai):** theo QĐ-B. Form đóng khi server tạo xong, chèn dòng server trả về và ghi vào `recentCreates` để `keepRecentCreates` giữ dòng qua lượt tải cũ. File tải nền bằng `uploadWithConcurrency` (T2.1).

**Thí điểm: Provider List, Mẫu B** (`ProviderListClient.tsx:252-268`, `ProviderEditDialog.tsx:48-61`). Chọn chỗ này vì ít người dùng, chỉ một hàm, có sẵn hộp sửa.

> [codex] Provider PATCH hiện chỉ update theo `id`, chưa kiểm `expected_updated_at`; đặc biệt custom values đọc rồi ghi lại nên hai editor có thể mất dữ liệu của nhau. Trước khi dùng Provider làm mẫu optimistic chung, API phải có optimistic concurrency (`expected_updated_at` + conditional update + 409) và trả canonical row.

```ts
const [reopen, setReopen] = useState<
  { provider: ProviderRow; draft: Record<string, unknown>; error: string } | null
>(null);

function patchProvider(id: string, patch: Record<string, unknown>) {
  const before = providers.find((row) => row.id === id);
  if (!before) return;
  const restore = Object.fromEntries(
    Object.keys(patch).map((key) => [key, before[key as keyof ProviderRow]]),
  );
  const setRow = (next: (row: ProviderRow) => ProviderRow) =>
    setProviders((current) => current.map((row) => (row.id === id ? next(row) : row)));
  void runOptimistic({
    apply: () => setRow((row) => ({ ...row, ...patch }) as ProviderRow),
    request: () =>
      requestJson<{ provider: ProviderRow }>(`/api/automation/provider-list/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    commit: ({ provider }) => setRow(() => provider),
    rollback: (error) => {
      setRow((row) => ({ ...row, ...restore }) as ProviderRow);
      setReopen({ provider: before, draft: patch, error: error.message });
    },
  });
}
```

> [codex] Bổ sung `concurrency = Math.max(1, ...)`, callback progress và `AbortSignal`. `beforeunload` chỉ nhắc người dùng, không bảo đảm browser hoàn tất upload khi tab đóng; state retry phải giữ đủ task id, file identity và client request id. Nếu cần thứ tự file ổn định, không dựa vào thứ tự `failed.push()` của worker song song.

- `ProviderEditDialog.save()` gọi `onSave(patch)` rồi `onClose()` ngay, không `await`.
- Có `reopen` thì mở lại hộp với `initialDraft={reopen.draft}` và `initialError={reopen.error}`.

**Test** (`src/lib/collaboration/optimistic.test.ts`):
1. `apply` chạy trước khi `request` xong.
2. Thành công: `commit` nhận dữ liệu server, `rollback` không chạy.
3. HTTP 409: `rollback` nhận lỗi có `isConflict`.
4. Mất mạng: lỗi có `status` 0.
5. `keepRecentCreates`: giữ dòng tạo sau lúc lượt tải bắt đầu, bỏ dòng tạo trước đó, không nhân đôi dòng mà kết quả tải đã có.

**Kiểm tay:** sửa một provider → hộp đóng, dòng đổi ngay. Chặn `api/automation/provider-list` → dòng trở lại, hộp mở lại đúng dữ liệu vừa nhập, có lỗi đỏ.

### T2.1 — Tạo task / tạo hồ sơ Enrollment: đóng form khi server đã tạo, file tải nền song song

Mẫu C. **Hàm dùng chung mới**, `src/lib/attachments/background-uploads.ts` (thuần, có test):

```ts
/** Chạy `upload` cho từng mục, tối đa `concurrency` mục cùng lúc; trả về mục bị lỗi. */
export async function uploadWithConcurrency<T>(
  items: readonly T[],
  upload: (item: T) => Promise<boolean>,
  concurrency = 3,
): Promise<T[]> {
  const failed: T[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      const ok = await upload(item).catch(() => false);
      if (!ok) failed.push(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return failed;
}
```

**Task** (`NewTaskDialog.tsx:250-336`, `TaskBoardClient.tsx:1822-1861`):
1. `submit()`: sau khi `onCreate(...)` trả về `created`, **đóng form ngay**, rồi giao `pendingFiles` cho `TaskBoardClient` qua prop mới `onBackgroundUpload(created.id, files)`.
2. Trong `TaskBoardClient`:
   - thêm state `backgroundUploads: Map<taskId, { total, done, failed: string[] }>`;
   - chạy `uploadWithConcurrency` với `POST /api/tasks/{id}/attachments` (giữ `client_request_id` của từng file, `silent=1`);
   - toast "Uploading 2 files to CS-123…" → xong thì "Files attached"; lỗi thì "1 file did not upload — open CS-123 to retry";
   - xong thì `publishTaskDataInvalidation({ taskId })`, như code hiện tại.
3. Ghi task mới vào `recentCreates`; `refetchTasks` (`TaskBoardClient.tsx:552`) lọc kết quả qua `keepRecentCreates` trước khi áp.
4. Có file đang tải thì đăng ký `beforeunload` để trình duyệt hỏi lại trước khi đóng tab. Mẫu có sẵn ở `NewEnrollmentDialog` (`EnrollmentClient.tsx:4920-4928`).

**Enrollment** (`EnrollmentClient.tsx:1712`, `:2109`):
- `onCreate` đóng form và mở drawer ngay khi POST trả về.
- `uploadEnrollmentFiles` (`:1688`) và lần đọc lại hồ sơ (bản sửa lỗi Cheryl) chạy nền với cùng toast. Phần đọc lại phải giữ, vì nó cập nhật `updated_at`. Nếu người dùng sửa trong lúc file đang tải, `patchRecord` đã tự gửi lại khi bị 409 (`canRetryAfterConflict`).
- Danh sách: `reload` (`:4014`) lọc kết quả qua `keepRecentCreates`.
- Chưa có `client_request_id` (E1 ở plan go-live): mất mạng đúng lúc tạo rồi bấm lại vẫn có thể ra hồ sơ trùng, như hiện nay. Nên làm E1 cùng đợt.

**Test:** `uploadWithConcurrency` không bao giờ chạy quá 3 file cùng lúc; trả đúng các mục lỗi; danh sách rỗng thì trả `[]`.

**Kiểm tay:** tạo task kèm 3 file → form đóng ngay sau khi task hiện trên bảng; toast tiến trình; tắt mạng giữa chừng → toast báo file lỗi, mở task tải lại được.

### T2.2 — Gán lead: đổi tên người được gán ngay

Mẫu A. `LeadsClient.tsx:812-846`, `assignLead`. Tách phần fetch hiện có (`:817-827`) thành hàm dùng chung cho cả gán một lead lẫn gán hàng loạt:

```ts
async function postAssign(ids: string[], toEmail: string | null, reason = ""): Promise<LeadRow[]> {
  const payload = await requestJson<{ leads?: LeadRow[] }>("/api/leads/assign", {
    method: "POST",
    headers: { "x-lead-client-source": sourceId },
    body: JSON.stringify({ lead_ids: ids, to_email: toEmail, reason }),
  });
  return payload.leads ?? [];
}

const assignLead = useCallback(async function assignLead(id: string, toEmail: string | null) {
  const previous = leadsRef.current.find((lead) => lead.id === id);
  const withAssignee = (email: string | null) => (lead: LeadRow) =>
    lead.id === id ? { ...lead, assigned_to_email: email } : lead;
  setLeads((current) => current.map(withAssignee(toEmail)));
  setSelectedLead((current) => (current ? withAssignee(toEmail)(current) : current));
  try {
    // Xếp hàng chung với patchLead để lượt gán và lượt sửa cùng một lead không chen nhau.
    const returned = await patchSerializerRef.current(id, () => postAssign([id], toEmail));
    if (returned.length > 0) applyReturnedLeads(returned);
    else void reloadRef.current();
    setEditError(null);
  } catch (error) {
    if (previous) {
      setLeads((current) => current.map(withAssignee(previous.assigned_to_email)));
      setSelectedLead((current) => (current ? withAssignee(previous.assigned_to_email)(current) : current));
    }
    setEditError(error instanceof Error ? error.message : "Could not assign that lead.");
    throw error;
  }
}, [sourceId, applyReturnedLeads]);
```

- Chỉ đổi `assigned_to_email`. Những field server tự đổi khi gán (ví dụ `assigned_at`) để server trả về (nguyên tắc 6).
- **Gán hàng loạt** (`assignSelected`, `:848-883`): đổi ngay mọi dòng trong `selected`, bỏ chọn, gọi `postAssign([...selected], toEmail, assignmentReason)`. Dòng có trong `selected` mà không có trong `returned` thì hoàn lại riêng dòng đó và báo "2 of 10 leads were not assigned". Lỗi cả request thì hoàn lại cả nhóm. Vòng xoay chỉ còn trên nút. Nhánh `await reload()` khi server không trả dòng nào đổi thành `void reload()`.

**Kiểm tay:** đổi Agent của lead → tên đổi ngay. Chặn request (DevTools → Block request URL `api/leads/assign`) → tên quay về, hiện lỗi.

> [codex] `createKeyedSerializer` chỉ xếp hàng trong một browser. API `/api/leads/assign` hiện không nhận `expected_updated_at`, nên hai manager vẫn last-write-wins. Plan cần chốt rõ đây là business rule, hoặc thêm version check/409 trước khi hứa không ghi đè assignment của người khác.

### T2.3 — Tạo lead: không chờ tải lại cả danh sách

Mẫu C. `LeadAddDialog.tsx:355-428`, `LeadsClient.tsx:1571`:
1. POST trả về `payload.lead`. Đổi prop `onCreated()` thành `onCreated(lead: LeadRow)`. `LeadsClient` chèn dòng vào `leads` ngay (bỏ qua nếu đã có, vì realtime có thể tới trước), cộng `total`, ghi vào `recentCreates`. Sau đó gọi `void reload()` **chạy nền**, không `await`.
2. `reload` (`LeadsClient.tsx:328-360`) lọc kết quả qua `keepRecentCreates`. Cần thiết vì hàm này có `requestInFlight`/`pendingRefresh`: một lượt tải đã chạy từ trước lúc tạo sẽ áp danh sách thiếu lead mới, làm lead nháy mất rồi hiện lại.
3. File: theo T2.1. Đóng form ngay, tải nền bằng `uploadWithConcurrency`, toast tiến trình.

### T2.4 — Sửa / xoá comment: đổi ngay, tải lại chạy nền

Mẫu A. `CommentThread.tsx`:
1. Thêm hai state cục bộ: `pendingDeletes: Set<string>` và `pendingEdits: Map<string, string>`. Khi render, áp lên danh sách comment: comment đang xoá thì ẩn (hoặc hiện mờ), comment đang sửa thì hiện body mới kèm chữ "Saving…".
2. `remove(id)` (`:1273-1301`) và `edit(...)` (`:1303-1345`):
   - đặt state trên **trước** khi gọi API;
   - thành công thì gọi `void onReload()`, **không** `await`;
   - lỗi thì gỡ state, trả về `{ ok: false, message }` như hiện tại;
   - 409 khi sửa thì giữ cách hiện tại: hiện bản mới nhất và báo người dùng.
3. `confirmDelete` (`:1689-1706`) và luồng lưu khi sửa (`:2226`) đóng ngay, không chờ.
4. Áp cho cả Task CS và Enrollment. Ở Enrollment, `onReload = reloadDetailAndParent` (`EnrollmentClient.tsx:4437`) tải lại cả danh sách; giờ chạy nền nên không ai phải chờ.

> [codex] PATCH comment đã trả canonical `comment`, nên commit local bằng response thay vì chỉ dựa vào reload nền. Delete cần giữ tombstone overlay tới khi snapshot server không còn id đó; nếu clear `pendingDeletes` ngay sau response, một reload bắt đầu từ trước có thể làm comment đã xóa xuất hiện lại.

**Kiểm tay:** xoá comment → biến mất ngay. Sửa → chữ mới hiện ngay. Chặn request → comment trở lại, hiện lỗi.

### T2.5 — Lead: ghi tương tác và comment hiện ngay

Loại Lai. `InteractionLog.tsx:181-236`, `LeadDetailDrawer.tsx:469-512`:
1. **Ghi tương tác:**
   - Bấm Save → đóng hộp ngay.
   - Chèn một dòng tạm vào danh sách (id `temp-<client_request_id>`, chữ mờ, "Saving…") qua callback mới `onInteractionPending(temp)` của component cha.
   - Thành công → thay dòng tạm bằng `result.interaction`, cập nhật lead qua `onLeadUpdated` (status, follow-up, số lần liên hệ) như hiện tại. Mấy giá trị này do server tính, nên chỉ hiện khi server trả về.
   - Lỗi → bỏ dòng tạm, mở lại hộp với nội dung cũ và lỗi.
   - Giữ `client_request_id`, nên bấm thử lại không tạo trùng.
2. **Comment:** làm tương tự, hiện comment tạm ngay và xoá ô nhập. Chuyển sang dùng chung `CommentThread` là việc lớn hơn, để sau (mục 12).

### T2.6 — Panel đính kèm: hiện file đang tải, xoá ngay

`AttachmentPanel.tsx`:
- **Tải lên** (`:34-72`), loại Lai: chèn ngay một dòng file tạm (tên, dung lượng, "Uploading…"). Xong thì thay bằng dữ liệu thật, gọi `void onReload()` chạy nền. Lỗi thì đánh dấu đỏ, có nút "Retry".
- **Xoá** (`:74-111`), Mẫu A: ẩn dòng ngay. Lỗi thì hiện lại cùng lỗi. `onReload` chạy nền.

### T2.7 — Gán task ở Overview: bỏ vòng xoay chờ tải lại

`TaskBoardClient.tsx:1773-1820`: sau khi POST thành công thì gọi `setAssigningOverviewTaskId(null)` **ngay**, đổi `await loadOverview(true)` (`:1792`, `:1809`) thành `void loadOverview(true)`.

### T2.8 — ACA Overview: gán người phụ trách, bật/tắt hàng đợi

> Nhanh thêm nhờ T1.2, vì cả hai cùng gọi `PATCH /api/enrollment/[id]`.

**Gán người phụ trách** (`AcaAssignPicker.tsx:8-17`), Mẫu A trong một ô:
- Thêm state `pending: { email: string | null } | null`. Ô hiển thị `pending ? pending.email : currentEmail`.
- `assign(email)`: `setPending({ email })` **trước** khi gọi API. Ô này vẫn khoá tới khi xong (`canEdit={!busy}`), vì lượt gán sau cần `expected_updated_at` mới. Đây là khoá đúng một ô, hợp nguyên tắc 5.
- Thành công: gọi `onAssigned(...)` như hiện tại (dòng có thể rời bảng Unassigned), rồi `setPending(null)`.
- Lỗi: `setPending(null)` để ô về người cũ, giữ chữ "Failed" kèm lỗi như hiện tại.

**Bật/tắt hàng đợi** (`AcaOverviewDashboard.tsx:69-80`), loại Lai:
- State mới `queueOverrides: Map<email, boolean>`. Ô tick (`:132`) hiển thị `queueOverrides.get(email) ?? snapshot.queue.some((card) => card.email === email)`.
- Bấm thì đặt override ngay rồi gọi PATCH. Khoá theo email bằng `usePendingKeys` (T2.0), thay cho `updatingQueueEmail` (chỉ giữ được một người).
- **Không** tự thêm thẻ người vào hàng đợi khi bật: số Open, Over limit, lần gán cuối do server tính (nguyên tắc 6). Tắt thì ẩn thẻ ngay: danh sách thẻ bỏ các email có override `false`.
- Thành công: `void load()` chạy nền thay cho `await load()`. Snapshot mới về thì xoá override của email đó.
- Lỗi: xoá override (ô trở lại), hiện `queueError` như hiện tại.

**Kiểm tay:** gán người ở bảng Unassigned → tên đổi ngay, dòng rời bảng khi server xác nhận. Chặn `api/enrollment` → ô về trống, hiện "Failed". Bật/tắt hàng đợi 3 người liên tiếp → cả 3 ô đổi ngay, không ô nào phải chờ ô khác.

---

## 10. Phase 3 — Màn phụ và quản trị

### T3.1 — Account Manager

> `AccountManagerClient.tsx` đang có thay đổi chưa commit của phiên khác. Chờ commit rồi mới sửa.

- **Alerts** (`toggleAlerts`, `:366-431`): bỏ `setBusyUserId(user.id)` (`:386`) và `setBusyUserId(null)` (`:429`). Thay bằng `usePendingKeys` với key `alerts:<userId>`, chỉ truyền vào `AlertToggle busy` (`:531`). Các nút khác trên dòng không bị khoá nữa.
- **Sửa tên, agent ID** (`handleEditAccount` `:301-316` → `updateUser` `:245-283`): Mẫu B. Bảng đang hiện từ `initialUsers` (prop từ server). Thêm `userOverrides: Map<id, Partial<ManagedAccountUser>>` áp lên `initialUsers`, giống cách `alertOverrides` đang làm (`:102`, `:171-175`). `router.refresh()` vẫn gọi để xác nhận; khi `initialUsers` đổi thì xoá các override đã khớp.
- **Tạo tài khoản, đổi role, reset mật khẩu, xoá** (`:209-243`, `:317-365`): vẫn chờ server, chỉ khoá đúng hộp. Thành công thì đổi bảng ngay từ response, không chờ `router.refresh()`:
  - đổi role → ghi role mới vào `userOverrides`;
  - xoá → ẩn dòng;
  - tạo → chèn `user` mà `POST /api/admin/users` trả về (`src/app/api/admin/users/route.ts:140`).

> [codex] `POST /api/admin/users` hiện chỉ trả basic account fields, không có `role_ids`, `roles`, alert fields mà `ManagedAccountUser` yêu cầu. Không thể chèn trực tiếp `payload.user` vào bảng. Hoặc mở rộng API trả full managed-user shape sau khi roles được ghi, hoặc dựng local row từ selected role IDs rồi reconcile bằng refresh nền.

### T3.2 — Time Off

Duyệt, từ chối, huỷ đơn: loại Lai. `decide()` (`TimeOffClient.tsx:560-586`):
1. Đóng hộp **ngay** khi bấm. Thêm state `decidingIds: Map<requestId, action>`; dòng đó hiện "Approving…", "Declining…" hoặc "Cancelling…" và khoá nút trên dòng.
2. **Không** đổi số dư hay lịch trước khi server xác nhận (nguyên tắc 6).
3. Thành công: thêm vào `decidedIds` như hiện tại (dòng rời hàng đợi), hiện notice. `await refreshVisibleCalendar()` đổi thành `void refreshVisibleCalendar()`. `router.refresh()` giữ nguyên (vốn không `await`).
4. Lỗi: bỏ khỏi `decidingIds`, mở lại hộp với ghi chú vừa nhập và lỗi (`setDecisionRequest(request)`, `setDecisionAction(action)`, `setDecisionNote(note)`, `setDecisionError(message)`).

Thêm, xoá ngày lễ (`submitHoliday` `:588-609`, `removeHoliday` `:688-700`): vẫn chờ server, nhưng `await refreshVisibleCalendar()` đổi thành chạy nền.

Gửi đơn và các thao tác số dư (`:526-550`, `:611-686`): giữ nguyên.

### T3.3 — Customer Registration (Health, P&C)

`EntryGrid.tsx` và `PcEntryGrid.tsx` sửa giống nhau:
- **Xoá** (`handleDelete`), Mẫu A: bỏ `setLoading(true)` (đang phủ loading lên cả bảng). Bỏ dòng khỏi state lịch sử (state mà `loadHistory`, `EntryGrid.tsx:381`, ghi vào) ngay; lỗi thì chèn lại đúng vị trí cũ kèm thông báo. `loadHistory()` chạy nền.
- **Sửa trong hộp** (`handleUpdate`): Mẫu B.
- **Sửa thẳng trong ô** (`onHistoryCellValueChanged`): lỗi thì trả **đúng ô đó** về `event.oldValue` bằng `event.node.setData({ ...event.data, [field]: event.oldValue })`, thay vì tải lại cả bảng. `setData` không bắn lại `cellValueChanged`, còn `setDataValue` thì có; kiểm lại trên bản AG Grid đang dùng.
- **Gửi dòng mới** (`handleSubmit`): giữ chờ POST (QĐ-F). Bỏ `await loadHistory()`: POST đã trả `entries` (`src/app/api/entries/route.ts:120-141`), chèn thẳng vào đầu lịch sử rồi `void loadHistory()` chạy nền. Form xoá và hiện "Submitted successfully" ngay khi POST xong.

### T3.4 — Provider List

Đã làm ở T2.0 (thí điểm).

### T3.5 — Chuông thông báo: hoàn lại khi đánh dấu đã đọc bị lỗi

`NotificationBell.tsx:482-503`:

```ts
async function markRead(ids: string[]) {
  const unreadIds = items.filter((n) => ids.includes(n.id) && !n.is_read).map((n) => n.id);
  if (unreadIds.length === 0) return;
  setItems((cur) => cur.map((n) => (unreadIds.includes(n.id) ? { ...n, is_read: true } : n)));
  setUnread((current) => Math.max(0, current - unreadIds.length));
  const ok = await fetch("/api/tasks/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: unreadIds }),
  })
    .then((response) => response.ok)
    .catch(() => false);
  if (!ok) {
    setItems((cur) => cur.map((n) => (unreadIds.includes(n.id) ? { ...n, is_read: false } : n)));
    setUnread((current) => current + unreadIds.length);
  }
}
```

- Sửa luôn một lỗi nhỏ: code hiện tại trừ `ids.length`, tính cả thông báo đã đọc rồi, nên số chưa đọc có thể bị trừ lố.
- `markAllRead`: lưu số chưa đọc và danh sách id chưa đọc trước khi đổi; lỗi thì trả lại cả hai. Toast đã đóng thì không mở lại.

> [codex] Khi poll/realtime chạy song song, rollback `setUnread(current + unreadIds.length)` có thể cộng sai vì state đã chứa notification mới hoặc một mutation khác. Derive unread từ `items` sau khi rollback, hoặc gọi reload summary; rollback cũng chỉ hoàn lại item mà chính mutation này đã đổi.

### T3.6 — Settings: ảnh đại diện hiện ngay

`SettingsClient.tsx`, loại Lai:
- `uploadAvatar` (`:123-151`): sau `resizeImageToSquare`, đặt `setAvatarUrl(URL.createObjectURL(resized))` ngay, giữ URL cũ. Thành công thì dùng URL server trả về và gọi `URL.revokeObjectURL`; `router.refresh()` giữ để header đổi theo. Lỗi thì trả URL cũ, hiện `avatarError`.
- `removeAvatar` (`:153-170`): ẩn ảnh ngay; lỗi thì trả lại.

### T3.7 — Config: bỏ khoá cả trang

`ConfigClient.tsx`:
1. **Rẻ, làm trước:** trong các action chạy qua `run()` (`:367-392`), các lệnh tải lại sau khi ghi (`await refreshScope(...)`, `await refreshCategories()`, `await onOptionDataChange()`, ví dụ `:844, 858, 1800, 1806, 1851, 1857`) đổi thành `void …`. Cờ `busy` chung khi đó chỉ kéo dài một request thay vì hai. Action sau cần dữ liệu mới (ví dụ `updated_at`) thì lấy từ response API, không chờ tải lại.
2. **Mẫu A** cho đổi tên, đổi màu giá trị (`renameValue`, `recolorValue`, `:1847-1884`), rule stage (`toggleStageRule`, `:1885-1920`), công tắc SLA (`ConfigSlaSection.toggle`, `:142-184`). Khoá theo đúng giá trị hoặc ô bằng `usePendingKeys`, không qua `busy` chung.
3. Thêm, archive, assistant: giữ chờ server (cần id, có hộp xác nhận, đổi phạm vi xem).

> [codex] Không đổi blanket mọi `await refresh…()` thành `void refresh…()`. Với route không trả canonical data/version, action tiếp theo có thể chạy trên `updated_at` cũ hoặc UI không hề đổi cho tới khi refresh về. Mỗi action cần local optimistic patch + response canonical, hoặc serializer giữ refresh trong hàng đợi theo scope.

---

## 11. Phase 4 — Không bỏ lượt sửa khi bị 409 (Task CS)

`TaskBoardClient.tsx`: bị 409 thì code hiện tại **bỏ** lượt sửa và báo "This task changed elsewhere; reloaded the current version.", ở cả `patchTask` (`:1528-1539`) lẫn `changeAssignee` (`:1730-1737`). Đây đúng là kiểu lỗi đã sửa cho Enrollment ở `6da7ee0`.

1. Tách `canRetryAfterConflict` (`src/lib/enrollment/optimistic-patch.ts:82`) thành `src/lib/collaboration/conflict-retry.ts`, nhận thêm bảng riêng của từng module: `canRetryAfterConflict(patch, before, canonical, { requestOnlyKeys, relatedColumns })`. Enrollment truyền `REQUEST_ONLY_KEYS` và `RELATED_COLUMNS_FOR_REQUEST_KEY` đang có; Task truyền bảng của mình. Test cũ của Enrollment (`optimistic-patch.test.ts`) phải vẫn qua.
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
3. Đưa checklist review ở mục 14 vào `AGENTS.md`, mục "Thao tác ghi", để mọi phiên sau đều theo. **Hỏi user trước**, vì file này áp cho mọi phiên.

**Ngoài phạm vi, để sau:**
- Tiến trình, huỷ, thử lại cho import (Lead, Enrollment, Provider), export, Statement, Provider Finder, AI chat. Không phải thao tác hằng ngày, và đã chỉ khoá đúng hộp.
- Comment Leads chuyển sang dùng chung `CommentThread`.
- Gộp phần logic trùng giữa `EntryGrid.tsx` và `PcEntryGrid.tsx`. Là refactor, không làm app nhanh hơn.
- Outbox thông báo (H5 ở plan go-live): đích lâu dài của QĐ-A.
- Ghi Sheet trong `after()` kèm ghi bù: chỉ làm nếu Phase 0 cho thấy cần (QĐ-F).

---

## 13. Thứ tự, phối hợp, ước lượng

| Bước | Việc | Phụ thuộc | Ước lượng |
|---|---|---|---|
| 1 | Phase 0 (đo mốc, log) | — | 0,5 ngày |
| 2 | **T1.1** (8 API Task) | — | 1 ngày |
| 3 | **T2.0** (bộ khung + thí điểm Provider List) | — | 0,5 ngày |
| 4 | **T2.2, T2.3, T2.4, T2.5, T2.7** | Bước 3 | 1,5 ngày |
| 5 | **T2.1** (phần Task, `uploadWithConcurrency`), T2.6 | Bước 3 | 1 ngày |
| 6 | **T1.2**, T2.1 (phần Enrollment), **T2.8** | Phiên go-live không còn sửa dở các file Enrollment | 1 ngày |
| 7 | T3.2, T3.3 | Bước 3 | 1 ngày |
| 8 | T3.1, T3.5, T3.6, T3.7 | `AccountManagerClient.tsx` đã commit | 1 ngày |
| 9 | Phase 4 | — | 0,5 ngày |
| 10 | Phase 5 | Các bước trên | 0,5 ngày |

Tổng khoảng 8,5 ngày. **Gói làm trước cho đỡ nhất** là bước 2–4 (khoảng 3 ngày): sửa task, gán task, tạo lead, gán lead, sửa/xoá comment, ghi tương tác lead.

> [codex] Ước lượng 8,5 ngày hợp lý cho code path chính, nhưng chưa gồm conflict testing, manual QA ở Texas, production measurement và rollback rehearsal. Nên dự phòng thêm 30–40% và deploy theo module/commit nhỏ thay vì gom cả Phase 1–3 vào một release.

**Tránh đụng file với phiên khác:**
- Go-live (`a317b94`) và tắt chuông (`39da093`, `9966499`) đã commit. Trước khi sửa `EnrollmentClient.tsx`, các API Enrollment, `NotificationBell.tsx`, `AccountManagerClient.tsx`: chạy `git status` và `git log -3 -- <file>`. Có phiên khác đang sửa dở thì để bước đó sau.
- Làm trong nhánh riêng (git worktree) nếu hai phiên chạy song song.

**Quay lại khi hỏng** (QĐ-D): mỗi task một commit. Sau deploy mà thấy tạo trùng, mất dòng vừa tạo, giá trị cũ đè giá trị mới hoặc lộ dữ liệu ngoài phạm vi, thì revert đúng commit đó hoặc Promote bản deploy trước trên Vercel. Revert chỉ đổi code; dữ liệu và log server giữ nguyên, nên vẫn so được trước và sau.

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

`npm run typecheck && npm run test:run && npm run lint && npm run build`. Test mới cho các hàm thuần: `runOptimistic`, `requestJson`, `keepRecentCreates`, `uploadWithConcurrency`, các hàm áp state tạm của comment và tương tác, `conflict-retry`.

### Sáu kịch bản kiểm tay, cho mọi thao tác "Tức thì" và "Lai"

| # | Kịch bản | Cách tạo | Kết quả đúng |
|---|---|---|---|
| 1 | Thành công | Mạng thường; rồi giả lập Texas (thêm khoảng 250 ms trễ) | Màn hình đổi ngay. Chỉ thông báo "đã lưu" hoặc tiến trình là tới sau |
| 2 | Server từ chối | Nhập dữ liệu sai, hoặc dùng tài khoản thiếu quyền | Trở về đúng như trước, thông báo đỏ nói rõ cái gì chưa lưu |
| 3 | Mất mạng | DevTools → Network → Block request URL, hoặc Offline | Như kịch bản 2 |
| 4 | Xung đột 409 | Hai tab cùng sửa một bản ghi | Không đè thay đổi của tab kia. Sau Phase 4: sửa khác trường thì cả hai được lưu |
| 5 | Bấm đúp, thử lại | Bấm nhanh hai lần; chặn mạng sau khi gửi rồi bấm lại | Không có bản ghi trùng |
| 6 | Tải lại giữa chừng | Thao tác rồi lập tức đổi bộ lọc, bấm Refresh, hoặc để realtime từ tab khác về | Dòng vừa tạo không biến mất; giá trị không nháy về bản cũ |

Thêm hai kiểm tra chung:
- **Hai tab:** thao tác ở tab A thì tab B cập nhật trong vài giây (realtime vẫn chạy sau T1.1/T1.2).
- **Phân quyền:** tài khoản agent không thấy dữ liệu ngoài phạm vi, kể cả trong lúc có phần tạm.

### Kịch bản riêng phải thử

| Task | Kịch bản |
|---|---|
| T2.1 | Tạo task kèm 3 file trên mạng giả lập Texas: form đóng trước khi file xong, có toast tiến trình. Tạo rồi tải lại trang ngay: task vẫn còn, file nào chưa xong thì báo |
| T2.1 (Enrollment) | Tạo hồ sơ kèm file rồi sửa ngay khi file còn đang tải: lượt sửa vẫn được lưu |
| T2.2 | Gán khi danh sách đang tải lại nền. Gán hàng loạt có dòng bị server từ chối: chỉ dòng đó trở lại |
| T2.3 | Tạo lead khi một lượt tải lại đang chạy: lead mới không nháy mất |
| T2.4 | Sửa, xoá comment khi người khác vừa đổi bản ghi cha |
| T2.8 | Bật/tắt hàng đợi với PATCH bị chặn: ô trở lại, có lỗi |
| T3.3 | Sửa ô ở Health và P&C với request bị chặn: đúng ô đó về giá trị cũ, bảng không tải lại |
| T3.5 | Đánh dấu đã đọc với request bị chặn: thông báo trở lại chưa đọc, số trên chuông đúng |

### Sau khi deploy

Đo lại 13 thao tác ở mục 13 và điền cột "sau". So số `mutation.conflict` và `*.side_effects_failed` trong Vercel Logs trước và sau.

### Checklist review cho mọi thao tác ghi (từ nay về sau)

1. Thao tác này thuộc loại nào: Tức thì, Lai hay Chờ server? Nếu không hiển nhiên thì ghi một dòng comment cạnh handler.
2. Giao diện có đổi **trước** `await fetch` không?
3. Có bản trước để hoàn lại không? Lỗi có thông báo nói rõ cái gì chưa lưu không?
4. Có `await reload()` hay `router.refresh()` nằm trong đường chờ không?
5. Khoá có đúng phạm vi (nút, ô, dòng) không?
6. Bấm đúp hoặc thử lại có tạo trùng không? (`client_request_id`, hàng đợi theo bản ghi)
7. Có hiện kết quả mà chỉ server tính được không?
8. Phía API: thông báo, realtime, push có nằm trong `after()` không?

### Xong khi

- [ ] Mọi thao tác ghi ở mục 4 có loại đích và đã làm đúng loại đó.
- [ ] Thao tác "Tức thì" có hoàn lại, xử lý 409 và thay bằng dữ liệu server.
- [ ] Tạo mới không còn chờ file đính kèm.
- [ ] Thao tác trên một dòng không còn tải lại cả bảng hay cả trang trong đường chờ.
- [ ] Không còn cờ loading/busy chung khoá control không liên quan: overlay của Customer Registration, khoá dòng ở Account Manager, `busy` chung ở Config.
- [ ] Các API ở bảng Server (mục 4) trả lời ngay sau khi ghi DB; Server Timing không còn mốc thông báo hay realtime.
- [ ] Phân quyền vẫn do server quyết.
- [ ] Bảng số liệu: cột (a) giảm; số 409 và số lỗi việc phụ trong log không tăng.
- [ ] `changelog.md` ghi đủ.

---

## Phụ lục — Gộp từ plan của Codex

| Điểm trong plan Codex | Xử lý ở đây | Lý do |
|---|---|---|
| Ba loại thao tác: optimistic, hybrid, server-confirmed | **Lấy.** Mục 3, cột "Loại" ở mục 4 | Cho mọi thao tác một quy ước chung (nguyên nhân D) |
| Không bịa kết quả server tính; dữ liệu server là chuẩn; tải lại nền không đè thay đổi đang chờ | **Lấy.** Nguyên tắc 2, 6, 7 | |
| ACA Overview: gán người phụ trách, bật/tắt hàng đợi | **Lấy.** T2.8 | Audit đầu của mình sót hai chỗ này do lỗi lọc kết quả grep |
| Gán lead hàng loạt mức P1, lỗi một phần | **Lấy.** T2.2 | |
| Giữ dòng vừa tạo khi tải lại nền | **Lấy.** `keepRecentCreates` ở T2.0 | |
| Time Off không bịa kết quả duyệt hay số dư | **Lấy.** T3.2 thành loại Lai | Gộp với cách đóng hộp ngay của plan mình |
| Mark-read có hoàn lại | **Lấy, hạ xuống P3.** T3.5 | Đã đổi ngay từ trước, chỉ thiếu phần hoàn lại |
| Settings: ảnh đại diện hiện ngay, mật khẩu chờ server | **Lấy, P3.** T3.6 | |
| Config: công tắc, đổi tên tức thì | **Lấy, P3.** T3.7 | Thêm phát hiện cờ `busy` chung khoá cả trang |
| Bộ khung optimistic dùng chung, thí điểm ở một module ít rủi ro | **Lấy có giới hạn.** T2.0 | Chỉ cho luồng mới (QĐ-E) |
| Ma trận test (thành công, lỗi, mất mạng, 409, bấm đúp, tải lại giữa chừng) | **Lấy.** Mục 14, kiểm tay | Repo chưa có test giao diện hay E2E |
| Definition of done, checklist review | **Lấy.** Mục 14 | |
| Phân loại mọi thao tác ghi (Phase 8 của Codex) | **Làm ngay** ở mục 4 | Phân loại trước thì mới biết sửa gì |
| Telemetry sự kiện mutation phía client | **Không lấy** | Chưa có hạ tầng đo; khoảng 50 người dùng thì đo tay 13 thao tác là đủ. Thay bằng log server có tên cố định (Phase 0) |
| Feature flag theo module | **Không lấy** | QĐ-D |
| Tiến trình, huỷ, thử lại cho import, export, AI, Provider Finder | **Để sau.** Mục 12 | Không phải thao tác hằng ngày |
| Tách logic chung giữa Health và P&C grid | **Để sau.** Mục 12 | Refactor, không làm nhanh hơn |
