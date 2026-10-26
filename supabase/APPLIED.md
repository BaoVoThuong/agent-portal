# Nhật ký áp dụng lên production

Ghi lại **thứ tự thật** các migration đã chạy lên database production, để sau này
dựng lại hoặc điều tra sự cố còn lần được dấu vết.

Ba thư mục, ba vai trò khác nhau:

| Thư mục | Vai trò | Chạy lại được? |
|---|---|---|
| `schema.sql` | Bản dựng database MỚI từ đầu | Chỉ cho DB trống — xem cảnh báo cuối trang |
| `rollouts/` | Lịch sử migration, đặt tên theo ngày | Có, đều idempotent — **trừ hai ngoại lệ dưới đây** |
| `checks/` | Công cụ kiểm tra, chỉ đọc | Có, chạy bất cứ lúc nào |

---

## 2026-10-25 — Comments + Activity + thông báo @mention cho Provider List

Đã chạy `rollouts/2026-10-25-provider-comments-activity.sql` trên Portal production (local dùng chung DB) để test tính năng trước khi deploy. Chạy thử trong transaction rollback trước (tạo đủ 5 bảng, sau rollback không còn bảng nào), rồi chạy thật kèm `notify pgrst, 'reload schema'`. Kiểm sau khi chạy: 5 bảng (`provider_comments`, `provider_comment_edits`, `provider_comment_reactions`, `provider_activity`, `provider_notifications`) đều bật RLS; 5 RPC chỉ `service_role` gọi được (`anon`/`authenticated` không). Chỉ thêm mới, không đụng bảng cũ; code đang chạy trên production không dùng tới. Không nằm trong `schema.sql` vì chính `provider_directory` cũng chỉ có trong rollout.

---

## 2026-10-24 — Bảng upload intent cho luồng đính kèm 50 MB

Đã chạy `rollouts/2026-10-22-attachment-upload-intents.sql` trên Portal production (local dùng chung DB) khi test nhánh `dev/attachment-50mb-rebuild`: thiếu bảng làm mọi lượt xin link upload trả 500 ("Could not find the table 'public.attachment_upload_intents'"). Chạy thử trong transaction rollback trước, rồi chạy thật và `notify pgrst, 'reload schema'`. Kiểm sau khi chạy: bảng có 3 index, RLS bật, chỉ `service_role` đọc/ghi (`authenticated`/`anon` không có quyền). Code `main` không dùng bảng này.

Cùng lúc, bucket `task-attachments` đang 4 MiB nên mọi lượt xin link vẫn lỗi "Attachment storage is not configured for 50MB uploads" (code 50 MB cố ý không tự sửa bucket). Đã đặt qua Storage API `updateBucket`: `fileSizeLimit` 52428800, giữ nguyên danh sách MIME (đã đủ). **Lưu ý khi deploy:** code `main` (4 MiB) tự hạ bucket về 4 MiB ở lượt upload đầu của mỗi instance mới, nên phải đặt lại 50 MiB ngay sau khi bản 50 MB lên production và các instance cũ đã thay hết.

---

## 2026-10-21 — Giới hạn đính kèm nguyên tử cho Task và Lead

Đã chạy `rollouts/2026-10-21-attachment-limits-atomic.sql` trên EPS Portal production trước khi deploy luồng upload 50 MB. RPC Task khóa task rồi kiểm 50 file / 250 MB ngay trước insert; RPC Lead mới khóa lead rồi kiểm 50 file. Đã thử hai giới hạn trong một transaction rollback trên production: file Task thứ sáu 50 MB và file Lead thứ 51 đều bị từ chối. Không còn dòng thử sau rollback; chỉ `service_role` gọi được RPC Lead.

---

## 2026-10-19 — Xóa Role nguyên tử

Đã chạy `rollouts/2026-10-18-delete-role-atomic.sql` trên Portal production bằng Supabase CLI trước khi deploy API mới. Migration chỉ tạo RPC `delete_role_atomic`, không chuyển account hoặc sửa Role/permission. Kiểm sau khi chạy: RPC tồn tại, chỉ `service_role` được execute; 49 account, 47 active và 49 dòng `user_roles` như trước. RPC đã được thử trên Postgres tạm với chuyển Role hợp lệ, chặn vượt trần quyền và rollback khi DELETE thất bại.

---

## 2026-08-16 — đợt vá lớn

Chạy theo đúng thứ tự dưới đây. Cột "Vì sao" ghi lại lý do, vì vài file sửa
những lỗi rất khó tìm lại nếu quên mất bối cảnh.

| # | File | Vì sao |
|---|---|---|
| 1 | `rollouts/2026-08-16-fix-write-context.sql` | `table_config_write_context` thiếu hẳn trong DB (commit `ae2ca0d` thêm hàm mà không viết rollout) → **mọi thao tác tạo/sửa task và enrollment trả 503**. Bản đầu tiên cài lên còn dính lỗi thứ hai: thân hàm gọi `jsonb_object_length()` — hàm này **không tồn tại trong PostgreSQL**. plpgsql không phân giải thân hàm lúc CREATE nên nó "cài thành công" rồi lỗi `42883` ở mọi lần gọi. File này là bản đã vá. |
| 2 | `rollouts/2026-08-15-agent-membership-invariants.sql` | `create_agent_membership_atomic` |
| 3 | `rollouts/2026-08-15-table-config-reorder-rpc.sql` | `reorder_table_columns_atomic` |
| 4 | `rollouts/2026-08-15-sla-versioned-mutations.sql` | `save_/delete_task_sla_rule_atomic` |
| 5 | `rollouts/2026-08-15-reminder-partial-update.sql` | `update_task_reminder_setting_atomic` |
| 6 | `rollouts/2026-08-15-config-option-usage.sql` | 2 GIN index + 2 hàm đếm usage. **Phải tách file**: nó trộn `CREATE INDEX CONCURRENTLY` với `create function`, mà Supabase Studio bọc mọi lệnh trong transaction nên `CONCURRENTLY` sẽ lỗi. Bảng nhỏ (431/667 dòng) nên bỏ `CONCURRENTLY` là xong. |
| 7 | `rollouts/2026-08-15-table-config-option-label-unique.sql` | Unique index nhãn dropdown. Bỏ `CONCURRENTLY`, lý do như trên. |
| 8 | `rollouts/2026-08-15-task-category-active-guard.sql` | Trigger chặn gán category đã tắt |
| 9 | `rollouts/2026-08-13-aca-person-stage-timing.sql` | Riêng `enrollment_stage_cycles_attributed_idx` |
| 10 | `rollouts/2026-08-15-enrollment-stage-setup.sql` | Chuẩn hoá catalog stage ACA (12) + Medicare (11). **Không lùi được.** Bản gốc dùng `create temporary table ... on commit drop` ở cấp cao nhất rồi tham chiếu ở câu sau — Studio không giữ được temp table giữa các câu lệnh, báo `42P01`. Đã gói lại thành một khối `DO` duy nhất. Cũng thêm bước đưa `stage_id` về NULL cho record trỏ vào stage sắp bị archive. |
| 11 | `rollouts/2026-08-13-aca-overview-schema.sql` | Phần backfill. Bản gốc viết `update ... from lateral (... where activity.record_id = records.id)` — PostgreSQL **không** đưa bảng đích của UPDATE vào phạm vi LATERAL, nên câu đó luôn lỗi `42P10` và backfill này **chưa bao giờ chạy được**. Đã đổi sang gom nhóm rồi join. |
| 12 | `rollouts/2026-08-09-enrollment-stage-time-backfill.sql` | Dựng `enrollment_stage_cycles` từ lịch sử. Cũng chưa từng chạy trước đó. |
| 13 | `rollouts/2026-08-16-merge-terminal-semantics.sql` | Gộp ngữ nghĩa terminal: `is_terminal` là chuẩn duy nhất, `treat_as_terminal` bị bỏ và luôn `false`. |
| 14 | `rollouts/2026-08-16-reshape-sample-data.sql` | Tạo hình lại dữ liệu mẫu để bộ lọc và dashboard có ý nghĩa. |
| 15 | `rollouts/2026-08-16-fix-overdue-events.sql` | **Vá gấp.** Xem mục dưới. |

### Vì sao cần file 15

`task_overdue_events_open_idx` là unique trên `(task_id)` khi `resolved_at is null`.
`mark_task_overdue_atomic` chặn bằng `tasks.overdue_flagged_at is null`, tức nó
**ngầm giả định** một bất biến không ai viết ra:

> `tasks.overdue_flagged_at is null` ⟺ task đó không còn sự kiện quá hạn nào đang mở

Không có gì bảo vệ cặp này. File 14 đưa `overdue_flagged_at` về null mà không đụng
`task_overdue_events` → 60 task lệch (59 mẫu + 1 thật) → cron nhắc việc chết vì
trùng khoá **mỗi 15 phút suốt 6 tiếng**.

Khó tìm vì hai lớp che: route không có try/catch nên Next trả 500 **body rỗng**, còn
workflow dùng `curl --fail` nên Actions chỉ hiện `exit code 22`. Cả hai đã sửa
(`33eb4de`, `b677327`).

File 15 làm hai việc: đóng các sự kiện mồ côi, và thêm
`on conflict (task_id) where resolved_at is null do nothing` để RPC thật sự
idempotent — trước đó nó chỉ idempotent ở bước UPDATE.

---

## 2026-10-03 → 2026-10-04 — Lead Management go-live

User báo đã chạy hết ngày 2026-10-04 (thứ tự thật không ghi lại). Hai file đầu
phải chạy SAU khi deploy code `e775c79` — code cũ đọc cột `leads.product` mà
file 1 xoá.

| # | File | Vì sao |
|---|---|---|
| 1 | `rollouts/2026-10-03-lead-remove-product-event-pools.sql` | Bỏ Product; pool chia + cờ auto-assign theo từng Event (`lead_event_assignment_*`); ngưỡng cảnh báo còn một dòng |
| 2 | `rollouts/2026-10-03-lead-personal-agent-integrity.sql` | Personal lead (không Event) luôn có Agent đang hoạt động: constraint + trigger, chặn gỡ Agent / tắt tài khoản còn giữ Personal lead |
| 3 | `rollouts/2026-10-03-lead-retire-tag-column.sql` | Archive cột Tag trong Table Config (tuỳ chọn; code đã ẩn sẵn) |
| 4 | `rollouts/2026-10-03-sheet-sync-timeout.sql` | `service_role` statement_timeout 120s + `notify pgrst, 'reload config'` — `finalize_sheet_sync` 17k dòng bị cắt ở ~8s (57014) |
| 5 | `rollouts/2026-10-04-reset-leads-sample-data.sql` | ⛔ Xoá toàn bộ lead mẫu trước khi nhập thật — **KHÔNG chạy lại**, xem mục dưới |
| 6 | `rollouts/2026-10-04-lead-statuses-new-set.sql` | Bộ status mới (New, Need to call back, Can't contact, Called but no response, Do not contact, Quoted, Closed/Purchased); đổi tên status cũ để giữ id |

---

## ⛔ Hai ngoại lệ KHÔNG idempotent

`rollouts/2026-08-17-reset-cs-for-golive.sql` — reset dữ liệu Customer Service
trước go-live. **Chạy đúng một lần.**

`rollouts/2026-10-04-reset-leads-sample-data.sql` — xoá mọi lead + event trước
khi nhập lead thật. **Đã chạy, đừng chạy lại**: có chốt chặn (bảng
`_bk_20261004_*` tồn tại, hoặc hơn 150 lead thì dừng), nhưng đừng dựa vào đó.
Xoá các bảng `_bk_20261004_*` khi không cần tra cứu nữa (lệnh ở cuối file).

Mọi file khác trong `rollouts/` chạy lại đều vô hại. File CS thì không: chạy lần
hai sẽ xoá dữ liệu thật phát sinh sau go-live, và khối kiểm tra vẫn báo ✅ vì nó
chỉ khẳng định `tasks = 0` — đúng y kết quả của một lần chạy nhầm.

Đã cài chốt chặn ở đầu file: thấy bảng `_bk_20260817_*` là dừng ngay. Nhưng
đừng dựa vào đó — hãy đọc file trước khi chạy.

Trước khi chạy nhớ **tắt workflow "Task reminders cron"**, bật lại sau khi xong.

---

## Công cụ kiểm tra — `checks/`

Chỉ đọc, chạy lại bao nhiêu lần cũng được. Trả về **bảng** chứ không dùng
`RAISE NOTICE`, vì Supabase Studio không hiển thị notice (chỉ báo
"Success. No rows returned" và nuốt luôn báo cáo).

| File | Kiểm gì |
|---|---|
| `checks/full-state.sql` | 11 mục: terminal semantics, số lượng stage, stage mồ côi, backfill, QC trên stage kết thúc |
| `checks/sample-data-report.sql` | Phân bố dữ liệu mẫu — ràng buộc + độ "phẳng" |
| `checks/stage-time-backfill.sql` | Bất biến của `enrollment_stage_cycles` |

---

## ⚠️ Đừng chạy nguyên `schema.sql` lên production

Nó là bản dựng DB mới, **không phải công cụ migration**. Có khoảng 8 câu ghi đè
cấu hình admin đã chỉnh tay:

- `delete from role_permissions` cho role Admin/Agent (`:283`)
- `delete from dashboard_filter_defaults` (`:468`)
- 4 câu `update table_column set pinned/required/show_in_detail` (`:5394+`)
- `update enrollment_records set caller_email = null, ...` cho Medicare (`:4342`)

Và một bẫy thứ tự: nếu chạy **trước** file stage-setup, khối seed stage sẽ chèn
stage mới với UUID mới, chặn toàn bộ bước đổi tên, khiến **399/667 record trỏ vào
stage đã archive** — mà khối tự kiểm của stage-setup vẫn báo pass.

Cần đồng bộ thì chạy từng rollout, hoặc chạy `schema.sql` **sau** stage-setup và
bọc `--single-transaction`.
