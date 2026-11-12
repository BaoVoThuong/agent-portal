# Khắc phục trần 1.000 dòng Supabase trên Agent Portal

Ngày lập: 12/11/2026 (Asia/Ho_Chi_Minh). Trạng thái: **P0/P1 đã commit trên `main`; P2 và kiểm chứng staging còn mở**.

## Tiến độ và giới hạn hiện tại

- Đã thêm reader keyset 500 dòng/trang, kiểm COUNT, retry lỗi tạm thời và báo lỗi nếu đọc thiếu. Áp dụng cho ACA Enrollment (gồm mọi nhánh schema fallback), hai Overview, stage cycles, comment/activity, Provider List/API/Export, Health/P&C Registration, Task Overview/cron/fallback metadata, Task assignee/participant, notification fallback, Lead Overview và phép tính quỹ nghỉ phép theo năm.
- Các vòng đọc vốn đã phân trang của dashboard, AI, Provider Finder, health statement và Lead import candidate dùng 500 dòng/request. Task Board quay lại 1.000 dòng/request để giảm lượt đi về tuần tự, vẫn phân trang. Task Search đã đổi sang RPC lọc quyền trong DB trước khi lấy 7 kết quả/nhóm, không còn trần quét 1.000 ứng viên trong ứng dụng; cần áp dụng `supabase/rollouts/2026-11-12-task-search-visible-content.sql` trước khi deploy code mới.
- Đã đối chiếu read-only trên Supabase: ACA 1.060 dòng = COUNT 1.060 qua ba request 500/500/60; alias cursor cho `task_assignees` và `task_participants` trả HTTP 200. Chưa kiểm UI theo từng vai trò trên staging hoặc production.
- Kiểm chứng tại lượt triển khai ban đầu: 256 file / 2.043 test qua, test riêng cho nhóm 1.001 Task assignee qua, typecheck qua, lint 0 lỗi (2 warning có sẵn), build production qua. Các lượt review sau có test bổ sung cho race khi insert giữa các trang.
- Task/Lead list vẫn có trần nghiệp vụ 5.000/20.000 dòng với cờ `truncated`; import có giới hạn file riêng. Các giới hạn này không phải trần 1.000 dòng của PostgREST.
- Chưa triển khai giãn broadcast theo Task 2b của plan 09/11 vì thay đổi đó có thể làm người khác thấy cập nhật chậm thêm khoảng 12 giây. Tỷ lệ `reason=broadcast` đo được là khoảng 65%, nên đây là bước tối ưu hiệu năng nên làm sau khi kiểm chính xác và đo tải của bản sửa.
- Chưa có bằng chứng trong plan này về kiểm thử workflow ghi trên DB, kiểm UI theo manager/agent hoặc đo p95/API count sau rollout. Các lookup cấu hình và danh sách tài khoản/vai trò hiện nhỏ nên chưa đổi sang phân trang trong lượt sửa này.

## Mục tiêu và phạm vi

- Khôi phục ACA Enrollment cho người xem hơn 1.000 hồ sơ.
- Bỏ phụ thuộc vào `db-max-rows = 1000` tại **mọi đường đọc cần toàn bộ tập kết quả**: trang, API tải lại, dashboard, cron, Export và dữ liệu phụ trợ. Mỗi request vẫn lấy một lô hữu hạn; không tăng cấu hình Max Rows toàn project.
- Giữ nguyên quyền xem theo từng người, bộ lọc, tìm kiếm, thứ tự, số đếm, Export và tính đúng của thông báo. Một tập kết quả không đầy đủ phải được báo lỗi rõ ràng, không được lặng lẽ hiển thị hoặc xuất file thiếu dòng.
- Phân biệt trần 1.000 dòng của Supabase với giới hạn nghiệp vụ có chủ ý, ví dụ 50 dòng/trang UI, 6 kết quả/tổ tìm kiếm, 500 lead phân phối/lượt và 5.000 Task/Lead trong bộ nhớ. Các giới hạn nghiệp vụ cần được đánh giá riêng; không xoá chúng bằng một thay đổi cấu hình.

## Root cause và bằng chứng

`fetchEnrollmentRecords()` trong `src/lib/enrollment/queries.ts` gọi `.select(..., { count: "exact" })` cho toàn bộ chương trình ACA, không có phân trang. Supabase API mặc định chỉ trả 1.000 dòng. `assertEnrollmentRecordsComplete()` thấy `count > data.length` nên ném `EnrollmentListTruncatedError`. `src/app/(authed)/enrollment/page.tsx` không xử lý lỗi đó, khiến trang SSR hiện “This page couldn't load”. `/api/enrollment` và `/api/enrollment/export` bắt lỗi, trả HTTP 503. Bản ghi không mất trong DB; response bị cắt ở tầng REST.

| Bằng chứng đọc ngày 12/11 | Kết quả |
|---|---|
| Supabase edge logs, 01:36:07 ICT | Lần đầu `/rest/v1/enrollment_records` trả HTTP 206 và `Content-Range: 0-999/1001`. |
| Supabase edge logs, 07:44 ICT | `Content-Range: 0-999/1060`, origin time 95 ms. |
| Đếm trực tiếp read-only lúc điều tra | ACA chưa archive: 1.060; Medicare: 109. |
| Vercel production, 00:00–10:00 ICT | 265 runtime errors `EnrollmentListTruncatedError` trên `/enrollment`; 241 request `/api/enrollment` trả 503 trong log đã truy vấn. |
| Supabase edge logs cùng cửa sổ | Không ghi 5xx cho các path `/rest/v1/enrollment%`; API trả partial response hợp lệ theo giới hạn hiện hành. |

Vercel có thể ghi HTTP 200 cho trang SSR đã bắt đầu stream dù nội dung hiện error. Vì vậy, tiêu chí phát hiện phải gồm runtime exception/digest và API 503, không chỉ tổng 5xx của trang. Sự cố này khác cơ chế `PGRST003`/nghẽn pool ngày 09/11; lần này dữ liệu vượt trần ngay cả khi truy vấn DB nhanh.

## Kiểm kê đã xác định

| Mức ưu tiên | Đường đọc | Tình trạng | Thay đổi cần làm |
|---|---|---|---|
| P0 | `src/lib/enrollment/queries.ts` → SSR `/enrollment`, GET `/api/enrollment`, Export | Đã hỏng khi ACA >1.000. Cả các nhánh fallback thiếu cột đều đọc một lần. | Một hàm đọc nhiều trang dùng chung cho mọi nhánh; kiểm đủ số dòng trước khi hydrate stats/Export. |
| P0 | `src/lib/enrollment/overview-data.ts` và `stage-metrics.ts` | Overview đọc hồ sơ một lần nên có thể tính thiếu; stage dwell đã có guard và sẽ lỗi khi >1.000. | Đọc hồ sơ/ID theo trang với cùng scope; đếm/tính trên toàn bộ kết quả. Stage cycles cũng phải phân trang ổn định. |
| P1 | `src/app/api/automation/provider-list/route.ts`, `/export/route.ts`, `src/app/(authed)/tasks/providers/page.tsx` | `.limit(5000)` vẫn chịu trần 1.000 của Supabase; Provider hiện 461 live, 14 backlog. | Dùng một hàm đọc Provider live có phân trang cho trang, API và Export. Với Export theo ID, chỉ đọc các ID yêu cầu theo lô. Backlog đã có keyset. |
| P1 | `src/app/api/cron/check-overdue/route.ts` | Nhiều nhánh quét `tasks` không phân trang; khi một trạng thái có >1.000 Task, reminder/audit có thể bỏ sót. Hiện 660 Task chưa archive. | Phân trang theo ID cho từng tập cần quét hoặc chuyển predicate/tính toán phù hợp vào SQL; giữ RPC idempotent và không bắn thông báo lặp. |
| P1 | `src/app/(authed)/page.tsx`, `customer-registration/pc/page.tsx`, GET `/api/entries`, GET `/api/pc-entries` | Health/P&C Registration đọc tất cả entry một lần; hiện mỗi bảng 2 dòng. | Một hàm đọc có phân trang và áp đúng `buildVisibleEntriesFilter` trên từng trang; sau đó cân nhắc server-side UI pagination khi số dòng tăng. |
| P1 | `src/lib/tasks/queries.ts` nhánh `TASK_COLUMNS_LEGACY` | Đường chính đã keyset; fallback thiếu `custom_values` còn đọc một lần và sẽ 503 ở >1.000. | Cho fallback dùng cùng cơ chế keyset/scope của đường chính. |
| P1 | GET `/api/enrollment/[id]/comments` | Đọc toàn bộ comment của một hồ sơ; drawer chính đã phân trang qua `loadEnrollmentComments()`. | Dùng cùng cursor contract hoặc đổi endpoint legacy thành một trang có `hasMore`; kiểm tra caller trước khi đổi response. |
| P2 | `src/lib/tasks/search.ts` | Đã sửa local: trước đây `MAX_SEARCH_SCAN = 1000` có thể che kết quả hợp quyền nằm sau ứng viên thứ 1.000. | RPC lọc quyền trong PostgreSQL trước `LIMIT 7` từng nhóm; ứng dụng hiển thị 6 kết quả và đặt `truncated` khi có kết quả thứ 7. Còn áp dụng rollout SQL trước deploy. |
| P2 | Lookup/notification/metadata theo mảng ID và dữ liệu tham chiếu | Một số `.in(...)` hoặc `.select()` không phân trang ở `enrollment/recipients`, `tasks/queries` fallback enrich, RBAC, account/role manager, option/config, time-off, notification enrichment. Phần lớn hiện có cardinality nhỏ hoặc đã chunk, nhưng chưa có bảo đảm chung. | Kiểm từng call site theo tập kết quả thực tế; chunk đầu vào không đồng nghĩa đầu ra <1.000. Thêm phân trang/COUNT guard tại nơi cần toàn bộ dòng. |

Đã phân trang ở đường chính: Task list, Lead list và overview, Provider backlog, nhiều dashboard/mart, cron Enrollment due và comment drawer chính. Kiểm tra lại kích thước trang đang đặt đúng 1.000; đổi thành 500 để chịu được cấu hình Supabase thấp hơn và dùng khóa sắp xếp duy nhất. Những query `head: true` chỉ lấy COUNT, `.single()`/`.maybeSingle()` và `.limit()` theo nghiệp vụ có chủ ý không phải lỗi này.

## Thiết kế chung

1. Thêm helper server-side đọc nhiều trang theo **keyset `id` bất biến** với `pageSize = 500`, request tuần tự, retry tối đa một lần cho 429/5xx/timeout. Mỗi lượt tạo query builder mới; áp scope và filter **trước** `.order("id")`/`.limit(500)` trên mọi trang. Không dùng offset song song cho bảng có insert/archive trong khi đọc. Giữ thứ tự hiển thị bằng sort sau khi ghép nếu UI yêu cầu `updated_at`/`created_at`.
2. Lấy `count: "exact"` ở trang đầu khi cần kiểm đầy đủ; tiếp tục tới trang rỗng khi count thiếu. Kiểm ID duy nhất, cursor tiến lên và tổng loaded so với count. Nếu dữ liệu đổi giữa các trang khiến count không khớp, retry toàn lượt một lần; sau đó trả lỗi rõ ràng. Với Export hoặc phép tính cần snapshot tuyệt đối, cân nhắc RPC/SQL transaction snapshot thay vì giả định nhiều REST request là cùng một snapshot.
3. Không gom hàng nghìn request con vào một `Promise.all`. Giới hạn concurrency cho lookup/metadata; thay scan/hydration tốn kém bằng aggregate RPC hoặc server-side filter ở luồng lớn. Giữ RBAC trong DB trước khi phân trang, và kiểm quyền lại ở nhánh Export/notification.
4. Tách API trang dữ liệu khỏi UI 50 dòng/trang trong giai đoạn sau: server xử lý filter/search/sort/count, client nhận cursor và dữ liệu trang. Các phép tổng, tìm trong comment và Export phải có nguồn dữ liệu toàn bộ tập đã lọc; không tính từ 50 dòng đang hiển thị.

## Trình tự thực hiện

### 1. Khôi phục ACA và Overview (P0)

- Viết test tái hiện 999/1000/1001/1500 dòng, số đếm thiếu, lỗi trang thứ hai, bản ghi archive/insert giữa các trang, và scope khác nhau.
- Tái sử dụng hoặc mở rộng `src/lib/pagination/keyset.ts`; không dùng `maxRows = 5_000` của Task làm trần mới cho ACA. Áp dụng helper vào cả primary/fallback của `fetchEnrollmentRecords()`, rồi vào `fetchEnrollmentOverview()` và `fetchStageDwellMetrics()`.
- Kiểm tra trang ACA, Overview, `/api/enrollment`, Export theo tài khoản manager và agent. Dữ liệu trong danh sách/tổng/Export phải bằng query đếm cùng scope; không còn `EnrollmentListTruncatedError`.

### 2. Các luồng đầy đủ còn lại (P1)

- Provider List/API/Export: hợp nhất cách đọc live Provider; kiểm Export toàn bộ và Export ID chọn riêng.
- Task cron: phân trang từng tập cần quét; thử dữ liệu >1.000 ở một trạng thái, xác nhận mỗi Task chỉ được xét một lần và marker/notification idempotent.
- Health/P&C Registration: dùng cùng helper cho SSR và GET API, giữ nguyên lọc theo quyền. Kiểm 1.001 dòng, thứ tự và dữ liệu ở trang sau.
- Task fallback và Enrollment comment GET legacy: phân trang hoặc giới hạn rõ theo API contract; test đường fallback thực sự được gọi.

### 3. Rà toàn repo và chuyển luồng lớn sang server (P2)

- Duyệt mọi `.select()`/`.rpc().select()` trả danh sách trong `src/app` và `src/lib`. Với từng call site, ghi rõ: **single / bounded-by-business / full-set / paged / count-only**, phạm vi filter, khả năng đầu ra >500, và cách xử lý thiếu dòng. Bổ sung các call site chưa có trong bảng trên vào checklist thực thi, không kết thúc audit khi còn full-set unpaged.
- Kiểm tra đặc biệt notification summary fallback, truy vấn `.in(ids)` ở enrich, `time-off` team/year totals, account/role manager, provider collaboration và các bảng option/config. Total table count >1.000 chỉ là tín hiệu điều tra; phải xét cardinality sau filter.
- Đã thay scan cap 1.000 của Task Search bằng RPC có scope ở DB. Giữ giới hạn 6 kết quả/nhóm và đặt `truncated` khi có kết quả hợp quyền thứ 7; rollout SQL phải chạy trước code.
- Thêm static check hoặc checklist review để query full-set mới buộc khai báo phân trang/giới hạn nghiệp vụ. Không cấm các query đọc một dòng hay count-only.

### 4. Kiểm chứng và rollout

- Chạy test mục tiêu từng module, typecheck, lint và build. Không chạy test ghi trên DB production; dữ liệu test dùng mock/fixture hoặc môi trường cô lập.
- Trên staging, so tập ID, count, sort/filter, Export, notification và cron ở các mốc 999/1000/1001/>1500. Đo p95, số REST request mỗi page/refetch và kích thước payload; đặt ngưỡng rollback nếu vượt ngân sách hiệu năng đã đo trước deploy.
- Deploy P0 trước, kiểm tra ACA ngay bằng quyền see-all và scope hẹp; sau đó P1/P2 theo đợt. Theo dõi Vercel runtime `EnrollmentListTruncatedError`, API 503, Supabase `206` ở request **không** phân trang, và số dòng trả về thực tế. HTTP 206 ở request phân trang có chủ ý không tự nó là lỗi.
- Đo lại broadcast refetch: 5.021/7.683 lượt tải ACA trong log Vercel là `reason=broadcast` (~65%). Sau khi sửa tính đúng, gộp/giãn refetch theo plan Enrollment ngày 09/11 và xác nhận không làm stale dữ liệu ngoài nhịp chấp nhận được.

## Tiêu chí hoàn thành

- Không còn đường đọc **cần toàn bộ tập** mà dừng ở 1.000 dòng hoặc `.limit(5000)` nhưng thực nhận 1.000; mọi giới hạn có chủ ý đều được trả qua `total`/`hasMore`/`truncated` đúng contract.
- ACA >1.000 vào được trang, Overview và Export đầy đủ theo từng scope; các chức năng đã phân trang tiếp tục đúng.
- Cron không bỏ sót hay gửi trùng khi một tập trạng thái vượt 1.000; search không bỏ kết quả hợp quyền chỉ vì ứng viên nằm sau mốc 1.000.
- Có log/metric cho lỗi thiếu dòng, thời gian tải và số request để phát hiện khi dữ liệu tăng tiếp.

## Ghi chú điều tra

- Đếm read-only ngày 12/11: ACA 1.060, Medicare 109, Task chưa archive 660, Lead chưa archive 647, Provider live 461, Provider backlog 14, Health/P&C Registration mỗi bảng 2, portal_account active 46. Bảng comment/activity toàn hệ thống đã trên 1.000, nhưng query theo từng hồ sơ có thể nhỏ hơn.
- Ba file `supabase/rollouts/*` đang untracked trước khi lập plan; không chỉnh sửa hoặc thêm chúng vào commit.
- Nguồn về trần Supabase: https://supabase.com/docs/reference/javascript/v1/select ; về `range()` và thứ tự: https://supabase.com/docs/reference/javascript/using-modifiers-range .
