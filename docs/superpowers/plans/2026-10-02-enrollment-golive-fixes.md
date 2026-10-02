# Plan — Enrollment go-live: sửa lỗi + việc vận hành

Ngày lập: 2026-10-02. Đây là **tài liệu go-live duy nhất** của Enrollment.

Plan gộp toàn bộ checklist review code buổi sáng (mục A–H, trong đó mục H do Codex bổ sung) và kịch bản kiểm tay (mục F cũ, nay ở mục 8). File checklist đã xoá. Muốn xem bản gốc thì dùng `git show f165592:docs/2026-10-02-enrollment-golive-checklist.md`; bản đó chưa có mục H của Codex.

Plan **đã đối chiếu lại từng vấn đề** với:
- code ở commit `f165592`, trùng với `vercel/main`;
- DB production. Chỉ dùng SELECT qua service key, không ghi gì.

**Phạm vi** là Health ACA, Medicare và Medicaid Enrollment. Cả ba dùng chung các file sau:

| Phần | File |
|---|---|
| Giao diện | `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` (khoảng 6.100 dòng) |
| API | `src/app/api/enrollment/**` |
| Thư viện | `src/lib/enrollment/**` |
| Cron nhắc hạn | `src/app/api/cron/check-enrollment-due/route.ts` |
| Chuông thông báo | `src/app/api/tasks/notifications/route.ts`, `src/app/(authed)/_components/NotificationBell.tsx` |

## Quy ước khi làm theo plan

- **Lệnh kiểm** (đã có trong `package.json`): `npm run typecheck`, `npm run test:run`, `npm run lint`, `npm run build`. Chạy `npm run build` trước khi push, vì Vercel cũng build.
- **Next.js 16:** dùng API nào của Next (`after()`, router…) thì đọc tài liệu trong `node_modules/next/dist/docs/` trước. Lý do ghi ở `AGENTS.md`: bản này khác Next quen thuộc.
- **Changelog:** mọi thay đổi logic ghi vào `changelog.md`, entry mới nhất trên cùng.
- **DB production:** chỉ đọc. Migration chỉ chạy trong change window có người chịu trách nhiệm (xem H3).
- **Commit:** plan này chỉ vào git cùng lượt với code hiện thực nó.
- Số dòng trong plan tính tại `f165592`. Code đổi thì tìm lại bằng đoạn code được trích.

---

## 1. Danh sách vấn đề và kết luận review

Mã vấn đề (A–H) giữ như checklist gốc. ✅ nghĩa là đã kiểm lại trên code và DB, kết luận đúng.

**A. Vận hành**

| Mã | Vấn đề | Kết luận review | Xử lý ở |
|---|---|---|---|
| A1 | Rollout `2026-09-30-enrollment-created-notifications.sql` (CHECK cho `record_created`) đã chạy trên production chưa. Chưa chạy thì tạo hồ sơ xong không ai nhận thông báo nào, vì route ghi `assigned` và `record_created` trong **một** lệnh insert | ✅ **Xong.** `aca-1327` (05:31 UTC) → 8 dòng `record_created` (9 manager trừ người tạo) | — |
| A2 | Dữ liệu bắt buộc: 171/201 hồ sơ thiếu Responsible, 178/201 thiếu Due. Nhắc hạn không tới ai; bộ lọc "Needs attention" gắn cờ gần hết | ✅ Đúng, **nặng hơn**: **44 hồ sơ không có cả Caller lẫn Responsible, 43 trong số đó là Medicare.** Medicare không có vai Caller, và 43/47 hồ sơ Medicare chưa có Assignee | 0.1; Task 3 (quá hạn luôn báo manager) |
| A3 | Ai có quyền `task.import`. Import ghi đè **bất kỳ** hồ sơ nào theo ID, không xét phạm vi, không ghi activity | ✅ | 0.2 |
| A4 | Không đổi cờ Terminal/QC của stage đang có hồ sơ trong tuần go-live | ✅ nhưng hẹp, gộp vào H6 | 0.4 |
| A5 | Báo trước cho đội về banner "Table configuration changed" và toast "Someone else changed this record…" | ✅ | 0.6 |

**B. Bug nên sửa trước go-live**

| Mã | Vấn đề | Kết luận review | Xử lý ở |
|---|---|---|---|
| B1 | Đổi stage từ ô Stage khi hồ sơ đang đóng: client gửi thiếu `reopen_reason` → server trả 400, giao diện nhảy rồi bật lại, hiện lỗi đỏ | ✅ Ô Stage ở bảng `EnrollmentClient.tsx:2707-2712`, ở drawer `:4345-4351` | Task 5 |
| B2 | Tạo hồ sơ xong không chỉ ra hồ sơ vừa tạo: có thể bị bộ lọc đã lưu che, hoặc nằm lẫn giữa danh sách. Đây là một nguyên nhân của báo cáo "mất deal" | ✅ `createRecord` `:1692-1751`, `onCreate` `:2048-2051` | Task 6 |
| B3 | Import ghi thẳng vào bảng, bỏ qua luật: không đóng hồ sơ ở stage đóng, không reset nhắc khi đổi Due, không ghi activity, không lọc hồ sơ đã archive, file lớn dễ quá thời gian | ✅ `import/route.ts:203-258` (cập nhật), `:260-265` (tạo) | Task 9a (đổi Due → nhắc theo hạn mới); phần còn lại Task 9, Phase 3 |
| B4 | Câu báo lỗi khi Archive bị 409 xúi người dùng reload; `submitReopen` luôn trả `true` nên Reopen hỏng vẫn đóng hộp lý do | ✅ `:1790-1794`, `:4148-4157` | Task 7 |
| B5 | Banner "Table configuration changed — Reload" hiện quá nhiều | ✅ **Rộng hơn mô tả cũ.** `TABLE_CONFIG_TOPIC` là **một kênh chung** cho mọi màn, có 15 chỗ phát tín hiệu. Đổi một cột của Leads, cột của Task CS, option của Enrollment hay danh sách agent/assistant **đều** bật banner ở cả 3 màn Enrollment lẫn Task CS | Task 8 |

**C. Logic thông báo và nghiệp vụ**

| Mã | Vấn đề | Kết luận review | Xử lý ở |
|---|---|---|---|
| C1 | Agent của hồ sơ không nhận thông báo Enrollment nào | ✅ | Task 12 (QĐ-6: có) |
| C2 | Nhắc quá hạn bị lỡ ngày: cron chạy mỗi ngày, nhưng chỉ nhắc khi lần trước cách ≥ 24 giờ (`check-enrollment-due/route.ts:43, 84`) | ✅ | Task 3 |
| C3 | Cron tính ngày theo UTC: 03:00 UTC là 22:00 Texas hôm trước, nên gắn quá hạn sớm khoảng 2 giờ và nhắc sắp hạn lệch một ngày | ✅ | Task 3 |
| C4 | Thông báo stage quan trọng dò theo tên. Medicaid không có stage nào khớp; ACA "12-Terminated" rơi vào nhánh QC nên không có `stage_changed` | ✅ Nâng lên P0 theo H2 | Task 10 (QĐ-3) |
| C5 | Cron ghi `updated_by_email = 'system'` và đẩy `updated_at`; không kiểm lỗi update/insert; chạy hai lần là gửi trùng | ✅ | Task 3 |
| C6 | Admin đổi cờ Terminal của stage không cập nhật `closed_at` của hồ sơ đang ở stage đó (`option-sets/[id]/route.ts:89-90`) | ✅ | Phase 3 |
| C7 | Xoá file đính kèm không ghi activity, trong khi thêm file thì có | ✅ | Phase 3 |

**D. Tải dữ liệu chưa tối ưu**

| Mã | Vấn đề | Kết luận review | Xử lý ở |
|---|---|---|---|
| D1 | Mỗi lần nạp danh sách là nạp cả program, kèm nội dung **mọi** comment và từng dòng file. Mỗi tab nạp lại toàn bộ mỗi 60 giây, mỗi lần focus, và mỗi lần **bất kỳ ai** sửa bất kỳ hồ sơ nào | ✅ | Phase 3 |
| D2 | Giới hạn 1.000 dòng của PostgREST: program nào vượt 1.000 hồ sơ thì cả trang Enrollment sập; cron đọc cả 3 program không phân trang nên cắt lặng lẽ | ✅ Hiện tổng 201 hồ sơ | Task 3 (cron); Phase 3 (danh sách) |
| D3 | PATCH chạy khoảng 8 vòng truy vấn nối tiếp | ✅ | Phase 3 |
| D4 | Drawer đang mở tự nạp lại chi tiết mỗi 60 giây (ký lại URL mọi file, đọc 250 dòng activity), kể cả khi realtime đang "live" | ✅ | Phase 3 |
| D5 | Cron `Promise.all` không giới hạn song song; `fetchAdminEmails()` gọi một lần cho mỗi hồ sơ QC-stale | ✅ | Task 3 |
| D6 | `page.tsx` gọi `fetchAssistantAgentsForCs` hai lần | ✅ | Phase 3 |

**E. Nghi vấn: chưa gây lỗi, nhưng nên biết**

| Mã | Vấn đề | Kết luận review | Xử lý ở |
|---|---|---|---|
| E1 | Tạo hồ sơ không có khoá chống trùng. Mạng rớt sau khi server đã ghi mà bấm Create lần nữa là ra hồ sơ trùng | ✅ | Phase 3 |
| E2 | PATCH kiểm "option đã archive" **trước** khi kiểm "có đổi không"; gửi lại đúng giá trị cũ mà giá trị đó đã archive thì bị 400. Carrier đã có ngoại lệ | ✅ Hiện 0 hồ sơ ở stage đã archive | Phase 3 |
| E3 | Cột hệ thống Required **nhưng** ẩn mặc định: form tạo đòi trường đó mà không hiện ô nhập, nên không tạo được hồ sơ | ✅ | Phase 3; lưu ý ở 0.1 |
| E4 | Export bỏ các cột `hidden_default`, kể cả khi người dùng đã tự bật hiện | ✅ | Phase 3 |
| E5 | Sửa/xoá comment và xoá file chỉ báo realtime cho drawer; tab khác thấy số comment/file cũ tới lần poll sau (tối đa 60 giây) | ✅ Không mất dữ liệu: PATCH tự gửi lại khi bị 409 (`6da7ee0`) | Phase 3 (D1) |
| E6 | So email phân biệt hoa/thường ở `isAgentOwnerOrAssistant` và ở bộ lọc mention | ✅ Chưa xảy ra: mọi email trong DB đều viết thường | Phase 3 |
| E7 | PATCH có `custom_values` luôn ghi `field_changed`, kể cả khi giá trị không đổi | ✅ | Phase 3 |

**H. Gate trước khi mở rộng (do Codex bổ sung)**

| Mã | Vấn đề | Kết luận review | Xử lý ở |
|---|---|---|---|
| **H1** | Thông báo không kiểm quyền xem, cả lúc ghi lẫn lúc đọc, nên lộ tên khách và nội dung comment. Thông báo cũ không bị thu hồi khi quan hệ thay đổi | ✅ **Đang xảy ra.** Route chuông đọc `client_name` và body comment mà không kiểm phạm vi (`notifications/route.ts:318-320, 341-346, 405-425`). Web Push dựng tiêu đề từ `client_name` (`src/lib/notifications/push-dispatch.ts:175-212`) | Task 1 + Task 2 (QĐ-2) |
| **H2** | "Manager" có 3 định nghĩa khác nhau: nhóm nhận thông báo (`task.manage`), nhóm xem tất cả (`buildTaskActor`), nhóm nhận QC (`portal_account.role = 'admin'`) | ✅ **Có số liệu.** 9 account có `task.manage`; 8 là manager theo `buildTaskActor`. **1 người (role "Linh Le", là agent)** chỉ xem được hồ sơ của mình nhưng **vẫn nhận `record_created` / `stage_changed` của mọi hồ sơ**. QC thì gửi cho 3 legacy admin | Task 1 (QĐ-1) |
| H3 | Chưa có manifest schema production. A1 mới kiểm một CHECK, trong khi code phụ thuộc nhiều rollout (stage-time, display key, Medicaid, multi-carrier, notification), RLS và grants | ✅ | 0.3 (bộ SQL có sẵn) |
| **H4** | Cron đặt cờ "đã báo" **trước** khi gửi, nên hồ sơ không có người nhận vẫn bị coi là đã báo. Chưa chứng minh cron chạy trên production (`CRON_SECRET`, log 401/500) | ✅ **Có số liệu.** 1 hồ sơ đã bị đánh dấu "đã báo hạn" dù không có người nhận | Task 3 + 0.5 |
| H5 | Thông báo chỉ là best-effort: lỗi bị nuốt thành `warnings`, client bỏ qua, không có outbox, retry hay đối soát | ✅ | Task 4 (tối thiểu); outbox Phase 3 |
| H6 | Đóng băng cấu hình quá hẹp: đổi required/hidden, role, agent/assistant đều ảnh hưởng ngay | ✅ | 0.4 |
| H7 | Chưa có tiêu chí go/no-go kèm bằng chứng. Test hiện có chủ yếu là unit test hàm, không gọi route, RPC, Storage hay cron thật | ✅ | 0.7 + mục 8 |

**Phát hiện mới khi review lại**

| Vấn đề | Kết luận | Xử lý ở |
|---|---|---|
| `table_column` có cột hệ thống `aca.timeProgress` ("Time Progress") mà code Enrollment không biết, nên cột không bao giờ hiện (`enrollmentColumnsForProgram`, `EnrollmentClient.tsx:582-640`, bỏ qua system key lạ) | Phần còn lại của lần làm trước: commit `3b3ea40` (11/8) thêm cột, `ffa179d` revert sau 3 phút, dòng trong DB vẫn ở lại | Task 13 (QĐ-8: làm cho cả 3 program) |

---

## 2. Quyết định trước khi code

Cập nhật 2026-10-02: đã chốt đủ 8 QĐ, kể cả hai điểm xác nhận thêm ("need approve" của Medicaid là stage "Approved"; manager nhận nhắc quá hạn mỗi ngày).

| QĐ | Câu hỏi | Trạng thái và nội dung | Chặn task |
|---|---|---|---|
| **QĐ-1** | Nhóm "manager" của Enrollment: những ai nhận `record_created`, `stage_changed`, `qc_needed`, `qc_stale` | ✅ **Đã chốt.** Dùng đúng định nghĩa "xem tất cả" của `buildTaskActor`: có `task.manage` **và** một role admin (legacy admin, "Admin", "Super Admin", "Admin Health Task" hoặc "Task Admin"). Hiện là 8 người. Hệ quả: role "Linh Le" thôi nhận thông báo kiểu manager; thông báo QC mở rộng từ 3 legacy admin lên 8 manager | 1, 3, 10 |
| **QĐ-2** | Người không được xem hồ sơ có được nhận thông báo về hồ sơ đó không | ✅ **Đã chốt: không.** Người không mở được hồ sơ thì không nhận thông báo về hồ sơ đó (lọc ở chỗ ghi, Task 1). Thông báo cũ của hồ sơ họ không còn mở được thì che tên khách và nội dung comment (lọc ở chỗ đọc, Task 2). Lý do là bảo mật, với ba ca thật: role "Linh Le" (chỉ xem hồ sơ của mình) đang đọc được tên khách của agent khác; người bị @mention dù không xem được hồ sơ thì đọc được comment; người đã bị gỡ khỏi Caller vẫn thấy thông báo cũ | 1, 2 |
| **QĐ-3** | Stage nào là "quan trọng" ở mỗi program | ✅ **Đã chốt.** ACA: 5-Ready to Enroll, 12-Terminated. Medicare: 5-Ready to Enroll, 11-Terminated (giữ như code hiện tại). **Medicaid: URGENT, Need Apply, Approved.** "need approve" mà người dùng ghi chính là stage "Approved" (đã xác nhận). Stage vừa quan trọng vừa bắt QC (ACA 12-Terminated, Medicaid Approved): manager nhận `stage_changed`, Caller/Responsible/Agent nhận `qc_needed`, mỗi người chỉ một thông báo cho một lần đổi | 10 |
| **QĐ-4** | Ai nhận thông báo hạn | ✅ **Đã chốt.** Hồ sơ **quá hạn** (lần đầu `overdue` và nhắc lại mỗi ngày `overdue_reminder`) **luôn** gửi cho **toàn bộ nhóm manager** (`task.manage`, định nghĩa ở QĐ-1), **mỗi ngày** khi hồ sơ còn quá hạn (đã xác nhận), dù hồ sơ có người phụ trách hay chưa, cộng Caller/Responsible/Agent của hồ sơ. **Sắp tới hạn** (`due_soon`) chỉ gửi Caller/Responsible/Agent; Agent là trường bắt buộc nên luôn có người nhận. Luật an toàn: không gửi được thì không đánh dấu "đã báo", để hôm sau thử lại | 3 |
| **QĐ-5** | Múi giờ và giờ chạy cron | ✅ **Đã chốt.** Múi giờ `America/Chicago`, cron chạy **13:00 UTC** (08:00 CDT / 07:00 CST / 20:00 giờ Việt Nam) | 3 |
| **QĐ-6** | Agent có nhận thông báo Enrollment không (C1) | ✅ **Đã chốt: có.** Agent của hồ sơ nhận như Caller/Responsible (bảng người nhận ở Task 12). Agent sẽ nhận nhiều thông báo hơn, nên nên ra cùng tính năng admin tắt chuông/popup | 12, 3 |
| **QĐ-7** | Import trước go-live | ✅ **Đã chốt: Import làm sau go-live** (Task 9, Phase 3). Riêng việc "Import đổi Due date thì nhắc theo hạn mới" làm ngay (Task 9a, khoảng 30 phút). Sửa Due **trên màn hình** đã nhắc theo hạn mới từ trước. Trong lúc chờ: không dùng Import để đổi Stage (mục 0.6) | 9a |
| **QĐ-8** | Cột "Time Progress" | ✅ **Đã chốt: cả 3 program đều có**, hiện thời gian ở stage hiện tại cho từng hồ sơ (Task 13) | 13 |

---

## 3. Phase 0 — Vận hành (không code, làm song song với Phase 1)

### 0.1 A2 — Dữ liệu bắt buộc

Owner: vận hành. Đếm theo từng program:

```sql
select program,
  count(*) as active,
  count(*) filter (where responsible_enroll_email is null) as no_responsible,
  count(*) filter (where caller_email is null and responsible_enroll_email is null) as no_owner,
  count(*) filter (where due_date is null) as no_due
from enrollment_records
where archived_at is null
group by program
order by program;
```

Cần chốt: bổ sung dữ liệu trước ngày go-live, hay bật Required cho Responsible/Due trong /config. Nếu bật Required thì cột đó **không được ẩn mặc định**. Lý do (E3): form tạo đòi trường bắt buộc nhưng không hiện ô nhập, nên không ai tạo được hồ sơ.

### 0.2 A3 — Ai đang có quyền Import

```sql
select pa.email, r.name as role
from role_permissions rp
join roles r on r.id = rp.role_id and r.is_active
join user_roles ur on ur.role_id = r.id
join portal_account pa on pa.id = ur.user_id and pa.is_active
where rp.permission_key = 'task.import'
order by pa.email;
```

Chỉ giữ quyền này cho quản lý.

### 0.3 H3 — Preflight schema production (chỉ SELECT)

Chạy trong Supabase SQL Editor, lưu kết quả kèm bản release. Không có câu nào ghi dữ liệu.

```sql
-- #1 Bảng và RLS: mọi dòng phải có rls_enabled = true
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and (c.relname like 'enrollment\_%'
       or c.relname in ('table_column', 'table_column_option',
                        'notification_preferences', 'push_subscriptions'))
order by 1;

-- #2 Cột mà code đọc trên enrollment_records: mọi dòng phải có present = true
select required.column_name, (c.column_name is not null) as present
from unnest(array[
  'display_number','program','carrier_id','carrier_ids','custom_values','description',
  'stage_entered_at','stage_entered_source','last_activity_at','last_activity_by_email',
  'last_work_activity_at','responsible_assigned_at','qc_stale_notified_at',
  'due_soon_notified_at','overdue_notified_at','overdue_reminded_at','closed_at','archived_at'
]) as required(column_name)
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = 'enrollment_records'
 and c.column_name = required.column_name
order by 1;

-- #3 RPC và quyền EXECUTE: anon/authenticated phải là false, service_role phải là true
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'create_enrollment_atomic','patch_enrollment_atomic','archive_enrollment_atomic',
  'enrollment_touch_activity','create_enrollment_comment_idempotent',
  'edit_enrollment_comment_atomic','delete_enrollment_comment_atomic',
  'enrollment_comment_reactions_for_record','set_enrollment_comment_reaction_atomic',
  'enrollment_option_usage_count','enrollment_option_usage_counts','table_config_write_context')
order by 1, 2;

-- #4 Trigger. Phải có đủ 4 trigger, tgenabled = 'O':
--    enrollment_records_assign_display_number_trigger, enrollment_sync_carrier_ids_trg,
--    enrollment_records_overview_timestamps, enrollment_stage_cycles_responsibility
select tgname, tgrelid::regclass as table_name, tgenabled
from pg_trigger
where not tgisinternal
  and tgrelid in ('public.enrollment_records'::regclass, 'public.enrollment_stage_cycles'::regclass)
order by 2, 1;

-- #5 Constraint: type_check phải chứa 'record_created'
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname in ('enrollment_records_carrier_ids_sync_check', 'enrollment_notifications_type_check')
order by 1;

-- #6 Display number theo program: distinct_numbers = records, missing = 0
select program, count(*) as records, count(distinct display_number) as distinct_numbers,
  max(display_number) as max_number,
  count(*) filter (where display_number is null) as missing
from enrollment_records
group by program
order by program;

-- #7 Carrier đồng bộ: phải bằng 0
select count(*) filter (where carrier_id is distinct from carrier_ids[1]) as out_of_sync
from enrollment_records;

-- #8 Option theo program: mỗi program phải có stage, ít nhất 1 stage terminal
select s.program, s.key,
  count(o.id) filter (where o.archived_at is null) as active_options,
  count(o.id) filter (where o.archived_at is null and o.is_terminal) as terminal,
  count(o.id) filter (where o.archived_at is null and o.triggers_qc) as qc
from enrollment_option_sets s
left join enrollment_options o on o.set_id = s.id
group by 1, 2
order by 1, 2;

-- #9 Cột hệ thống mà code Enrollment không biết. Hiện sẽ ra aca.timeProgress (QĐ-8)
select scope, key, label
from table_column
where archived_at is null and is_system and scope in ('aca', 'medicare', 'medicaid')
  and key not in ('key','client','agent','stage','caller','responsible','payment','carrier',
                  'aca','consent','platform','pcp2025','pcp2026','due','fub',
                  'createdBy','createdAt','updatedBy','updated','qc')
order by 1, 2;
```

Sau khi chạy: chụp hoặc lưu kết quả, kèm commit được deploy. Bất kỳ kết quả nào sai kỳ vọng là **no-go** cho tới khi xử lý xong.

### 0.4 H6 + A4 — Snapshot cấu hình và đóng băng thay đổi

- **Snapshot** (Supabase Table Editor → Export CSV) trước tuần go-live: `table_column`, `table_column_option`, `enrollment_option_sets`, `enrollment_options`, `roles`, `role_permissions`, `user_roles`, `task_agents`, `agent_members`, `enrollment_queue_members`, `enrollment_overview_settings`.
- **Đóng băng** trong tuần go-live, trừ khi có người duyệt kèm cách rollback:
  - cờ Terminal/QC của stage (A4, C6);
  - Required/hidden của cột (E3);
  - quyền của role;
  - danh sách agent/assistant (vì làm đổi phạm vi xem ngay lập tức).

  Mọi thay đổi ghi lại: ai đổi, lúc nào, giá trị cũ.

### 0.5 H4 — Chứng minh cron chạy trên production

1. Vercel → Settings → Environment Variables: có `CRON_SECRET` ở môi trường **Production**. `src/lib/cron-auth.ts` so header `authorization` với `Bearer ${CRON_SECRET}`.
2. Vercel → Cron Jobs: lần chạy gần nhất của `/api/cron/check-enrollment-due` trả 200.
3. Bằng chứng trong DB, mỗi ngày phải có dòng:

   ```sql
   select date_trunc('day', created_at) as day, type, count(*)
   from enrollment_activity
   where type in ('due_soon', 'went_overdue')
   group by 1, 2
   order by 1 desc
   limit 14;
   ```

   Ngày 2026-10-02 đã có thông báo `due_soon`/`overdue` lúc 03:00:28 UTC, tức cron đang chạy.
4. Đặt người theo dõi log 401/500 của route này trong tuần go-live.

### 0.6 A5 — Báo trước cho đội

- Gặp thông báo vàng "Table configuration changed" thì **lưu hoặc huỷ form đang mở rồi mới bấm Reload**. Câu này bỏ được sau khi xong Task 8.
- Gặp toast "Someone else changed this record…" thì **không cần reload trang**, chỉ cần làm lại thao tác vừa rồi.

Thêm một quy định tạm cho tới khi Import được sửa (Task 9, Phase 3): **không dùng Import để đổi Stage.** Nếu đổi, hồ sơ không được đóng, không có lịch sử thay đổi, và Time Progress sai. Import để thêm hồ sơ mới hoặc sửa các cột khác thì vẫn dùng được.

### 0.7 H7 — Bảng go/no-go

Mỗi program một bảng với các cột:

| Program | Kịch bản (mục 8) | Record ID | Người test | Thời gian (UTC) | Chuông/push nhận được | Kết quả | Ghi chú |

- **No-go khi:**
  - bất kỳ task P0 nào fail;
  - preflight 0.3 sai kỳ vọng;
  - không chứng minh được cron chạy (0.5).
- **Rollback code:** Vercel → Deployments → *Promote* bản trước. Hoặc `git revert` rồi `git push vercel main`.
- **Rollback DB:** mỗi rollout của plan này ghi câu đảo ngược ở đầu file.
- **Người có quyền quyết go/no-go và rollback:** ghi tên vào bảng trước ngày go-live.

---

## 4. Phase 1 — Code P0 (phải xong trước go-live)

### Task 1 — Một nhóm "manager" duy nhất + lọc người nhận theo phạm vi xem ở chỗ GHI thông báo (H1, H2)

**Bối cảnh.** Mọi route Enrollment ghi thông báo qua **một cửa** là `insertEnrollmentNotifications` (`src/lib/enrollment/notifications.ts:14-41`). Các route đó gồm tạo hồ sơ, PATCH, comment, sửa comment, file, reaction và cron. Hàm này ghi bảng `enrollment_notifications` rồi gửi Web Push, cho **bất kỳ** email nào được đưa vào:

```ts
export async function insertEnrollmentNotifications(rows: EnrollmentNotificationInsertInput[]): Promise<void> {
  const uniqueRows = uniqueEnrollmentNotificationRows(rows);
  if (uniqueRows.length === 0) return;
  const { error } = await getSupabaseAdmin().from("enrollment_notifications").insert(/* … */);
  if (error) throw new Error(error.message);
  await broadcastNotif(uniqueRows.map((row) => row.recipient_email));
  await schedulePush(/* pushForEnrollmentNotifications(uniqueRows) */);
}
```

Người nhận kiểu "quản lý" hiện lấy từ **hai nhóm khác nhau**, và cả hai đều không trùng với định nghĩa quyền xem:
- `fetchTaskManagerEmails()` (`src/lib/tasks/membership.ts:204-...`): mọi account active có RBAC `task.manage`. Hiện là 9 người.
- `fetchAdminEmails()` (`membership.ts:186-196`): `portal_account.role = 'admin'`. Hiện là 3 người, dùng cho QC.
- Quyền xem tất cả do `buildTaskActor` (`src/lib/tasks/access.ts:38-51`) quyết định:

  ```ts
  isManager: hasManage && Boolean(opts?.isAdmin),   // isAdmin = isTaskViewAdmin(user), :25-36
  isWorker: can(permissions, PERMISSIONS.TASK_WORK) || hasManage,
  ```

Worker khác manager chỉ thấy hồ sơ trong phạm vi của mình. Phạm vi được tính bởi `resolveEnrollmentScope` và kiểm bằng `isRecordInScope` (`src/lib/enrollment/scope.ts:37-109`):
- agent thấy hồ sơ của chính mình;
- assistant thấy hồ sơ của agent được giao;
- ai cũng thấy hồ sơ mình tạo, hoặc mình là Caller/Responsible;
- CS thường không phải agent/assistant thì thấy toàn bộ.

**Thay đổi**

1. **`src/lib/enrollment/scope.ts`: tách phần thuần** của `resolveEnrollmentScope`, giữ nguyên hành vi:

   ```ts
   export function buildEnrollmentScope(input: {
     actor: EnrollmentActor;
     isSelectedAgent: boolean;              // actor.email nằm trong task_agents
     assistantAgentEmails: readonly string[]; // agent_members: cs_email = actor, is_assistant
   }): EnrollmentScope {
     const { actor } = input;
     if (actor.isManager) return { seeAll: true };
     const viewerEmail = normalize(actor.email);
     if (!actor.isWorker) return { seeAll: false, agentEmails: [], viewerEmail };
     if (!input.isSelectedAgent && input.assistantAgentEmails.length === 0) return { seeAll: true };
     return {
       seeAll: false,
       viewerEmail,
       agentEmails: [...new Set(
         [...(input.isSelectedAgent ? [actor.email] : []), ...input.assistantAgentEmails]
           .map(normalize).filter(Boolean),
       )],
     };
   }
   ```

   `resolveEnrollmentScope` gọi hàm này sau khi nạp `fetchSelectedAgentEmails()` và `fetchAssistantAgentsForCs()`. Code cũ còn gọi thêm `fetchAgentsForCs()`, nhưng hàm này chạy **cùng một truy vấn** `agent_members` (`cs_email = …` và `is_assistant = true`, `membership.ts:11-19` và `:75-83`), nên chỉ cần một lần.

2. **File mới `src/lib/enrollment/recipients.ts`**:
   - `loadEnrollmentRecipientScopes(emails)` → `Map<email, EnrollmentScope | null>`:
     - Một truy vấn `portal_account`, cùng câu select với `getUserAccessByEmail` (`src/lib/rbac/access.ts:56-70`) nhưng dùng `.in("email", emails)`.
     - Mỗi dòng: `flattenAccess(row)` → `buildTaskActor(access.permissions, email, { isAdmin: isTaskViewAdmin({ role: access.legacyRole, roles: access.roles }) })`.
     - Một truy vấn `agent_members` (`cs_email in emails`, `is_assistant = true`), cộng `fetchSelectedAgentEmails()` (`src/lib/tasks/assignees.ts:42`, đã có cache).
     - Trả `null` khi account không active, hoặc `!canAccessEnrollment(actor)` (`src/lib/enrollment/access.ts:33-35`).
   - `fetchEnrollmentManagerEmails()` (QĐ-1): lấy mọi account có `task.manage` như `fetchTaskManagerEmails`, rồi giữ người có `isTaskViewAdmin({ role, roles })`.
   - `filterEnrollmentNotificationRows(rows, loaders = defaultLoaders)` → `{ kept, droppedCount }`:
     - Nạp `enrollment_records` (`id, agent_email, caller_email, responsible_enroll_email, created_by_email, archived_at`) cho các `record_id`.
     - Giữ một dòng khi `scope !== null && isRecordInScope(scope, record)`.
     - Truyền `loaders` qua tham số để test không cần DB.

3. **`insertEnrollmentNotifications`** gọi `filterEnrollmentNotificationRows` trước khi insert.
   - Nạp dữ liệu lỗi thì **dừng hẳn** (fail closed): ném lỗi để route gom vào `warnings` như hiện tại. Lý do: thà mất một thông báo còn hơn lộ dữ liệu.
   - Ghi log **số dòng bị loại**, không ghi email hay tên khách.
   - Web Push dùng `uniqueRows` sau khi đã lọc, nên H1 phía push được xử lý luôn.

4. **Đổi nguồn người nhận sang `fetchEnrollmentManagerEmails()`.** Không đụng `fetchTaskManagerEmails` của Task CS.
   - `src/app/api/enrollment/route.ts:345-391`: `record_created` và QC lúc tạo hồ sơ.
   - `src/app/api/enrollment/[id]/route.ts`: nhánh `qc_needed` (đang gọi `fetchAdminEmails()`) và nhánh `stage_changed` (đang gọi `fetchTaskManagerEmails()`), nằm trong khối `if (stageChanged)` ở `:544-600`.
   - `src/app/api/cron/check-enrollment-due/route.ts:168-172`: `qc_stale`.

**Test (vitest, hàm thuần)**
- `buildEnrollmentScope`: manager; agent; assistant; CS thường thấy toàn bộ; account không có quyền task.
- `isRecordInScope` với scope dựng từ hàm trên.
- `filterEnrollmentNotificationRows` dùng loader giả: người ngoài phạm vi bị loại, manager được giữ, account không active bị loại.

**Kiểm tay**
- Account role "Linh Le" (agent, có `task.manage`, không phải admin): người khác tạo hồ sơ cho **agent khác** → account này **không** nhận `record_created`.
- @mention một CS không có phạm vi xem hồ sơ → người đó không nhận gì.
- 8 manager vẫn nhận đủ.

**Ước lượng:** khoảng 1 ngày. **Phụ thuộc:** QĐ-1, QĐ-2.

### Task 2 — Che tên khách và nội dung của thông báo cũ ở chỗ ĐỌC (H1)

**Hiện tại**, trong `src/app/api/tasks/notifications/route.ts`:

```ts
enrollmentIds.length
  ? supabase.from("enrollment_records").select("id,client_name,display_number,program").in("id", enrollmentIds)
  : …                                                                      // :318-320
enrollmentCommentIds.length
  ? supabase.from("enrollment_comments").select("id,body").in("id", enrollmentCommentIds)
  : …                                                                      // :341-346
// :405-425: task_title = client_name, comment_body = body. Không kiểm phạm vi xem.
```

Thông báo không bị thu hồi khi quan hệ thay đổi. Ví dụ một người bị gỡ khỏi vai Caller hay khỏi danh sách assistant: họ vẫn đọc được tên khách và nội dung comment từ thông báo cũ.

**Thay đổi**
- Câu select hồ sơ thêm `agent_email, caller_email, responsible_enroll_email, created_by_email, archived_at`.
- Nếu danh sách có thông báo Enrollment thì dựng `actor` giống `loadEnrollmentActor` (`src/lib/enrollment/access.ts:108-126`):
  - `buildTaskActor(session.user.permissions, email, { isAdmin: isTaskViewAdmin(session.user) })`;
  - `scope = canAccessEnrollment(actor) ? await resolveEnrollmentScope(actor) : null`.
- Thông báo của hồ sơ **ngoài phạm vi, đã archive hoặc không còn**:
  - `task_title: null`, `comment_body: null`;
  - giữ `entity_display_number`, vì mã ACA-123 không phải dữ liệu khách;
  - thêm `entity_accessible: false`.
- **Số chưa đọc giữ nguyên**: không đổi các truy vấn đếm. `mode=summary` không đổi, vì chỉ trả số đếm.
- `NotificationBell.tsx`: khi `entity_accessible === false` thì hiện "Enrollment record (no longer accessible)" và **không** mở hồ sơ khi bấm. Bấm vào cũng chỉ hiện trống, vì `page.tsx:91-110` đã chặn bằng `isRecordInScope`.

**Test:** hàm thuần `redactEnrollmentNotification(notification, inScope)`.

**Ước lượng:** khoảng 3 giờ. **Phụ thuộc:** QĐ-2.

### Task 12 — Agent của hồ sơ nhận thông báo Enrollment (C1, QĐ-6)

**Bối cảnh.** Thông báo Enrollment hiện chỉ gửi Caller/Responsible, cộng manager/admin cho vài loại. Agent (`agent_email`, chủ hồ sơ) không có trong nhóm nhận nào. Mọi hồ sơ đều có Agent: Agent là trường bắt buộc, và production có 201/201 hồ sơ có Agent.

**Bảng người nhận sau khi sửa.** Người thực hiện thao tác luôn bị loại; một người chỉ nhận một thông báo (`uniqueEnrollmentNotificationRecipients`, `src/lib/enrollment/notifications.ts:43-57`).

| Sự kiện | Chỗ code (tại `f165592`) | Hiện tại | Sau khi sửa |
|---|---|---|---|
| Tạo hồ sơ | `api/enrollment/route.ts:353-363` | Caller/Responsible: `assigned`; manager: `record_created` | **+ Agent: `assigned`** (khi Agent khác người tạo) |
| Đổi Agent | `api/enrollment/[id]/route.ts` (chưa có) | không ai | **Agent mới: `assigned`** |
| Đổi Caller/Responsible | `[id]/route.ts:604-617` | Caller + Responsible: `assigned` | giữ nguyên |
| Mở lại hồ sơ | `[id]/route.ts:545-557` | Caller/Responsible: `reopened` | **+ Agent** |
| Vào stage bắt QC | `[id]/route.ts:558-578` | Caller/Responsible + admin: `qc_needed` | **+ Agent** (admin → manager theo Task 1) |
| Vào stage quan trọng | `[id]/route.ts:579-601` | Caller/Responsible + manager: `stage_changed` | **+ Agent** |
| Bấm QC checked | `[id]/route.ts:619-631` | Caller/Responsible: `qc_reviewed` | **+ Agent** |
| Comment | `[id]/comments/route.ts:139-146` | Caller/Responsible + người từng comment; người được @ nhận `mentioned` | **+ Agent** |
| Thêm file | `[id]/attachments/route.ts:297-300` | Caller/Responsible: `attachment_added` | **+ Agent** |
| Due soon / overdue / reminder | cron `route.ts:203-221` | Caller/Responsible | **+ Agent**; `overdue` và `overdue_reminder` luôn **+ manager** (Task 3) |
| QC stale | cron `route.ts:168-172` | Caller/Responsible + admin | **+ Agent** (admin → manager theo Task 1) |
| Reaction | `[id]/comments/[cid]/reactions` | tác giả comment | giữ nguyên |

**Thay đổi**
1. `src/lib/enrollment/notifications.ts`: thêm

   ```ts
   /** Người phụ trách hồ sơ: Caller, Responsible, Agent. Chưa bỏ trùng —
    *  uniqueEnrollmentNotificationRecipients lo việc bỏ trùng và loại người thao tác. */
   export function enrollmentRecordOwnerEmails(record: {
     caller_email: string | null;
     responsible_enroll_email: string | null;
     agent_email: string | null;
   }): (string | null)[] {
     return [record.caller_email, record.responsible_enroll_email, record.agent_email];
   }
   ```

   Dùng hàm này ở **mọi** chỗ trong bảng trên, thay cho cặp `[x.caller_email, x.responsible_enroll_email]`. Lệnh tìm: `grep -rn "caller_email, .*responsible_enroll_email\|record.caller_email," src/app/api/enrollment src/app/api/cron/check-enrollment-due`.
2. Tạo hồ sơ: `assignees: enrollmentRecordOwnerEmails(record).filter(Boolean)`. `buildCreateEnrollmentNotificationRows` (`src/lib/enrollment/create-notifications.ts`) đã loại người đã nhận `assigned` khỏi danh sách `record_created`, nên Agent kiêm manager chỉ nhận một thông báo.
3. PATCH: khi `changedFields` có `agent_email` thì gửi `assigned` cho `updated.agent_email`, `detail: "Enrollment agent changed"`.
4. Comment, file và cron (`DueRecord` thêm `agent_email`): dùng helper.

Agent luôn qua được bộ lọc phạm vi xem của Task 1. Lý do: `agent_email` phải là task agent (`validateEnrollmentOwnership`, `src/lib/enrollment/ownership.ts:36-61`), nên phạm vi của Agent luôn gồm hồ sơ của chính mình.

**Test:**
- `enrollmentRecordOwnerEmails`.
- `buildCreateEnrollmentNotificationRows` có Agent: Agent là người tạo → bị loại; Agent kiêm manager → chỉ nhận `assigned`. Cập nhật `src/lib/enrollment/create-notifications.test.ts`.

**Kiểm tay:**
- CS tạo hồ sơ cho Agent A → A nhận `assigned`.
- Comment trên hồ sơ của A → A nhận `commented`.
- Đổi Agent từ A sang B → B nhận `assigned`.
- Hồ sơ của A quá hạn → A nhận `overdue`.

**Lưu ý:** Agent sẽ nhận nhiều thông báo hơn trước, trong khi đã có agent than nhiều "ting ting". Nên ra cùng lượt với tính năng admin tắt chuông/popup cho từng người ([`2026-10-02-notification-alerts-mute.md`](./2026-10-02-notification-alerts-mute.md)).

**Ước lượng:** khoảng 3 giờ. **Làm trước Task 3**, vì Task 3 dùng `enrollmentRecordOwnerEmails`.

### Task 3 — Cron nhắc hạn (C2, C3, C5, H4, D5 và phần cron của D2)

Bốn thay đổi chính:
- Tính ngày theo giờ Texas.
- Nhắc đúng mỗi ngày.
- Chỉ đánh dấu "đã báo" khi gửi được.
- Phân trang khi đọc hồ sơ.

**Hiện tại** (`src/app/api/cron/check-enrollment-due/route.ts`, 225 dòng):

```ts
const today = toDateOnly(now);                                       // :41  ngày theo UTC
const tomorrow = toDateOnly(new Date(now.getTime() + 86_400_000));
const reminderCutoff = new Date(now.getTime() - 24 * 3600_000).toISOString(); // :43
const { data } = await supabase.from("enrollment_records").select("…")
  .is("archived_at", null);                                          // :54-59  không phân trang (tối đa 1.000 dòng)
// :84 nhắc lại khi overdue_reminded_at <= now - 24h → hôm nào chạy sớm hơn vài ms là lỡ một ngày
await Promise.all([ ...dueSoon.map(async (record) => {               // :107 song song không giới hạn
  await supabase.from("enrollment_records")
    .update({ due_soon_notified_at: nowIso, updated_at: nowIso, updated_by_email: "system" })
    .eq("id", record.id).is("due_soon_notified_at", null);           // :109-117 không đọc kết quả
  await supabase.from("enrollment_activity").insert({ … });
  await notifyRecordOwners(record, "due_soon", "…");                 // :125 0 người nhận vẫn coi là đã báo
}), … ]);
```

`vercel.json` đang đặt `"schedule": "0 3 * * *"`. 03:00 UTC là 22:00 tối hôm trước ở Texas.

**Thay đổi**

1. **File mới `src/lib/enrollment/due-schedule.ts`** (hàm thuần, có test):

   ```ts
   export const ENROLLMENT_BUSINESS_TIME_ZONE = "America/Chicago";            // QĐ-5
   export function businessDate(at: Date, timeZone = ENROLLMENT_BUSINESS_TIME_ZONE): string {
     return new Intl.DateTimeFormat("en-CA", {
       timeZone, year: "numeric", month: "2-digit", day: "2-digit",
     }).format(at);                                                          // "YYYY-MM-DD"
   }
   export function addDays(date: string, days: number): string {
     const d = new Date(`${date}T00:00:00Z`);
     d.setUTCDate(d.getUTCDate() + days);
     return d.toISOString().slice(0, 10);
   }
   export type DueAction = "due_soon" | "overdue" | "overdue_reminder";
   export function classifyDueRecord(r: {
     due_date: string | null; closed_at: string | null;
     due_soon_notified_at: string | null; overdue_notified_at: string | null;
     overdue_reminded_at: string | null;
   }, today: string): DueAction | null {
     if (r.closed_at || !r.due_date) return null;
     if (r.due_date < today) {
       if (!r.overdue_notified_at) return "overdue";
       const last = r.overdue_reminded_at ? businessDate(new Date(r.overdue_reminded_at)) : null;
       return last === null || last < today ? "overdue_reminder" : null;   // C2: so theo NGÀY
     }
     if (r.due_date <= addDays(today, 1) && !r.due_soon_notified_at) return "due_soon";
     return null;
   }
   ```

   Người nhận (QĐ-4, QĐ-6), viết thành hàm thuần `dueRecipients(action, record, managers)` để test:
   - `due_soon`: Caller, Responsible và Agent (`enrollmentRecordOwnerEmails(record)` của Task 12), bỏ trùng.
   - `overdue`, `overdue_reminder`: như trên, **cộng toàn bộ nhóm manager** (`fetchEnrollmentManagerEmails()`, QĐ-1), dù hồ sơ có người phụ trách hay chưa. Câu select của cron phải thêm cột `agent_email` (kiểu `DueRecord` hiện chưa có, `route.ts:14-27`).

2. **Route**
   - **Đọc theo trang:** hồ sơ mở có `due_date`, mỗi trang 1.000 dòng: `.is("archived_at", null).is("closed_at", null).not("due_date", "is", null).order("id").range(from, from + 999)`. Truy vấn riêng cho QC-stale: `closed_at` khác null, `qc_checked_at` null, `qc_stale_notified_at` null.
   - **Mỗi hồ sơ làm 4 bước:**
     - (a) **Giành cờ** bằng update có điều kiện **và đọc lại kết quả**. Cờ đang null thì dùng `.is(flag, null)`; reminder dùng `.eq("overdue_reminded_at", oldValue)`; cuối câu là `.select("id")`. Không có dòng nào trả về thì bỏ qua, vì lần chạy khác đã làm.
     - (b) **Tính người nhận** bằng `dueRecipients(action, record, managers)`. Danh sách rỗng (dữ liệu hỏng, chưa có manager nào) thì **nhả cờ** và tăng `skippedNoRecipient`.
     - (c) `insertEnrollmentNotifications(...)`. Lỗi thì nhả cờ (update về giá trị cũ, kèm điều kiện `.eq(flag, nowIso)`) và tăng `failed`.
     - (d) Chỉ khi (c) thành công mới ghi `enrollment_activity` (`due_soon` / `went_overdue`).
   - **Bỏ `updated_at` / `updated_by_email`** (C5). Đã kiểm an toàn:
     - các cờ nhắc không hiển thị trên giao diện;
     - trigger trên `enrollment_records` chỉ có `assign_display_number`, `sync_carrier_ids` và `overview_timestamps`, không cái nào tự đặt `updated_at`;
     - PATCH chỉ ghi các trường nó gửi lên.

     Việc cron đẩy `updated_at` hiện làm tab đang mở bị 409. Nó cũng làm cột "Last Updated by" từng hiện "system".
   - **Bỏ `broadcastEnrollmentChanged()` cuối route**, vì không còn trường hiển thị nào đổi. Việc này cũng giảm tải D1.
   - **Chạy theo lô 10 hồ sơ** thay cho một `Promise.all` lớn (D5). `fetchEnrollmentManagerEmails()` gọi một lần cho cả lượt chạy.
   - **Trả JSON** `{ ok, today, dueSoon, newlyOverdue, overdueReminder, qcStale, skippedNoRecipient, failed }` để đọc được trong log Vercel.

3. **`vercel.json`:** đổi thành `"schedule": "0 13 * * *"` (QĐ-5).

**Test: `src/lib/enrollment/due-schedule.test.ts`**
- `businessDate(2026-10-02T03:00Z)` trả `"2026-10-01"`.
- Ranh giới DST (2026-11-01).
- Đã nhắc **hôm qua** theo giờ Chicago → nhắc tiếp; đã nhắc **hôm nay** → không nhắc.
- Hồ sơ đã đóng → `null`.
- Hạn hôm nay hoặc ngày mai → `due_soon`. Hạn hôm qua → `overdue`.
- `dueRecipients`: `due_soon` gồm Caller/Responsible/Agent, không có manager; `overdue` và `overdue_reminder` luôn có thêm manager; không trùng người (manager kiêm Agent chỉ nhận một thông báo).

**Kiểm tay** (production có kiểm soát, hoặc preview deployment trỏ DB production — chốt với owner)
- Tạo hồ sơ test hạn ngày mai. Gọi `GET /api/cron/check-enrollment-due` với `Authorization: Bearer $CRON_SECRET` → Caller/Responsible/Agent nhận `due_soon`, manager **không** nhận.
- Hồ sơ test hạn hôm qua → Caller/Responsible/Agent **và 8 manager** nhận `overdue`. Hôm sau tất cả nhận `overdue_reminder`.
- Gọi lại ngay lần nữa → không gửi trùng.

**Ước lượng:** khoảng 1 ngày. **Phụ thuộc:** Task 1 (`fetchEnrollmentManagerEmails`), Task 12 (`enrollmentRecordOwnerEmails`).

### Task 4 — Cho người dùng biết khi thông báo không gửi được (bản tối thiểu của H5)

- Server đã trả `warnings` (`api/enrollment/route.ts:418-421`, `[id]/route.ts:669-672`). Client hiện bỏ qua.
- `EnrollmentClient.createRecord` (`:1692-1751`) và `patchRecord` (`:1556-1666`): đọc `data.warnings`. Nếu có thì hiện **một** toast `tone="info"`, `stackIndex={1}`: "Saved. Some notifications could not be sent."
- Server: ngoài `console.error` sẵn có, thêm một dòng log tên cố định `enrollment.notification.failed`, chỉ ghi số lượng và loại thông báo, để lọc trong Vercel Logs.
- Outbox kèm retry: Phase 3.

**Ước lượng:** khoảng 1 giờ.

---

## 5. Phase 2 — Code P1 (nên xong trước go-live)

### Task 5 — Đổi stage từ ô Stage khi hồ sơ đang đóng (B1)

**Luật ở server** (`api/enrollment/[id]/route.ts:248-256`):

```ts
const reopening = stageChanged && Boolean(fromStage?.is_terminal) && !Boolean(toStage?.is_terminal);
const reopenReason = cleanText(body.reopen_reason);
if (reopening && !reopenReason) {
  return NextResponse.json({ error: "Reopen reason is required when leaving a terminal stage." }, { status: 400 });
}
```

**Client gửi thiếu lý do** ở cả hai chỗ:

```tsx
// bảng — EnrollmentClient.tsx:2707-2712
<EnrollmentStagePill stageId={record.stage_id} stages={optionsBySet.stage}
  canEdit={capabilities.canChangeStage}
  onChange={(value) => onPatch(record.id, { stage_id: value })} />
// drawer — :4345-4351
<EnrollmentStagePill … field canEdit={capabilities.canChangeStage}
  onChange={(value) => onPatch({ stage_id: value })} />
```

Drawer đã có `ReasonModal` cho nút Reopen (`:4143-4157`, `:4650-4660`). `ReasonModal` (`src/app/(authed)/tasks/_components/ReasonModal.tsx`) nhận `onSubmit: (reason) => Promise<boolean>` và chỉ đóng khi kết quả là `true`.

**Thay đổi**

1. **File mới `src/lib/enrollment/stage-transition.ts`** (thuần, có test). Điều kiện y hệt server:

   ```ts
   export function needsReopenReason(
     from: { is_terminal: boolean } | null | undefined,
     to: { is_terminal: boolean } | null | undefined,
   ): boolean {
     return Boolean(from?.is_terminal) && !Boolean(to?.is_terminal);
   }
   ```

2. **Drawer:**
   - Đổi state `reopenReasonOpen: boolean` thành `reopenStageId: string | null`.
   - Nút Reopen gọi `setReopenStageId(reopenTarget.id)`.
   - `onChange` của ô Stage: nếu `needsReopenReason(stage, optionsById.get(value))` thì `setReopenStageId(value)`; ngược lại `onPatch({ stage_id: value })`.
   - `submitReopen` dùng `reopenStageId`. Mô tả trong modal hiện nhãn của stage đích.
3. **Bảng:**
   - Thêm prop `onRequestReopen(recordId: string, stageId: string)` chạy qua `EnrollmentTable` (`:2463`) xuống `EnrollmentRowItem`.
   - `EnrollmentClient` giữ state `{ recordId, stageId } | null` và render **một** `ReasonModal` ở cấp trang.
   - Submit gọi `patchRecord(recordId, { stage_id: stageId, reopen_reason: reason })`. Cần Task 7 để biết lưu thành công hay không.

**Test:** `needsReopenReason` với 4 tổ hợp.

**Kiểm tay** trên cả 3 program: hồ sơ đang ở stage terminal → chọn một stage mở ở bảng **và** ở drawer → hiện hộp lý do.
- Nhập lý do → lưu được; activity có `reopened`; Caller/Responsible nhận `reopened`.
- Bấm Cancel → stage không đổi.

**Ước lượng:** khoảng 3 giờ. **Phụ thuộc:** Task 7.

### Task 6 — Tạo xong thì mở luôn hồ sơ vừa tạo (B2)

**Hiện tại** (`:2048-2051`):

```tsx
onCreate={async (payload, pendingFiles) => {
  await createRecord(payload, pendingFiles);
  setCreating(false);
}}
```

**Thay đổi**
- `createRecord` trả về hồ sơ vừa tạo, kiểu `EnrollmentRecordWithStats`. Nếu có upload file thì trả bản đã đọc lại.
- `onCreate`:

  ```tsx
  onCreate={async (payload, pendingFiles) => {
    const created = await createRecord(payload, pendingFiles);
    setCreating(false);
    openRecordById(created.id);
    const hidden = filterRecords([created], filters, optionsById, currentEmail, yearColumn, yearOptionLabels).length === 0;
    setNotice(`${enrollmentDisplayKey(created.display_number, created.program)} created${hidden ? " — hidden by your current filters" : ""}.`);
  }}
  ```

- Thêm state `notice` và `<Toast message={notice} tone="success" stackIndex={1} onDismiss={() => setNotice(null)} />`. `Toast` có sẵn tone `success` (`src/app/(authed)/_shared/Toast.tsx:6-12`).
- Drawer mở được dù hồ sơ bị bộ lọc ẩn, vì `openRecord = records.find(...)` tìm trong **toàn bộ** `records` (`:1254`).

**Kiểm tay:** lọc Stage khác stage mặc định → tạo hồ sơ → drawer mở, toast báo hồ sơ đang bị bộ lọc ẩn.

**Ước lượng:** khoảng 1 giờ.

### Task 7 — `patchRecord` trả kết quả; sửa hai câu báo lỗi (B4)

- `patchRecord` (`:1556-1666`) đổi sang trả `Promise<boolean>`:
  - khai báo `let saved = false;`;
  - đặt `saved = true` ở nhánh `response.ok && data?.record`;
  - cuối hàm `return operation.then(() => saved);`.

  Cập nhật kiểu `onPatch` của `EnrollmentTable`, `EnrollmentRowItem` và `EnrollmentDrawer` cho khớp.
- `submitReopen`: `const ok = await onPatch({ … }); if (ok) setReopenStageId(null); return ok;`
- Câu báo lỗi Archive bị 409 (`:1790-1794`) đổi thành: "Someone else changed this record, so it was not archived. The latest data is shown — click Archive again if you still want to archive it."

**Ước lượng:** khoảng 1 giờ.

### Task 8 — Banner cấu hình chỉ hiện ở đúng màn, không hiện khi chỉ đổi option (B5)

**Hiện tại**
- `TABLE_CONFIG_TOPIC = "table-config-stream"` (`src/lib/table-config/realtime-topics.ts`). Payload cố ý để rỗng (ghi chú trong file).
- `broadcastTableConfigInvalidation()` (`src/lib/table-config/realtime.ts:26-28`) phát vào kênh chung đó.
- Có hai client nghe kênh và bật banner:
  - `EnrollmentClient.tsx:1510-1520`;
  - `TaskBoardClient.tsx:911-920`.
- Có 15 chỗ phát tín hiệu: `grep -rn "broadcastTableConfigInvalidation()\|broadcastTableConfigChanged()" src/app/api`.

**Thay đổi**
1. `realtime-topics.ts`: thêm `export function tableConfigTopic(scope: TableScope) { return \`${TABLE_CONFIG_TOPIC}:${scope}\`; }`. Payload vẫn rỗng.
2. `realtime.ts`:
   - `broadcastTableConfigInvalidation(scopes: readonly TableScope[] = TABLE_SCOPES)` phát vào từng `tableConfigTopic(scope)`.
   - `broadcastTableConfigChanged()` (dùng khi đổi agent/assistant) vẫn phát cho mọi scope.
3. Các route cột chỉ truyền `[scope]`. Biến `scope` hoặc `column.scope` đã có sẵn ở từng route:
   - `api/config/columns/route.ts:127, 217`;
   - `columns/reorder/route.ts:65`;
   - `columns/[id]/route.ts:131, 173`;
   - `columns/[id]/options/route.ts:86`;
   - `columns/[id]/options/[optionId]/route.ts:70, 103`.
4. Route option của Enrollment **bỏ** `broadcastTableConfigInvalidation()`: `api/enrollment/option-sets/route.ts:151-152` và `option-sets/[id]/route.ts:115-118, 179-182`. Danh sách option đã tự nạp lại vì:
   - `broadcastEnrollmentChanged()` được gọi không kèm `sourceId`, nên client coi đó là tín hiệu "full" và gọi `reloadOptions()` (`EnrollmentClient.tsx:1414`);
   - form tạo đang mở tự gỡ option vừa bị archive (effect trong `NewEnrollmentDialog`).
5. Client: `EnrollmentClient` nghe `tableConfigTopic(program)`; `TaskBoardClient` nghe `tableConfigTopic("cs")`.

**Kiểm tay**
- Admin đổi màu một stage ACA → người đang mở màn ACA **không** thấy banner, màu mới hiện sau vài giây.
- Admin thêm cột ở Leads → màn ACA và Task CS không có banner.
- Admin thêm cột ở ACA → màn ACA có banner.

**Ước lượng:** khoảng 2 giờ.

### Task 9a — Import đổi Due date thì nhắc theo hạn mới (phần nhỏ của B3, QĐ-7)

**Bối cảnh.** Sửa Due date **trên màn hình** đã nhắc theo hạn mới. Khi Due đổi, PATCH xoá ba cờ nhắc (`api/enrollment/[id]/route.ts:184-195`):

```ts
if (nextDueDate.value !== current.due_date) {
  patch.due_date = nextDueDate.value;
  patch.due_soon_notified_at = null;
  patch.overdue_notified_at = null;
  patch.overdue_reminded_at = null;
  changedFields.push("due_date");
}
```

**Import thì chưa.** Đường cập nhật (`src/app/api/enrollment/import/route.ts:236-247`) ghi thẳng `due_date` mà giữ nguyên cờ. Hồ sơ đã từng được báo "sắp tới hạn" hay "quá hạn" vì vậy **không bao giờ** được nhắc theo hạn mới. Phần còn lại của Import để sau go-live (Task 9, Phase 3).

**Thay đổi** (chỉ đường cập nhật của Import)
1. Thêm hàm thuần vào `src/lib/enrollment/due-schedule.ts` (file của Task 3):

   ```ts
   /** Đổi hạn thì xoá cờ nhắc, để cron nhắc lại theo hạn mới — cùng luật với PATCH. */
   export function reminderResetForDueChange(
     currentDue: string | null,
     nextDue: string | null | undefined,
   ): Record<string, null> {
     if (nextDue === undefined || nextDue === currentDue) return {};
     return { due_soon_notified_at: null, overdue_notified_at: null, overdue_reminded_at: null };
   }
   ```

2. Trong vòng lặp, khi có `recordId`:
   - Đọc bản hiện tại **một lần**, gồm cả `due_date`. Truy vấn đang có ở `:212-216` chỉ chạy khi có custom value và chỉ lấy `custom_values`. Đổi thành `.select("custom_values,due_date")` và chạy cho mọi dòng cập nhật.
   - Trải `...reminderResetForDueChange(current.due_date, sanitized.due_date)` vào object của `.update({...})`.

   Vì so với giá trị hiện tại, file xuất ra rồi nhập lại mà giữ nguyên Due sẽ **không** reset cờ, nên không ai bị nhắc oan. PATCH có thể dùng chung helper này nhưng không bắt buộc.

**Test:** `reminderResetForDueChange`:
- file không có cột Due → `{}`;
- Due không đổi → `{}`;
- Due đổi → ba cờ về `null`;
- xoá Due (`null`) → ba cờ về `null`.

**Kiểm tay:** hồ sơ đã nhận `overdue` → Export → sửa Due sang ngày mai → Import → lần cron kế gửi `due_soon` theo hạn mới.

**Ước lượng:** khoảng 30 phút. **Phụ thuộc:** Task 3 (file `due-schedule.ts`).

### Task 10 — Thông báo stage quan trọng (C4, theo QĐ-3)

**Hiện tại**
- `api/enrollment/[id]/route.ts:93-97` dò theo tên: `KEY_STAGE_NOTIFICATIONS = new Set(["5-ready to enroll", "11-terminated", "12-terminated"])`.
- Chuỗi `if (reopening) … else if (toStage?.triggers_qc) … else if (KEY_STAGE…)` ở `:544-600`. Vì là `else if`, ACA "12-Terminated" (có `triggers_qc`) **không bao giờ** sinh `stage_changed`. Medicaid không có stage nào khớp danh sách.

**Thay đổi**
- **File mới `src/lib/enrollment/key-stages.ts`** (nhãn viết thường, theo QĐ-3):

  ```ts
  export const KEY_STAGE_LABELS_BY_PROGRAM: Record<EnrollmentProgram, ReadonlySet<string>> = {
    aca: new Set(["5-ready to enroll", "12-terminated"]),
    medicare: new Set(["5-ready to enroll", "11-terminated"]),
    medicaid: new Set(["urgent", "need apply", "approved"]),
  };
  export function isKeyStage(program: EnrollmentProgram, option: { label: string } | null): boolean {
    return Boolean(option && KEY_STAGE_LABELS_BY_PROGRAM[program].has(option.label.trim().toLowerCase()));
  }
  ```

   Dò theo nhãn tạm chấp nhận được, vì /config không cho đổi nhãn Stage (`option-sets/[id]/route.ts` chặn đổi label của Stage/Consent). Dài hạn thì thêm cờ trên option (Phase 3).
- **Tách nhánh:**
  - `reopening` → `reopened`.
  - Ngược lại, xét **độc lập** hai thông báo: `qc_needed` nếu stage có `triggers_qc`, và `stage_changed` nếu `isKeyStage`.
  - Người đã nhận `qc_needed` trong lượt đổi này thì không nhận thêm `stage_changed`.
- Gom logic vào hàm thuần `buildStageNotifications({ program, fromStage, toStage, reopening, actor, caller, responsible, managers })` để test.

**Test:** `buildStageNotifications` cho 3 program: ACA 12-Terminated (vừa bắt QC vừa là key stage); Medicaid URGENT và Need Apply (chỉ `stage_changed`); Medicaid Approved (vừa bắt QC vừa là key stage); một stage không quan trọng (không gửi gì cho manager).

**Ước lượng:** khoảng 2 giờ.

### Task 13 — Cột "Time Progress" cho cả 3 program (QĐ-8)

**Mục tiêu.** Mỗi hồ sơ hiện thời gian đã ở stage hiện tại, cùng kiểu cột "Time Progress" của Task CS. Task CS dựng ô này bằng `buildTimeReport` trong `src/app/(authed)/tasks/_components/TaskRowItem.tsx`, ra các nhãn như "To do for 2h", "SLA left 1h", "Overdue by 45m".

| Hồ sơ | Ô hiện | Màu |
|---|---|---|
| Đang mở, chưa quá hạn | `1-Need quote for 3d 4h` | xám đậm |
| Đang mở, đã quá Due date | `Overdue by 2d 3h` | đỏ |
| Đã đóng (stage terminal) | `10-ID card done 5d ago` | xanh lá |
| Chưa có dữ liệu thời gian stage | `—` | xám |

Dữ liệu đã có sẵn: `stage_entered_at` / `stage_entered_source`, được `create_enrollment_atomic` và `patch_enrollment_atomic` đặt mỗi lần đổi stage. Production: 201/201 hồ sơ có `stage_entered_source = 'live'`.

**Đã từng làm một lần.** Commit `3b3ea40` (11/8) làm đúng tính năng này cho ACA và Medicare, rồi bị revert ở `ffa179d` sau 3 phút. Lần này khôi phục và chỉnh theo code hiện tại:

1. Khôi phục helper và test:
   - `git show 3b3ea40:src/lib/enrollment/time-progress.ts > src/lib/enrollment/time-progress.ts`
   - `git show 3b3ea40:src/lib/enrollment/time-progress.test.ts > src/lib/enrollment/time-progress.test.ts`

   Các hàm helper dùng vẫn còn: `enrollmentIsOverdue`, `dateOnlyToEndOfDay` (`src/lib/enrollment/helpers.ts:34, 53`), `secondsInCurrentStage`, `isMeasuredStageTime` (`src/lib/enrollment/stage-time.ts`), `formatDurationSeconds` (`src/lib/tasks/sla.ts`).

   **Một chỗ phải chỉnh:** `dateOnlyToEndOfDay` dựng `new Date("YYYY-MM-DDT23:59:59.999")` theo **múi giờ của máy đang chạy** (`helpers.ts:53-55`). Người xem ở Việt Nam sẽ thấy "Overdue" sớm hơn người ở Texas khoảng 12 giờ. Trong `time-progress.ts`, tính mốc quá hạn bằng cuối ngày giờ `America/Chicago`, viết thêm vào `src/lib/enrollment/due-schedule.ts` của Task 3. Như vậy ô Time Progress và cron cùng một nghĩa "quá hạn".
2. `EnrollmentClient.tsx`. Áp lại diff cũ (`git show 3b3ea40 -- "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"`):
   - Thêm cột `{ key: "timeProgress", label: "Time Progress", width: 180 }` ngay sau `stage` trong `ACA_ENROLLMENT_COLUMNS` (`:343-367`). Union `key` của `EnrollmentColumn` (`:323-337`) tự nhận key mới. **Không** thêm vào `PROGRAM_HIDDEN_COLUMNS` (`:385-403`), để Medicaid cũng có cột.
   - Một đồng hồ dùng chung: state `timeProgressNow`, khởi tạo từ prop `initialNowIso` để HTML server và client khớp nhau lúc hydrate, rồi cập nhật mỗi 60 giây. Truyền `now` qua `EnrollmentTable` (`:2463`) xuống `EnrollmentRowItem` (`:2569`).
   - Thêm ô `EnrollmentTimeProgressCell` gọi `buildEnrollmentTimeProgress(record, stage?.label ?? null, now)`.
   - Cột không sort được, giống commit cũ.
3. `src/app/(authed)/enrollment/page.tsx`: truyền `initialNowIso = new Date().toISOString()` vào `EnrollmentClient`.
4. `src/app/api/enrollment/export/route.ts`: thêm case `"timeProgress"` trả `.label`, theo diff cũ (`git show 3b3ea40 -- src/app/api/enrollment/export/route.ts`).
5. `src/lib/enrollment/import.ts`: thêm `"timeProgress"` vào `ENROLLMENT_IMPORT_MANAGED_KEYS` (`:22-29`). Đây là cột tính ra, Import phải bỏ qua, không được coi là dữ liệu nhập.
6. **Cấu hình cột.** Thêm `col("<program>", "timeProgress", "Time Progress", "text", 35)` cho `aca`, `medicare`, `medicaid` vào `DEFAULT_TABLE_COLUMNS` (`src/lib/table-config/queries.ts`) và vào khối `system_column_seed` của `supabase/schema.sql`. Trong DB, `aca` đã có dòng này (position 9). Rollout mới `supabase/rollouts/2026-10-0X-enrollment-time-progress-column.sql` thêm cho Medicare và Medicaid:

   ```sql
   -- Đảo ngược: delete from table_column where key = 'timeProgress' and scope in ('medicare', 'medicaid');
   insert into table_column (scope, key, label, type, is_system, position, pinned, hidden_default, required)
   values
     ('medicare', 'timeProgress', 'Time Progress', 'text', true, 35, false, false, false),
     ('medicaid', 'timeProgress', 'Time Progress', 'text', true, 65, false, false, false)
   on conflict (scope, key) do nothing;
   ```

   Không chạy rollout thì `ensureTableColumns` (`src/lib/table-config/queries.ts`) cũng tự chèn cột mặc định còn thiếu khi màn hình nạp cấu hình. Vẫn chạy rollout để chủ động và có dấu vết.
7. **Liên quan Import (QĐ-7):** Import để sau go-live. Import đổi Stage bằng `.update()` thẳng nên không cập nhật `stage_entered_at`, làm Time Progress sai. Trong lúc chờ, không dùng Import để đổi Stage (mục 0.6). Khi làm Import (Task 9, Phase 3), đổi Stage phải đi qua `patch_enrollment_atomic`.

**Mở rộng (chưa làm, cần thì nói):** đặt thời hạn riêng cho từng stage (ví dụ "Need quote tối đa 2 ngày"), rồi hiện "còn X" / "quá Y" như SLA của Task CS. Cách làm: thêm cột `target_minutes` trên `enrollment_options` và ô nhập trong /config.

**Test:** khôi phục `time-progress.test.ts` (đang mở, quá hạn, đã đóng, chưa có dữ liệu). Thêm ca quá hạn tính theo giờ Chicago.

**Kiểm tay:**
- Cả 3 program đều có cột.
- Đổi stage → ô về "… for 0m" rồi tăng mỗi phút.
- Hồ sơ quá Due → "Overdue by …" màu đỏ.
- Export có cột Time Progress. Import lại file đó không báo lỗi cột.

**Ước lượng:** khoảng 3 giờ. **Phụ thuộc:** Task 3 (`due-schedule.ts`).

---

## 6. Phase 3 — Sau go-live (P2)

| Mục | Hướng làm |
|---|---|
| B3 phương án B | Tách phần tính patch của `api/enrollment/[id]/route.ts:170-515` thành hàm thuần `planEnrollmentPatch(current, body, optionData)` (tính patch, `changedFields`, `closed_at`, QC, reopen, activity). PATCH route và Import cùng gọi hàm này, rồi gọi `patch_enrollment_atomic` với `expected_updated_at` |
| H5 đầy đủ | Bảng outbox `enrollment_notification_outbox` (idempotent theo `(event_id, recipient, type)`). Route ghi outbox **trong cùng RPC** với thay đổi; một cron/worker gửi và retry; có dashboard đối soát |
| C6 | Khi admin đổi `is_terminal`: hiện số hồ sơ bị ảnh hưởng, cho chọn backfill `closed_at` |
| C7 | Xoá file ghi activity `attachment_removed` |
| D1 | (a) Một RPC/view gộp số comment, số file và text tìm kiếm. (b) Tín hiệu realtime mang `recordId`, tab nhận chỉ nạp lại một hồ sơ qua `GET /api/enrollment/[id]`. (c) Realtime đang "live" thì giãn poll lên 5 phút |
| D2 | Danh sách: phân trang hoặc lọc ở server trước khi program nào chạm khoảng 800 hồ sơ. `page.tsx` bắt `EnrollmentListTruncatedError` để trang không sập |
| D3 | PATCH: chạy song song `isAgentOwnerOrAssistant`, options và write-context; dùng dòng RPC trả về thay cho lần đọc lại cuối |
| D4 | Drawer không tự nạp lại khi realtime đang "live" |
| D6 | `page.tsx` dùng kết quả assistant đã có trong scope |
| E1 | Thêm `client_request_id` cho tạo hồ sơ, kèm unique index |
| E2 | Chỉ kiểm option đã archive khi giá trị **thực sự đổi** |
| E3 | /config chặn tổ hợp "Required + ẩn mặc định", hoặc form tạo vẫn hiện cột bắt buộc |
| E4 | Export theo đúng cột người dùng đang hiện |
| E5 | Sửa/xoá comment và xoá file cũng phát tín hiệu cho danh sách. Làm cùng D1(b) |
| E6 | Chuẩn hoá email (lowercase) ở `isAgentOwnerOrAssistant` và ở bộ lọc mention |
| E7 | Bỏ qua `custom_values` không đổi khi ghi `field_changed` |
| Time Progress mở rộng | Thời hạn riêng cho từng stage (`target_minutes` trên `enrollment_options`), hiện "còn X / quá Y" như SLA của Task CS |
| C4 dài hạn | Thêm cờ `notify_managers` trên `enrollment_options`, bật/tắt trong /config, thay cho dò theo nhãn |

### Task 9 — Import đầy đủ (B3) — làm sau go-live

Phần "reset cờ nhắc khi đổi Due" đã làm trước ở Task 9a. Khi làm task này, cân nhắc phương án B (bảng bên trên) thay cho cách chặn đổi Stage.

**Hiện tại** (`src/app/api/enrollment/import/route.ts`, 356 dòng). Mỗi dòng của file chạy tuần tự:
- `fetchWriteValidationContext` (một RPC);
- `checkOwnership` → `validateEnrollmentOwnership`, mỗi lần đọc **toàn bộ** `portal_account` và `task_agents`;
- một lần đọc `custom_values` (`:212-216`);
- `.update()` thẳng vào bảng (`:236-258`). Không có activity, không có `closed_at`, không reset cờ nhắc, không lọc `archived_at`.

Tạo mới (`:260-265`) không đặt `closed_at` khi stage là terminal, khác với màn hình tạo (`api/enrollment/route.ts:311-318`).

**Thay đổi**
1. Thêm `export const maxDuration = 300;`, giống `api/cron/sync-data/route.ts:6`.
2. **Nạp một lần** trước vòng lặp:
   - Tập email active và tập task agent. Tách `validateEnrollmentOwnership` (`src/lib/enrollment/ownership.ts:36-61`) thành `loadEnrollmentOwnershipSets()`, rồi mỗi dòng gọi hàm thuần đã có sẵn `findInvalidEnrollmentOwnership(values, activeEmails, taskAgentEmails)` (`:19-34`).
   - Các hồ sơ sẽ được cập nhật: `id, program, stage_id, due_date, custom_values, archived_at`, truy vấn theo `.in("id", ids)` và chia lô 50 (`chunkEnrollmentRecordIds`, `src/lib/enrollment/queries.ts:80-92`).
3. **Đường cập nhật**:
   - ID không tồn tại, khác program hoặc đã archive → báo lỗi ở dòng đó.
   - `stage_id` **khác** giá trị hiện tại → lỗi dòng: "Stage can't be changed by import. Change it in the app." File xuất ra rồi nhập lại vẫn chạy, vì Stage giữ nguyên thì không tính là đổi.
   - `due_date` khác giá trị hiện tại → thêm `due_soon_notified_at`, `overdue_notified_at`, `overdue_reminded_at` bằng `null`.
   - Ghép `custom_values` từ bản đã nạp (bỏ lần đọc ở `:212-216`).
   - Thêm `last_activity_at: nowIso` và `last_activity_by_email: actor`.
   - Sau vòng lặp, insert một lô `enrollment_activity` với `{ type: "field_changed", meta: { fields, source: "import" } }`.
4. **Đường tạo:** stage terminal → `closed_at = nowIso`. Stage có `triggers_qc` → thêm activity `qc_needed`, như `api/enrollment/route.ts:311-330`.

**Test:** tách hàm thuần `planImportRowUpdate(current, value, optionsById)` trả `{ patch, changedFields } | { error }`, rồi test các trường hợp trên.

**Kiểm tay**
- Export → sửa Stage của 1 dòng và Due của 1 dòng → Import: dòng đổi Stage báo lỗi; dòng đổi Due được cập nhật, và cron lần sau nhắc theo hạn mới.
- File 300 dòng chạy xong dưới 60 giây.

**Ước lượng:** từ nửa ngày đến 1 ngày.

---

## 7. Thứ tự, phụ thuộc, ước lượng

| Ngày | Việc | Ghi chú |
|---|---|---|
| 1 | Phase 0.1–0.5 (đã chốt đủ 8 QĐ). **Task 1, Task 12** | |
| 2 | **Task 2, Task 3** | Task 3 cần Task 1 (`fetchEnrollmentManagerEmails`) và Task 12 (`enrollmentRecordOwnerEmails`) |
| 3 | **Task 4, 7, 5, 6, 8, 13** | Task 5 cần Task 7; Task 13 cần `due-schedule.ts` của Task 3 |
| 4 | **Task 9a, 10**. Chạy `typecheck` / `test:run` / `lint` / `build`. Deploy lên preview | |
| 5 | Kiểm tay theo ma trận (mục 8). Ghi vào bảng go/no-go (0.7). Quyết định go-live | |

Tổng code khoảng 4 ngày công (Import đầy đủ đã dời sang Phase 3). Phase 0 làm song song.

**Liên quan:** tính năng "admin tắt chuông/popup thông báo cho từng người" (plan riêng: [`2026-10-02-notification-alerts-mute.md`](./2026-10-02-notification-alerts-mute.md)) đụng `NotificationBell.tsx` và `src/lib/notifications/push-server.ts`, không đụng `insertEnrollmentNotifications`. Nên làm trong **cùng đợt release**, vì Task 12 làm Agent nhận nhiều thông báo hơn. Làm sau Task 1–2 để tránh xung đột trong `NotificationBell.tsx`.

---

## 8. Kiểm chứng

**Lệnh**

```bash
npm run typecheck && npm run test:run && npm run lint && npm run build
```

**Kịch bản kiểm tay chung.** Trước đây là mục F của checklist. Làm trên **cả 3 program**, trừ khi ghi riêng, và ghi kết quả vào bảng 0.7. Dùng ít nhất 3 tài khoản: một quản lý; một agent có assistant; một CS thường.

*Tạo và sửa*
- Tạo hồ sơ đủ trường, kèm 1 file. Hồ sơ hiện ra; sửa Stage ngay, không lỗi; reload vẫn còn. Đây là lỗi Cheryl, đã sửa ở `6da7ee0`.
- Tạo hồ sơ khi đang bật bộ lọc → drawer mở, toast báo hồ sơ bị ẩn (Task 6).
- ACA và Medicare, chọn nhiều Carrier:
  - bảng hiện đủ các hãng, xuống dòng;
  - lọc được theo Carrier;
  - Export ra "A, B";
  - Import lại vẫn giữ đủ hãng.
- Medicaid: form tạo, drawer và bảng **không** có Caller, Carrier, PCP, Platform, Consent, Payment hay ACA status. Stage mặc định là stage đầu theo thứ tự trong /config.
- Medicare: nhãn Assignee/PCP đúng; không có Caller.

*Stage, QC, đóng/mở lại*
- Chuyển sang stage đóng có QC (ACA 10-ID card done, Medicare 9-ID card done, Medicaid Approved) → hồ sơ đóng, cột Complete hiện ô cần tick. Caller/Responsible/Agent và manager nhận `qc_needed`.
- Agent owner hoặc assistant tick Complete được; Caller hoặc Responsible **không** tick được.
- Mở lại bằng nút Reopen trong drawer (nhập lý do) → được. Đổi từ ô Stage → hỏi lý do (Task 5).

*Hai người cùng sửa*
- Tab A sửa field X, tab B (chưa tải lại) sửa field Y → B lưu được, không có thông báo lỗi.
- Hai tab cùng sửa field X → tab sau nhận "Someone else changed this record…", dữ liệu hiện bản mới nhất, không cần reload.
- Archive khi tab khác vừa thêm file → hiện câu báo mới (Task 7), bấm Archive lại được.

*Phạm vi và quyền*
- Agent A không thấy hồ sơ của agent B. Mở link `?record=<id của B>` cũng không hiện gì.
- Assistant thấy hồ sơ của agent mình phụ trách. CS thường thấy toàn bộ và mặc định lọc "của tôi".
- Caller đổi được Stage nhưng không sửa được Client name/FUB. Người tạo sửa được nội dung. Chỉ owner (agent hoặc assistant) và quản lý mới archive được.

*Comment, file, thông báo*
- Comment có @mention: người được nhắc nhận `mentioned`; những người khác trong luồng, gồm Agent, nhận `commented`.
- File 3MB lên được. File 5MB báo "File is too large (max 4MB)…".
- Tạo hồ sơ → 8 manager nhận `record_created`, Caller/Responsible/Agent nhận `assigned`.
- Đặt Due = ngày mai → sau 13:00 UTC hôm sau có `due_soon`.

*Export / Import / cấu hình*
- Export đúng các cột đang hiện, đúng các dòng đang lọc. Import lại file đó: số dòng cập nhật đúng, không tạo trùng.
- Admin đổi màu một option khi người khác đang mở form tạo hồ sơ → không có banner, form không mất (Task 8).

**Kiểm tay theo từng task**
- **H1/H2:**
  - Role "Linh Le" không nhận `record_created` của agent khác.
  - @mention người ngoài phạm vi → không có thông báo.
  - Gỡ một người khỏi vai Caller → thông báo cũ trong chuông của họ không còn tên khách và nội dung.
- **H4:**
  - Hồ sơ hạn ngày mai → Caller/Responsible/Agent nhận `due_soon`. Hồ sơ quá hạn → thêm cả 8 manager nhận `overdue`, rồi nhắc lại mỗi ngày.
  - Gọi cron hai lần liên tiếp → không gửi trùng.
  - Sau khi gán Responsible, lần chạy kế vẫn nhắc đúng.
- **C2/C3:** hồ sơ quá hạn được nhắc **mỗi ngày** lúc khoảng 08:00 giờ Texas.
- **B1:** đổi stage từ đóng sang mở, cả ở bảng lẫn drawer, phải hỏi lý do.
- **B2:** tạo hồ sơ khi đang lọc → drawer mở, toast báo bị ẩn.
- **B5:** đổi màu một option → không có banner; thêm cột ở scope khác → không có banner.
- **Task 9a:** Import đổi Due → lần cron kế nhắc theo hạn mới. Import lại file mà không đổi Due → không ai bị nhắc lại.
- **C4:** ACA 12-Terminated → manager nhận `stage_changed`, Caller/Responsible/Agent nhận `qc_needed`. Medicaid vào URGENT hoặc Need Apply → manager nhận `stage_changed`. Medicaid vào Approved → manager nhận `stage_changed`, Caller/Responsible/Agent nhận `qc_needed`.
- **C1 (Task 12):** CS tạo hồ sơ cho Agent A → A nhận `assigned`; comment hoặc thêm file trên hồ sơ của A → A nhận; đổi Agent sang B → B nhận `assigned`; người thao tác không tự nhận.
- **QĐ-8 (Task 13):** cả 3 program có cột Time Progress. Đổi stage → ô về "… for 0m". Quá Due (theo ngày Texas) → "Overdue by …". Hồ sơ đã đóng → "… ago". Export có cột; Import lại không lỗi.
