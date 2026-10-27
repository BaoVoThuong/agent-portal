# Audit Vercel logs và plan sửa lỗi, giảm tải

Ngày: 2026-10-17. Phạm vi: project Vercel `agent-portal-vercel`, production `eps-portal.vercel.app`. Chỉ đọc log và code; chưa đổi Vercel, database hay quyền của người dùng.

## 1. Dữ liệu đã kiểm tra

- Vercel CLI 64.5.0 qua `npx vercel@latest`, phiên `baovothuong`; project local đã link.
- Runtime log production và HTTP request log trong **72 giờ**, kết thúc khoảng **2026-10-17 10:40 UTC**. Build log của deployment production mới nhất.
- Deployment mới nhất: `6d2fafa`, tạo **10:34 UTC**, `READY`, alias `eps-portal.vercel.app`. Build hoàn tất trong khoảng 32 giây.
- Từ lúc bản này nhận traffic đến 10:39 UTC chỉ có **32 request**, chủ yếu sign-in/static assets; **chưa có request Tasks đã đăng nhập**. Vì thế “không có lỗi ở bản mới” chưa phải bằng chứng Task Board đã hết lỗi.

| Nhóm log | Số lượng | Diễn giải |
| --- | ---: | --- |
| Runtime `error` | 174 | 120 deprecation `url.parse()`, 44 `TaskScopeTooLargeError`, 6 dòng Auth.js cho 3 lần `CredentialsSignin`, 4 dòng side effect/realtime. |
| Runtime `warn` | 5 | 2 optimistic conflict, 1 phản ứng Enrollment tải hụt, 1 notification broadcast thất bại, 1 notification bị loại vì access scope. |
| HTTP 5xx | 6 | 5 × 503 và 1 × 500, đều là `GET /api/tasks` trên deployment cũ `0f5e0bc`, trong ngày 15/10. |
| HTTP 4xx | 25 | 18 × 409 conflict, 6 × 404 (4 yêu cầu Apple icon, 2 CSS chunk), 1 × 400. |
| Build bản mới | Thành công | Có npm warning `cache-dir` và `allowScripts`; không có lỗi compile. |

Lưu ý: Vercel trả `level:warn` trong log thật dù help gợi ý `warning`; truy vấn `level:warning` trả rỗng. Các số trên dùng `level:warn`.

## 2. Kết luận theo mức ưu tiên

### P0 — Xác nhận fix TaskScope trên bản đang chạy

44 lần `TaskScopeTooLargeError` có cùng nguyên nhân: code cũ đưa khoảng 155 task ID vào query filter dài 6.246 byte. 39 lần thuộc deployment `0f5e0bc`, 5 lần thuộc `695c35a`; lần cuối **2026-10-16 13:38 UTC**, ngay sau lúc chuyển deployment. Cùng code cũ, `GET /api/tasks` có nhánh trả 503 `TASK_SCOPE_TOO_LARGE`; **5 HTTP 503 rất có thể thuộc nhánh này**, nhưng request logs không chứa response body để đối chiếu từng request.

Fix SQL đã có trong `supabase/rollouts/2026-10-16-tasks-visible-to-worker.sql`; code `eef54d5` chuyển `fetchTasksForActor` sang RPC `tasks_visible_to_worker`. Bản production từ `29c1b7d` trở đi không còn log `TaskScopeTooLargeError` hoặc HTTP 5xx trong cửa sổ đã tra. **Vẫn phải smoke test bằng account Agent/Assistant thật** sau bản `6d2fafa`; 32 request hiện tại chưa đủ.

Việc cần làm:

1. Dùng một account Agent và một Assistant có lịch sử task lớn để mở `/tasks`, làm mới board, mở task cũ và export. Xác nhận task nhìn thấy đúng như trước, không hiện `TASK_SCOPE_TOO_LARGE`, không có 500/503.
2. Kiểm tra read-only rằng RPC `tasks_visible_to_worker` tồn tại và chỉ `service_role` được execute; không chạy lại migration mù.
3. So Vercel `GET /api/tasks` và `/tasks` 5xx trong 24 giờ sau smoke test. Nếu tái xuất hiện, dùng deployment ID, request ID và lỗi RPC cụ thể để xử lý.

### P1 — Một HTTP 500 trên Task API chưa có nguyên nhân

Một `GET /api/tasks` trả 500 lúc **2026-10-15 18:52 UTC** trên deployment cũ. Truy vấn runtime theo request ID không có dòng tương ứng. Route bắt exception và trả message ra HTTP nhưng **không ghi structured error log**; hiện không thể kết luận DB, auth hay enrichment hỏng. Không gán nó cho `TaskScopeTooLargeError` vì lỗi đó trả 503.

Fix đề xuất: ở catch của `GET /api/tasks`, ghi **một** log có `route`, `stage`, mã lỗi PostgREST nếu có, HTTP status và request ID/trace ID khả dụng. Không log email, ID task, request body, token hoặc nội dung khách hàng. Giữ nguyên HTTP response và quyền hiện tại. Thêm test xác nhận lỗi 500 có log an toàn, lỗi 503 vẫn phân loại đúng. Có thể áp dụng cùng mẫu cho các endpoint đọc có catch im lặng nếu log sau này chỉ ra nhu cầu.

### P1 — Broadcast Realtime chậm gây cảnh báo thông báo

Ngày 14/10 có **2 lần** broadcast thất bại sau 2 lần thử, mỗi lần timeout 1.500 ms. Một comment đã commit và ghi `notification_failed`; code `insertNotifications` ghi notification vào DB **trước** broadcast, rồi trả `false` khi broadcast hỏng. Vì thế tên warning hiện tại dễ bị hiểu là notification DB không được lưu, dù bằng chứng log chỉ cho thấy đường phát realtime thất bại. Một `task.update.delivery_failed` cũng cùng thời điểm. Đây là sự cố side effect ở deployment cũ, **chưa thấy lặp lại ở bản mới**.

Fix nhỏ: tách trạng thái “ghi notification thất bại” và “broadcast/push thất bại” trong log và warning; chỉ báo mất thông báo khi insert thực sự thất bại. Giữ nguyên response mutation thành công sau khi dữ liệu đã commit; giữ client reconciliation/poll fallback. Nếu timeout lặp lại với tần suất đáng kể mới xem xét hàng đợi bền hoặc nâng timeout dựa trên latency thực tế, tránh tự tăng thời gian giữ function.

### P2 — Tải request tập trung ở Task Board; đo trước khi tối ưu

Mẫu **10.000 request production mới nhất** của truy vấn 24 giờ bị chạm giới hạn CLI, chỉ phủ từ **2026-10-16 20:04 đến 2026-10-17 10:35 UTC**. Có **8.488 request trong 20:00–21:59 UTC** ngày 16/10. Trong mẫu:

| Đường | Request | Quan sát từ code |
| --- | ---: | --- |
| `GET /api/tasks/notifications` | 2.974 | Bell có poll 120 s khi realtime live, 30 s khi fallback; Task Board cũng gọi summary sau mỗi lần nạp list. Request log không hiện query string nên chưa tách được full/summary. |
| `GET /api/tasks` | 2.156 | Nạp lại toàn bộ list; Board reconcile 60 s khi live, 15 s khi degraded, cộng realtime/focus/mutation. |
| `GET /api/tasks/[id]/detail` | 1.512 | Drawer cũng có vòng reconcile và focus refresh. |
| `GET /api/admin/task-sla-rules` | 720 | Board gọi lúc mount, lúc subscription báo `SUBSCRIBED`, lúc focus và khi config đổi; hai nguồn đầu có thể tạo request trùng. |

Đây là **số request, chưa phải số người dùng hay latency**. Không suy ra có bug vòng lặp chỉ từ tổng số; nhiều tab/người cùng mở có thể tạo spike. Mẫu là dữ liệu của các deployment trước bản mới.

Plan tối ưu theo thứ tự:

1. **Đo baseline trên một phiên đăng nhập có kiểm soát:** Network tab ghi số request/phút, bytes, `Server-Timing` p50/p95 cho list, detail, notification summary. Ghi trạng thái Realtime live/degraded và số tab. Vercel CLI request log không cho đủ breakdown latency; các route đã có header `Server-Timing`. Không bật `ROUTE_PERF_LOGS=1` toàn production trước khi cần, vì sẽ tăng log rất nhiều.
2. **Bỏ request SLA rules bootstrap trùng:** giữ fetch ban đầu ngay cả khi Realtime không kết nối; `SUBSCRIBED` không phát thêm fetch nếu một bản mới vừa nạp. Event `changed` thật phải luôn lấy bản mới. Test mount/offline/reconnect/config-changed và xác nhận một fetch lúc mount bình thường.
3. **Dùng chung notification summary trong cùng tab:** Bell và Task Board cùng tiêu thụ một kết quả/cơ chế in-flight, thay vì hai fetch độc lập; giữ nguyên unread count, unread-assigned IDs, cursor `latestAt`, toast, và fallback polling. Test thông báo mới đến, đọc ở tab khác, Realtime mất kết nối, mở lại tab. Mục tiêu đo được: số summary request trong workflow cố định giảm, không bỏ lỡ thông báo.
4. **Chỉ tối ưu full task list nếu baseline chỉ ra nó là bottleneck:** trước tiên xác định trigger trùng và response size; giữ nguyên scope SQL và lớp `canViewTask`. Nếu cần delta/cursor/ETag, viết parity test cho Agent, Assistant, CS, `task.manage`, archive và assignment; không giảm tần suất làm mới bằng phỏng đoán.
5. **Task search là audit riêng:** `src/lib/tasks/search.ts` vẫn tải lịch sử `task_assignees`/`task_participants` vào Node; helper hiện không phân trang. Đây là rủi ro kết quả thiếu khi lịch sử vượt giới hạn PostgREST, **không phải lỗi được chứng minh bởi Vercel log lần này**. So search với task board trên account lịch sử lớn trước khi đổi SQL.

### P3 — Dọn log và asset warning sau khi xác định nguồn

- 120 dòng `DEP0169 url.parse()` bị Vercel xếp `error`, nhưng chưa thấy quan hệ với HTTP 5xx. Dùng `--trace-deprecation` trong môi trường local/preview để tìm package gọi `url.parse`, rồi cập nhật đúng dependency; không tắt warning toàn cục.
- Build warning `npm cache-dir` và `allowScripts` không chặn build. Xác định nguồn cấu hình npm trong Vercel trước khi sửa; ưu tiên thấp.
- 18 × 409 là optimistic conflict cần xem UX khi tái diễn trên cùng thao tác, không tự coi là lỗi server. 4 Apple icon 404 là browser tự hỏi; 2 CSS chunk 404 chỉ một thời điểm, theo dõi nếu lặp lại sau deploy. Một cảnh báo Enrollment reaction snapshot và một notification bị scope lọc cần đối chiếu khi có repro; không nới scope chỉ để loại warning.

## 3. Kiểm chứng và phát hành

1. Chốt baseline request/latency cho cùng một workflow trước sửa. Chọn account thử của từng phạm vi: Admin/`task.manage`, Agent, Assistant, CS. Ghi tập task thấy được, quyền sửa, notification unread/toast và kết quả search/export.
2. Làm P1 observability và P2 tối ưu thành các commit tách biệt; unit test đúng đường lỗi, race và reconnect. Build/typecheck/lint và test Task/Notification/Realtime liên quan.
3. Deploy preview, chạy lại workflow và so quyền, task IDs, notification, response shape/status **giống production hiện tại**. Không tự thay đổi role, access hoặc dữ liệu production.
4. Sau khi phát hành được duyệt, theo dõi log production 24–72 giờ: 5xx theo route/deployment, warning delivery, số request/phút, p50/p95 `Server-Timing`, và báo cáo hiệu quả so baseline. Nếu cải tiến gây miss notification hay task visibility thì revert phần đó.

## 4. Lệnh tái kiểm tra nhanh

```bash
npx vercel@latest list --environment production --limit 30 --json
npx vercel@latest logs runtime --environment production --since 24h --query 'level:error OR level:fatal' --json
npx vercel@latest logs runtime --environment production --since 24h --query 'level:warn' --json
npx vercel@latest logs requests --environment production --since 24h --query 'httpStatus >= 500' --json
npx vercel@latest inspect <deployment-url> --logs
```

Các lệnh trên là read-only. Khi đếm traffic lớn, phân trang bằng `summary.pagination.next`; một page bị chặn ở 10.000 record nên không được gọi nó là “toàn bộ 24 giờ”.
