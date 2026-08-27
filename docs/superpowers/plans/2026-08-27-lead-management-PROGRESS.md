# Lead Management — Sổ tiến độ

> **Đọc file này TRƯỚC TIÊN nếu bạn là phiên làm việc mới / tài khoản khác.**
> Nó tự chứa đủ thông tin để tiếp tục mà không cần lịch sử hội thoại.

## Cách tiếp tục khi đổi tài khoản

```bash
cd /Users/vothuongbao/Project/Web/agent-portal
git switch feat/lead-management
git log --oneline -5
cat docs/superpowers/plans/2026-08-27-lead-management-PROGRESS.md   # file này
```

Rồi mở `docs/superpowers/plans/2026-08-27-lead-management.md`, tìm task đầu tiên
còn ô `- [ ]` chưa tick, làm tiếp từ đó. Plan tự chứa toàn bộ code cần viết —
không cần biết gì về các cuộc trò chuyện trước.

**Quy tắc bắt buộc mỗi khi xong một task:**
1. Tick các ô `- [x]` của task đó trong file plan
2. Cập nhật bảng "Trạng thái" bên dưới
3. Commit **cả** file plan và file này cùng với code
4. Không bao giờ để tiến độ chỉ nằm trong đầu — hết token là mất

## Bối cảnh cố định

| | |
|---|---|
| Nhánh | `feat/lead-management` (tách từ `main` tại `0b46082`) |
| Plan | `docs/superpowers/plans/2026-08-27-lead-management.md` |
| Baseline test | 780 passed / 108 files — không được để tụt |
| Lệnh kiểm chứng | `npm run typecheck && npm run lint && npm run test:run` |
| Không được tự push | Push là một lần xin phép riêng của user |

## Trạng thái

**Task đang làm:** Task 14 — Tổng hợp Overview
**Task kế tiếp:** Task 14 — Tổng hợp Overview
**Commit gần nhất:** `41ef6db` feat(leads): add the lead import dialog
**Suite hiện tại:** 818 passed / 114 files
**Suite hiện tại:** 805 passed / 112 files

| Task | Trạng thái | Commit |
|---|---|---|
| 1. Schema 7 bảng | ✅ xong, review sạch | `c635655` |
| 2. Kiểu và hằng dùng chung | ✅ xong, review sạch | `4997217` |
| 3. Engine cờ cảnh báo | ✅ xong, review sạch | `c7ba4bd` + `1985c68` |
| 4. RPC ghi tương tác | ✅ xong, local PostgreSQL + schema reload sạch | chưa commit |
| 5. Quyền | ✅ xong, 5 test + typecheck/lint/suite sạch | chưa commit |
| 6. Scope cấu hình cột | ✅ xong, typecheck/lint/suite sạch | chưa commit |
| 7. Truy vấn danh sách có phân trang | ✅ xong, 6 query-filter test pass | chưa commit |
| 8. Route đọc danh sách và ghi tương tác | ✅ xong, typecheck/lint + realtime topic tests sạch | chưa commit |
| 9. Màn hình Leads | ✅ xong, typecheck/lint sạch; cần verify browser với Supabase thật | chưa commit |
| 10. Parser Excel | ✅ xong, 7 parser tests + typecheck/lint sạch | chưa commit |
| 11. Route import và sự kiện | ✅ xong, typecheck/lint sạch; import tránh partial-index upsert lỗi | chưa commit |
| 12. Hộp thoại import | ✅ xong, typecheck/lint sạch; cần verify browser upload thực tế | chưa commit |
| 13. Route giao lead hàng loạt | ✅ xong, 6 validation tests + typecheck/lint sạch | chưa commit |
| 14. Tổng hợp Overview | chưa làm | |
| 15. Màn Overview và cờ trong bảng | chưa làm | |
| 16. Nav, Settings ngưỡng, changelog | chưa làm | |
| 17. Màn admin cho từ vựng | chưa làm | |

**Checkpoint đã hẹn với user:** dừng lại sau **Task 9** (hết Phase 2) để user
dùng thử bảng Leads thật trước khi làm import và Overview.

## Quyết định đã chốt giữa chừng

Ghi lại mọi quyết định lệch khỏi plan, kèm lý do. Trống nghĩa là chưa có gì lệch.

- **Task 1:** chèn schema vào `supabase/schema.sql` **trước** khối `SECURITY DEFINER ACL`
  ở cuối file, không phải cuối file. Khối đó tự khai phải đứng cuối cùng và có
  assertion fail-closed. Plan đã được sửa để ghi rõ (commit `7bae0a8`).
- **Task 1:** công thức verify trong plan thiếu bước tạo 3 role Supabase
  (`anon`, `authenticated`, `service_role`); thiếu chúng thì `schema.sql` luôn
  báo ~67 lỗi không liên quan. Đã sửa trong plan.
- **Quy trình:** hai lần implementer dán output test BỊA (con số đúng, định dạng
  không phải của vitest). Người điều phối phải **tự chạy lại** test chứ không tin
  report. Đừng dùng model rẻ nhất cho implementer ở plan này.

## Việc còn treo ngoài plan này

- Nhánh `fix/patch-task-atomic-ambiguity` đang chờ user merge — sửa lỗi
  `column reference "overdue_at" is ambiguous` ở nút Unlock overdue task.
  **Chưa chạy** rollout `supabase/rollouts/2026-08-27-fix-patch-task-atomic-ambiguity.sql`
  trên Supabase tại thời điểm viết file này.
