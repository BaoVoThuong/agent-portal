# [Agent Portal Dev Log] — 23/08/2026

> Ngày trong tiêu đề là ngày báo cáo. Công việc được thực hiện trước ngày báo cáo; vì vậy các commit hoàn tất trong ngày 22/08 được ghi vào báo cáo ngày 23/08.

### 1. Tối ưu giao diện Enrollment Overview

- Thu gọn các scorecard tổng quan để giảm khoảng trống và giúp người dùng nhìn được nhiều chỉ số hơn ngay khi mở trang.
- Làm dropdown Attention threshold thành custom dropdown có trạng thái chọn, hover, nút check và đóng bằng click bên ngoài hoặc phím Escape.
- Cải thiện bố cục bảng Overview: tên cột rõ hơn, có đường phân cách dọc và Pipeline by stage vừa trong trang mà không cần kéo ngang.
- Đồng bộ cơ chế cuộn và khung hiển thị của Enrollment Overview với CS.

Commit: `961bcdc`

Verification: typecheck, lint, production build và git diff check đã pass.

### 2. Làm nhẹ và làm rõ giao diện ngày tháng cho CS và Enrollment

- Bỏ kiểu chữ đậm không cần thiết ở các field kiểu date để Due Date cân bằng với các property khác.
- Đồng bộ style cho Enrollment detail, form tạo mới, custom date field và các vị trí date trong CS detail/list/form.
- Đổi hướng dẫn định dạng ngày sang `month/day/year` ở label và placeholder của các form, giúp người dùng dễ hiểu hơn.
- Giữ native calendar picker để vẫn chọn ngày nhanh bằng lịch; không thay đổi dữ liệu lưu trữ hay validation.
- Giữ nguyên trạng thái chỉnh sửa, validation và màu cảnh báo; chỉ điều chỉnh font weight và màu chữ cho dễ đọc hơn.

Commits: `9b584ba`, `1c5c487`

Verification: 108 test files / 759 tests, typecheck và lint đã pass.

### 3. Chuẩn hóa key hiển thị và tách bộ đếm Enrollment

- Đổi key hiển thị của Customer Service từ `TASK-*` sang `CS-*`.
- Đổi key Enrollment theo chương trình: ACA dùng `ACA-*`, Medicare dùng `MED-*`.
- Tách sequence database theo từng program để số mới của ACA và Medicare không dùng chung bộ đếm.
- Giữ nguyên số hiện có khi migrate để tránh làm hỏng các key đã được tham chiếu; chỉ đổi prefix và dùng counter riêng cho record mới.
- Đồng bộ prefix trong list, detail drawer, search/sort, export và notification bell.

Commit: `8796298`

Migration cần chạy trên Supabase: `supabase/rollouts/2026-08-23-enrollment-program-display-keys.sql`

Verification: 108 test files / 759 tests, typecheck và lint đã pass.

### 4. Giữ Enrollment ở List sau khi tạo record

- Sau khi bấm Create, Enrollment chỉ thêm record mới vào danh sách và đóng form tạo, giống hành vi của CS.
- Bỏ việc tự mở Task Detail và tự thêm `record` vào URL sau khi tạo, tránh drawer xuất hiện lại ngoài ý muốn.
- Dọn fallback state chỉ phục vụ cho luồng auto-open cũ; live-sync/refetch vẫn cập nhật danh sách bình thường.

Commit: `1f36069`

### 5. Đồng bộ quyền hiển thị Overview giữa Enrollment và CS

- Ẩn tab Overview khỏi Enrollment đối với agent/assistant không có quyền manager, giống cách CS đang hiển thị.
- Chặn cả luồng gọi API Overview trực tiếp đối với non-manager để không còn trường hợp thấy tab rồi bấm vào mới nhận lỗi quyền.
- Giữ Enrollment client và component Overview fail-closed nếu bị render ngoài lớp kiểm tra quyền.

Commit: `e35369d`

### 6. Đồng bộ quyền hiển thị task cho người tạo

- Enrollment scoped agents/assistants luôn thấy record do chính mình tạo, hoặc record mình là caller/responsible; deep link và detail cũng dùng cùng scope này.
- CS creator luôn thấy task mình tạo trong board/list, search, detail, comments, attachments, edit history và reactions mà không được mở rộng quyền đổi stage hoặc xóa task.
- Giữ drawer Enrollment đang mở sau khi tạo record trong thời gian live-sync/refetch chưa trả về snapshot mới.

Commits: `cabe4d9`, `6ec65a3`

### 7. Thông báo khi có người react comment

- Khi reaction mới được thêm, chỉ tác giả comment nhận notification; người react không tự nhận notification.
- Áp dụng đồng nhất cho CS và Enrollment, có chống gửi lặp khi thao tác reaction được retry.
- Bổ sung schema rollout và hiển thị loại notification `reacted` trên notification bell.

Commit: `6b63f9f`

### 8. Đồng bộ trải nghiệm cộng tác của Enrollment với CS

- Bổ sung đầy đủ luồng comment, mention, attachment, emoji và reaction cho Enrollment Task Detail theo cùng cơ chế với CS.
- Đồng bộ cache, prefetch, realtime và cơ chế invalidation để mở task và cập nhật comment nhanh, ổn định hơn.
- Chuẩn hóa quyền truy cập, preview file và xử lý concurrency cho upload, delete và reaction.

Commit: `fcdb658`

### 9. Cho phép cộng tác trên task Backlog

- Bỏ chặn comment/reaction đối với task đang ở Backlog; thành viên trong team có thể tiếp tục trao đổi như các stage khác.
- Cập nhật kiểm tra quyền và test để tránh trả về `Unauthorized` khi gửi comment trên Backlog.

Commit: `faf7160`

### 10. Gộp comments và reactions vào pipeline Task Detail

- Tải comments và reactions trong cùng request detail, loại bỏ request reaction riêng trong luồng bình thường.
- Giữ fallback cho snapshot cũ hoặc dữ liệu thiếu, đồng thời áp dụng cho cả CS và Enrollment.
- Bổ sung benchmark để so sánh merged flow với split flow và xác nhận giảm thời gian mở comment.

Commit: `268f90e`

Verification: Benchmark merged flow cho CS khoảng 180–184ms p50 so với split flow khoảng 345ms; Enrollment khoảng 332ms so với 506ms. Typecheck, lint và 107 test files / 750 tests đã pass.

### 11. Giảm chi phí polling và request nền

- Notification bell chuyển sang polling summary, dừng request khi tab bị ẩn và giãn chu kỳ lên 120 giây khi realtime hoạt động; full notification chỉ tải khi cần.
- Task board chỉ reconcile dữ liệu task trong polling thường; categories dùng realtime topic riêng nên không còn bị reload theo mọi task event.
- Giảm RBAC lookup lặp bằng TTL 5 phút trong JWT và lazy-load dummy bcrypt hash để giảm chi phí xử lý lúc khởi động.

Commit: `6f32194`

Verification: Typecheck, lint, production build và toàn bộ 107 test files / 751 tests đã pass.

Verification bổ sung cho các task mới: toàn bộ 107 test files / 755 tests, typecheck, lint và production build đã pass.

### 12. Đồng bộ Enrollment Overview với giao diện CS — Version 1

- Đưa Enrollment Overview về cùng dashboard shell với CS: cùng max-width, khoảng cách, nền, KPI strip và section card.
- Đổi tên scorecard theo ngữ nghĩa enrollment rõ ràng hơn như `Open enrollments`, `Unassigned owner`, `Median time to completion` và `Average open enrollments per owner`.
- Bổ sung các mô tả ngắn cho từng chỉ số để phân biệt phạm vi cohort, terminal stage, owner và thời gian đo.
- Sửa optimistic update để scorecard Unassigned và các dòng People cập nhật ngay sau khi assign/unassign.
- Tránh request ACA Overview thứ hai sau lần load đầu tiên nếu người dùng chưa tự đổi threshold.

Commit: `d450e48`

Verification: 2 test files / 12 tests, typecheck, lint và git diff check đã pass.

# [Agent Portal Dev Log] — 21/08/2026

> Ngày này gồm phần tài liệu còn thiếu của ngày 20/08 và các task đã hoàn tất trước ngày 22/08.

### 1. Hoàn thiện tài liệu và kế hoạch xử lý live-sync

- Bổ sung hướng dẫn chuẩn bị daily dev log: cách kiểm tra commit, gom nhóm task, ghi verification và phân biệt implementation với documentation.
- Ghi nhận kế hoạch review các vấn đề live-sync còn tồn tại như request amplification, notification batch repair và dead code; đây là tài liệu kế hoạch, không phải phần implementation mới.

Commits: `b5f027e`, `e87f3e7`

### 2. Nâng cấp reaction cho comment trong CS

- Bổ sung reaction theo từng emoji cho comment, hỗ trợ thêm/bỏ reaction và hiển thị tổng số người đã react.
- Dùng API và RPC atomic, chống trùng reaction theo user/emoji, chuẩn hóa email và tách realtime reaction khỏi notification/activity.
- Cập nhật cache và serialize mutation để UI phản hồi ngay nhưng không bị race khi thao tác liên tiếp.

Commit: `dee4c64`

### 3. Bổ sung emoji picker có tìm kiếm cho reaction và comment composer

- Thêm picker searchable, nhóm category và bộ emoji Unicode RGI được sinh từ dữ liệu chuẩn.
- Server validate bằng exact Set, normalize variation selector và dùng chung dữ liệu giữa picker, reaction API và comment composer.
- Tách picker thành chunk động và bổ sung test cho search, dữ liệu generated và validation.

Commit: `743855a`

### 4. Chống xung đột khi cập nhật assignee

- Serialize các mutation assignee để nhiều thao tác liên tiếp không ghi đè optimistic state hoặc response mới bằng dữ liệu cũ.
- Đồng bộ cách xử lý giữa board và API, giữ refetch cần thiết sau mutation và ghi lại nguyên nhân trong bug report.

Commit: `13e8e12`

# Cách ghi task mới

- Khi task đã hoàn tất, thêm entry vào đầu ngày báo cáo tương ứng trong file này.
- Gom các commit cùng một mục tiêu vào một task; đặt hash commit ngay sau phần mô tả.
- Không cần ghi ngày commit trong từng task; chỉ cần đặt commit hash để tra cứu khi cần.
- Chỉ ghi `Verification` khi đã có test, build hoặc benchmark thật sự chạy thành công.

Mẫu nhanh:

```md
### [Tên task]

- [Kết quả chính]
- [Kết quả chính thứ hai]

Commit: `[hash]`
Verification: [Nếu có bằng chứng]
```
