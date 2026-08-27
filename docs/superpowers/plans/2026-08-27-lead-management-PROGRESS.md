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

**Task đang làm:** — hoàn tất Task 17
**Task kế tiếp:** —
**Commit gần nhất:** `c070839` feat(leads): add navigation, alert settings, and changelog
**Suite hiện tại:** 830 passed / 116 files (sau full verification ghi lại số cuối)

| Task | Trạng thái | Commit |
|---|---|---|
| 1. Schema 7 bảng | ✅ xong, review sạch | `c635655` |
| 2. Kiểu và hằng dùng chung | ✅ xong, review sạch | `4997217` |
| 3. Engine cờ cảnh báo | ✅ xong, review sạch | `c7ba4bd` + `1985c68` |
| 4. RPC ghi tương tác | ✅ xong, local PostgreSQL + schema reload sạch | `f6c680e` |
| 5. Quyền | ✅ xong, 5 test + typecheck/lint/suite sạch | `af787c2` |
| 6. Scope cấu hình cột | ✅ xong, typecheck/lint/suite sạch | `a30eafc` |
| 7. Truy vấn danh sách có phân trang | ✅ xong, 6 query-filter test pass | `fceb8c0` |
| 8. Route đọc danh sách và ghi tương tác | ✅ xong, typecheck/lint + realtime topic tests sạch | `f6cdbd7` |
| 9. Màn hình Leads | ✅ xong, typecheck/lint sạch; cần verify browser với Supabase thật | `03c5dcf` |
| 10. Parser Excel | ✅ xong, 7 parser tests + typecheck/lint sạch | `2f72199` |
| 11. Route import và sự kiện | ✅ xong, typecheck/lint sạch; import tránh partial-index upsert lỗi | `9a47ba1` |
| 12. Hộp thoại import | ✅ xong, typecheck/lint sạch; cần verify browser upload thực tế | `41ef6db` |
| 13. Route giao lead hàng loạt | ✅ xong, 6 validation tests + typecheck/lint sạch | `3705f0e` |
| 14. Tổng hợp Overview | ✅ xong, 5 summary tests + typecheck/lint sạch | `839ab11` |
| 15. Màn Overview và cờ trong bảng | ✅ xong, typecheck/lint sạch; cần verify browser | `d2c6dba` |
| 16. Nav, Settings ngưỡng, changelog | ✅ xong, typecheck/lint sạch | `c070839` |
| 17. Màn admin cho từ vựng | ✅ xong, 7 validator tests + typecheck/lint sạch; cần full verification | chưa commit |

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
