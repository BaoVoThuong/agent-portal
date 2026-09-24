# Phân tích: CS nhận thông báo task assigned trễ

Ngày kiểm tra: 2026-09-24  
Phạm vi: thông báo khi một task được assign cho CS trong EPS Portal, kể cả khi người nhận đang mở portal.

## Kết luận

Không có cơ chế nào chủ động chờ 15–20 phút trước khi ghi notification của một lần assign task. Notification được ghi vào `task_notifications` ngay trong request assign, trước khi request trả về.

Tuy nhiên, frontend có một lỗ hổng fallback có thể trực tiếp gây ra triệu chứng “đang mở portal nhưng không thấy thông báo cho đến muộn”:

1. Browser nhận được realtime ping thì tải đầy đủ notification và hiện toast/chuông.
2. Nếu realtime ping bị lỡ hoặc broadcast server thất bại, polling nền chỉ gọi API `mode=summary`.
3. API summary chỉ cập nhật badge số notification chưa đọc; nó không tải item mới, không hiện toast, không phát chuông và không tạo native notification.
4. Vì vậy CS có thể thấy badge đổi nhưng không có thông báo chủ động. Item/toast chỉ xuất hiện khi có một lần tải đầy đủ khác, ví dụ bấm chuông, mở lại trang, hoặc nhận một realtime ping sau đó.

Đây là lỗi về độ tin cậy của delivery trên client. Chưa thể khẳng định mỗi incident 15–20 phút đều do realtime lỗi nếu chưa đối chiếu log production, nhưng code hiện tại không có đường fallback đầy đủ khi realtime bị mất tín hiệu.

## Luồng hiện tại và bằng chứng

### 1. Assign ghi notification ngay trong request

Các route assign gọi `insertNotifications(...)` trong luồng mutation:

- `src/app/api/tasks/[id]/assignees/route.ts`
- `src/app/api/tasks/[id]/assign/route.ts`
- `src/app/api/tasks/[id]/route.ts`

Trong `src/lib/tasks/notifications.ts`, `insertNotifications` thực hiện theo thứ tự:

1. insert vào bảng `task_notifications`;
2. gửi Supabase Broadcast tới topic của người nhận;
3. schedule web-push (nếu người dùng đã subscribe).

Do đó, với notification loại `assigned`, độ trễ 15–20 phút không xuất phát từ một queue/scheduler dành cho việc ghi notification.

### 2. Broadcast không có retry bền vững

`src/lib/tasks/realtime.ts` gửi Broadcast tối đa hai lần, timeout 1.5 giây mỗi lần. Nếu cả hai lần thất bại, hàm trả `false`; mutation assign vẫn được giữ thành công vì notification đã được insert vào DB.

Đây là hành vi hợp lý để không làm fail thao tác assign, nhưng cần có fallback client đủ mạnh. Hiện fallback đó chưa đầy đủ.

### 3. Polling nền chỉ cập nhật badge

Trong `src/app/(authed)/_components/NotificationBell.tsx`:

- `load()` gọi `/api/tasks/notifications`, lấy danh sách notification đầy đủ và mới có thể tạo toast/chime/native popup.
- `loadSummary()` gọi `/api/tasks/notifications?mode=summary`, chỉ cập nhật `unread` và topic realtime.
- Sau lần khởi tạo đầu tiên, interval polling gọi `loadSummary()` mỗi 120 giây khi realtime channel có trạng thái `SUBSCRIBED`, hoặc mỗi 30 giây khi không có realtime.
- Khi tab trở lại visible nhưng bell đang đóng, code cũng chỉ gọi `loadSummary()`.

Trạng thái `SUBSCRIBED` chỉ cho biết browser đã subscribe được WebSocket channel; nó không chứng minh server broadcast vừa tới được browser. Nếu ping bị mất trong khi socket vẫn được coi là subscribed, UI sẽ đi theo interval 120 giây nhưng không bao giờ tạo cảnh báo chủ động cho notification mới.

### 4. Web Push không che được trường hợp portal đang focus

`public/sw.js` không hiện OS notification khi đang có cửa sổ portal focus, để tránh trùng với in-app toast. Điều này có nghĩa người dùng đang mở EPS Portal chủ yếu phụ thuộc vào realtime + in-app toast.

Ngoài ra, web push là opt-in, không phải tất cả CS đều có subscription. Vì thế không thể coi push là fallback bảo đảm cho notification assign.

## Vì sao người dùng có thể cảm nhận trễ 15–20 phút

Không có timer 15–20 phút cho notification `assigned`. Khả năng phù hợp với code là:

- realtime broadcast bị thất bại hoặc browser bỏ lỡ ping;
- badge có thể đã cập nhật qua polling, nhưng không có popup/toast/chuông;
- người dùng chỉ nhận ra notification ở lần `load()` đầy đủ tiếp theo do thao tác khác hoặc một broadcast sau đó.

Repository cũng có cron chạy mỗi 15 phút ở `.github/workflows/task-reminders.yml`, nhưng cron này dành cho nhắc việc theo thời gian/overdue, không phải assign notification. Nếu mốc trễ luôn gần đúng 15 phút, cần kiểm tra `type` của record để chắc rằng CS đang nói về notification `assigned`, không phải reminder.

## Cách xác nhận ở production

Với một task được phản ánh, đối chiếu theo `task_id`, recipient và timestamp:

1. Thời điểm activity assign được tạo.
2. Thời điểm record `task_notifications` loại `assigned` được insert.
3. Log API/server có dòng broadcast failure hoặc timeout.
4. Network/console browser của người nhận: trạng thái subscription, event `new`, và request full `/api/tasks/notifications`.
5. Thời điểm toast thực sự xuất hiện theo ảnh/video hoặc telemetry client.

Diễn giải:

- Nếu bước 1 và 2 sát nhau, backend assignment không bị chậm.
- Nếu bước 2 sát với bước 1 nhưng bước 4 không có full load/event, lỗi nằm ở delivery realtime/fallback client.
- Nếu record có `type` reminder thay vì `assigned`, cần điều tra cron/reminder flow riêng.

Nên thực hiện một bài test hai tài khoản: tài khoản A assign, tài khoản B mở Portal và không mở notification bell; ghi lại timestamp DB, broadcast, badge, toast và OS push trong cả trường hợp socket ổn định lẫn khi reconnect.

## Hướng xử lý đề xuất (chưa implement)

1. Khi summary polling phát hiện unread mới tăng, gọi `load()` đầy đủ một lần thay vì chỉ cập nhật badge. Cách này giữ chi phí polling thấp nhưng vẫn tạo toast/chime cho notification mới khi realtime bị lỡ.
2. Tách “socket đã subscribe” khỏi “realtime còn khỏe”: theo dõi thời điểm full load/realtime signal gần nhất và chuyển sang full-fetch fallback nếu quá ngưỡng.
3. Thêm telemetry cho các mốc: DB insert, broadcast success/failure, client event nhận được, full fetch và toast hiển thị.
4. Với broadcast thất bại, cân nhắc outbox/retry bền vững ở server nếu mức độ quan trọng của notification yêu cầu đảm bảo cao hơn.

## Regression tests nên có

1. Realtime ping bị mất nhưng unread summary tăng: client phải full-load và hiện đúng một toast.
2. Channel vẫn `SUBSCRIBED` nhưng không nhận event `new`: fallback vẫn phát hiện và nạp notification mới.
3. Broadcast thành công: notification assign hiển thị trong vài giây, không tạo alert trùng.
4. Summary polling rồi realtime event tới: không phát âm/toast lặp cho cùng notification.

## Phạm vi thay đổi của lần kiểm tra

Lần này chỉ phân tích và lập báo cáo; chưa thay đổi logic runtime của notification.
