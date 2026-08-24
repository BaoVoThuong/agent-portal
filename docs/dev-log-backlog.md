# Agent Portal Dev Log Backlog

Danh sách này được đối chiếu với `origin/main` và chỉ chứa các commit chưa xuất hiện trong bất kỳ ngày nào ở [`docs/dev-log.md`](./dev-log.md).

## Cách dùng

- Khi chọn commit để viết báo cáo, đọc diff và gom các commit cùng mục tiêu thành một task.
- Thêm task vào đầu ngày báo cáo trong `docs/dev-log.md`.
- **Bắt buộc:** commit nào đã được dùng trong report thì xoá khỏi bảng `Implementation backlog` ngay trong cùng lượt sửa; backlog tuyệt đối không giữ lại commit đã report.
- Không dùng ngày commit làm ngày report. Ngày report là ngày quản lý muốn ghi nhận công việc.
- Commit chỉ tạo tài liệu/kế hoạch không cần report như một tính năng riêng; chúng được giữ ở mục cuối để tra cứu.

Trước khi hoàn tất một lượt report, kiểm tra nhanh:

```sh
rg -o '[0-9a-f]{7,40}' docs/dev-log.md | sort -u
rg -o '[0-9a-f]{7,40}' docs/dev-log-backlog.md | sort -u
```

Hai danh sách không được có cùng hash implementation.

## Implementation backlog

| Commit | Nội dung nên gom khi report | Ngày report |
| --- | --- | --- |
| `9bb5069` | Giữ nền cột Kanban ổn định trên toàn bộ lane | Chưa gán |
| `f524688`, `ffb8c2b`, `03ec9bd` | Hoàn thiện trải nghiệm board: rút ngắn notification chime, giữ không gian cho Comments, chuẩn hóa UI text | Chưa gán |
| `c6d3955` | Bổ sung staging cho Sheet Data Sync và sửa finalize dữ liệu | Chưa gán |
| `bc27874` | Sửa role dropdown trong Account Management khi mở modal | Chưa gán |
| `308be82` | Live-sync Task Board/List và toàn bộ Task Detail | Chưa gán |
| `3593e51` | Đồng bộ UI Task Detail giữa Enrollment và CS | Chưa gán |
| `fb9d03b` | Đồng bộ live-sync Enrollment theo cơ chế CS | Chưa gán |
| `b004ac9` | Đóng các finding review về quyền truy cập, assign, dữ liệu xoá và dedupe scope lookup | Chưa gán |
| `26430c8` | Đồng bộ flow loading Enrollment và CS: parallel initial load, single-flight refetch, tránh request chồng nhau | Chưa gán |
| `a1418b7` | Tối ưu comment/attachment cho CS và Enrollment: phản hồi gửi sớm, side effect chạy nền, batch signing và sửa realtime reaction giữa nhiều account | Chưa gán |

## Documentation-only commits

Các commit này chưa được dùng trong report, nhưng không cần tạo task riêng nếu chỉ thay đổi tài liệu:

| Commit | Nội dung | Trạng thái |
| --- | --- | --- |
| `1918032` | Implementation plans cho Task Attachments, Enrollment Attachments và Enrollment Drawer | Không report riêng |
| `b5f027e` | Hướng dẫn viết daily dev log | Không report riêng |
| `e87f3e7` | Kế hoạch review live-sync | Không report riêng |
| `0a43daa` | Quy trình daily dev log | Không report riêng |
| `64659bb` | Commit ghi báo cáo polling cost optimizations | Không report riêng |

## Nguồn đối chiếu

- Remote được đối chiếu: `origin/main`
- Snapshot hiện tại: `a1418b7`
- Khoảng commit rà soát: từ `18/08/2026` đến snapshot hiện tại
