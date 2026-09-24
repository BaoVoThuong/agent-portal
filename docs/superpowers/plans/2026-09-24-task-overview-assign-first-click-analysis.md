# Phân tích: nút Assign ở CS Workload Overview cần bấm lần hai

## Phạm vi kiểm tra

Tài liệu này phân tích nút `Assign` trong panel gợi ý CS của **CS Workload
Overview** (`/tasks`, tab Overview). Đây là luồng có CTA ghi đúng là `Assign`,
khác với dropdown đa assignee trong Task detail và các ô owner của Enrollment.

## Kết luận

Click đầu tiên không bị mất ở trình duyệt. Nó có thể đã gọi API nhưng bị server
từ chối bằng `409 Conflict` vì snapshot Overview giữ `updatedAt` cũ. Client
sau đó hoàn tác optimistic UI và tải lại snapshot, nhưng không tự gửi lại cùng
ý định assign. Khi người dùng bấm lại, snapshot đã có timestamp mới nên request
thứ hai thành công.

## Chuỗi nguyên nhân

1. `UnassignedTaskRow` truyền `task.updatedAt` từ snapshot vào
   `assignOverviewTask`.
   - `src/app/(authed)/tasks/_components/CSWorkloadOverview.tsx`
   - `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`

2. Client gửi giá trị đó thành `expectedUpdatedAt` tới
   `POST /api/tasks/:id/assign`.

3. Route chuyển nó thành `p_expected_updated_at` của RPC
   `assign_unassigned_task`.
   - `src/app/api/tasks/[id]/assign/route.ts`

4. RPC khóa row, nhưng **trước khi** kiểm tra điều kiện thực sự cần thiết cho
   claim (task vẫn `backlog`, không có `assignee_email`, không có row trong
   `task_assignees`), nó cũng từ chối bất cứ timestamp nào khác snapshot.
   - `supabase/schema.sql`, hàm `assign_unassigned_task`

5. `updated_at` thay đổi khi có hoạt động hợp lệ không liên quan trực tiếp tới
   việc claim: comment, attachment, edit, status/assignment khác. Ví dụ,
   `create_task_comment_atomic` cập nhật cả `tasks.updated_at` và
   `last_activity_at`.
   - `supabase/schema.sql`, phần `create_task_comment_atomic`

6. Khi route nhận `409`, `assignOverviewTask` chỉ restore snapshot rồi gọi
   `loadOverview(true)`. Nó không retry intent vừa chọn. Snapshot mới có
   `updatedAt` mới, nên bấm `Assign` lần hai sẽ qua timestamp guard.

## Vì sao đây là false conflict

RPC đã dùng `SELECT ... FOR UPDATE`, sau đó kiểm tra atomically rằng task vẫn
chưa được assign. Hai điều kiện này mới bảo vệ claim cạnh tranh thực sự: nếu
người khác đã nhận task, request sẽ vẫn thất bại sau khi lock row.

So sánh toàn bộ `updated_at` là rộng hơn yêu cầu của hành động Assign. Một
comment hay attachment có thể làm timestamp cũ nhưng không làm task mất trạng
thái unassigned; chặn hành động trong trường hợp đó không tăng an toàn, chỉ bắt
người dùng bấm thêm lần nữa.

## Hướng sửa đề xuất

Giữ nguyên row lock và ba điều kiện canonical của task unassigned, nhưng bỏ
timestamp precondition khỏi **riêng** RPC claim của Overview (có thể tiếp tục
giữ tham số để tương thích API, nhưng truyền `NULL`/không dùng nó). Sau đó:

- Task vẫn Backlog + chưa có assignee: assign thành công ngay cả khi snapshot
  chỉ cũ vì hoạt động không liên quan.
- Task đã được người khác nhận: vẫn trả `409`, refresh Overview và không retry.
- Không nới lỏng optimistic concurrency cho Task detail hoặc Enrollment; các
  luồng đó ghi dữ liệu tổng quát hơn và cần đánh giá riêng.

Một phương án thay thế là client tự fetch canonical task rồi retry đúng một lần
khi task vẫn unassigned. Phương án SQL gọn và đúng boundary hơn vì điều kiện
claim vẫn được kiểm tra cùng row lock trong một transaction.

## Kiểm thử cần có khi triển khai

1. Snapshot cũ do comment/attachment, task vẫn unassigned: một click Assign
   phải thành công.
2. Hai manager cùng assign một task: chỉ một request thành công; request còn
   lại nhận `409` và Overview refresh.
3. Task đã được assign hoặc đổi khỏi Backlog trước request: không được overwrite
   và phải giữ `409`.
4. Eligible/disabled CS validation và rotation history vẫn hoạt động như cũ.

## Luồng khác đã rà soát

- Task detail multi-assignee và Enrollment cũng dùng `updated_at` để phát hiện
  stale data, rồi refresh khi `409`. Chúng có thể cho cảm giác tương tự khi
  snapshot đã cũ, nhưng không phải cùng action atomic claim và không nên bỏ CAS
  một cách blanket.
- Vấn đề được báo với CTA `Assign` của Overview khớp trực tiếp với nhánh trên;
  nên fix nên giới hạn vào endpoint/RPC `assign_unassigned_task`.

---

## Kiểm chứng (24/09/2026)

Đã soi lại từng mắt xích trong code, **cả sáu đều đúng**:

| # | Khẳng định | Chỗ xác nhận |
| --- | --- | --- |
| 1 | Row truyền `task.updatedAt` | `CSWorkloadOverview.tsx:1011` |
| 2 | Client gửi `expectedUpdatedAt` | `TaskBoardClient.tsx:1789` |
| 3 | Route chuyển thành `p_expected_updated_at` | `assign/route.ts:63` |
| 4 | RPC kiểm timestamp TRƯỚC ba điều kiện thật, cùng ném `ASSIGN_CONFLICT` | `schema.sql:3724-3733` |
| 5 | Bình luận cũng cập nhật `tasks.updated_at` | `create_task_comment_atomic` |
| 6 | Nhận 409 thì chỉ khôi phục + tải lại, không thử lại | `TaskBoardClient.tsx:1794-1802` |

Phạm vi ảnh hưởng hẹp hơn tài liệu gốc ngụ ý: `/api/tasks/[id]/assign` có **đúng
một** nơi gọi (Overview), và `assign_unassigned_task` cũng chỉ được gọi từ route
đó. Không có luồng nào khác bị động tới.

### Đo trên production

**Vế 1 — chặn oan có thật.** Một task `backlog`, chưa có `assignee_email`, chưa
có dòng `task_assignees` (tức đang nhận được):

```
created 2026-09-24T16:16:46Z
updated 2026-09-24T16:17:40Z      <- bị chạm sau 54 giây bởi việc khác
gọi RPC với timestamp cũ  ->  ASSIGN_CONFLICT
sau lượt dò: status=backlog, assignee=null, updated_at không đổi
```

54 giây là quãng quá đủ để một ảnh chụp Overview trở nên cũ.

**Vế 2 — bỏ CAS không mất an toàn.** Một task đã có người nhận:

```
timestamp ĐÚNG               ->  ASSIGN_CONFLICT
timestamp NULL (bỏ hẳn CAS)  ->  ASSIGN_CONFLICT
```

Row lock + ba điều kiện canonical mới là thứ bảo vệ thật. Hai lượt dò đều an
toàn: RPC ném lỗi trước mọi lệnh ghi, dữ liệu không đổi.

## Đã sửa — chọn khác tài liệu một điểm

Tài liệu đề xuất bỏ điều kiện timestamp **trong RPC**. Không cần: RPC đã có sẵn
`if p_expected_updated_at is not null`, nên **truyền `null` từ route là đủ**.

Đổi ở route thay vì SQL được ba thứ:

- **Không phải chạy rollout.** Sửa code là xong, lùi lại cũng chỉ là sửa code.
- **Giữ nguyên khả năng cho người gọi sau.** Ai thật sự cần CAS vẫn dùng được.
- Biên giới đúng chỗ: route là nơi quyết định hợp đồng gọi RPC.

Bỏ luôn `expectedUpdatedAt` khỏi client và khỏi thân request — gửi một giá trị
bị bỏ qua chỉ khiến người đọc sau này tưởng nó còn tác dụng.

**Chưa đụng tới:** CAS của sửa bình luận (`CommentThread`) và của Enrollment.
Đúng như tài liệu khuyến nghị — chúng ghi dữ liệu tổng quát hơn, cần đánh giá
riêng.
