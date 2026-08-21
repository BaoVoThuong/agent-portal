# [Agent Portal Dev Log] — 23/08/2026

> Ngày trong tiêu đề là ngày báo cáo. Công việc được thực hiện trước ngày báo cáo; vì vậy các commit hoàn tất trong ngày 22/08 được ghi vào báo cáo ngày 23/08.

### 1. Đồng bộ trải nghiệm cộng tác của Enrollment với CS

- Bổ sung đầy đủ luồng comment, mention, attachment, emoji và reaction cho Enrollment Task Detail theo cùng cơ chế với CS.
- Đồng bộ cache, prefetch, realtime và cơ chế invalidation để mở task và cập nhật comment nhanh, ổn định hơn.
- Chuẩn hóa quyền truy cập, preview file và xử lý concurrency cho upload, delete và reaction.

Commit: `fcdb658`

### 2. Cho phép cộng tác trên task Backlog

- Bỏ chặn comment/reaction đối với task đang ở Backlog; thành viên trong team có thể tiếp tục trao đổi như các stage khác.
- Cập nhật kiểm tra quyền và test để tránh trả về `Unauthorized` khi gửi comment trên Backlog.

Commit: `faf7160`

### 3. Gộp comments và reactions vào pipeline Task Detail

- Tải comments và reactions trong cùng request detail, loại bỏ request reaction riêng trong luồng bình thường.
- Giữ fallback cho snapshot cũ hoặc dữ liệu thiếu, đồng thời áp dụng cho cả CS và Enrollment.
- Bổ sung benchmark để so sánh merged flow với split flow và xác nhận giảm thời gian mở comment.

Commit: `268f90e`

Verification: Benchmark merged flow cho CS khoảng 180–184ms p50 so với split flow khoảng 345ms; Enrollment khoảng 332ms so với 506ms. Typecheck, lint và 107 test files / 750 tests đã pass.

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
