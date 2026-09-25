# Authorization Migration — Final Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa phân quyền của agent-portal từ trạng thái phân mảnh (tên role viết cứng, cột legacy, tên hiển thị, roster ngầm) về một lớp authorization tập trung, nơi RBAC grant `{action, scope}` là nguồn sự thật chính — mà không làm vỡ hành vi hiện tại.

**Architecture:** Principal khoá theo `portal_account.id` + `access_version`; role mang grant `{action, scope}`; policy thuần trong `src/lib/authz/` quyết định kèm lý do. Route, truy vấn, UI và thông báo đều hỏi policy. Chuyển đổi theo 8 phase (A–H), mỗi phase thêm trước gỡ sau, có decision diff offline + shadow evaluation runtime, và feature flag theo domain.

**Tech Stack:** Next.js 16 (App Router, `src/proxy.ts` thay middleware), NextAuth v5 `5.0.0-beta.31` (JWT strategy), Supabase Postgres qua service-role client, vitest 2, GitHub Actions.

**Nguồn:**
- Audit: `docs/2026-09-25-rbac-authorization-architecture-audit.md` — bản 3; §17 ghi cách xử lý 22 comment `[sol5.5]`.
- Audit song song của Codex: `docs/2026-09-25-authorization-architecture-audit.md`.

## Cấu trúc tài liệu

- **Phần I — Master plan:** các quyết định đã chốt, tổng quan phase, và spec cho Phase B–H. Mỗi phase B–H sẽ có một implementation plan chi tiết riêng *sau khi* Phase A xong và các câu hỏi chặn được trả lời. Lý do: câu trả lời Q1, Q2, Q4, Q22 đổi trực tiếp nội dung của B–D, viết chi tiết trước sẽ là viết lại.
- **Phần II — Phase A, chi tiết từng task:** bịt lỗ khẩn và dựng baseline. Chạy được ngay.

## Global Constraints

- `AGENTS.md`: "This is NOT the Next.js you know" — đọc hướng dẫn liên quan trong `node_modules/next/dist/docs/` trước khi viết code Next.
- Mọi thay đổi **logic** (quyền, luồng dữ liệu, schema) phải thêm entry vào `changelog.md` ngay trong task đó. Entry mới nằm trên cùng, theo format `## YYYY-MM-DD — Tiêu đề`, rồi đoạn giải thích. Không ghi thay đổi UI thuần hay test thuần.
- **Không commit/push khi chưa được chủ repo cho phép.** Bước "Commit" trong từng task chỉ chạy khi đã được đồng ý. Plan này chỉ vào git cùng lượt với code hiện thực nó.
- UI không bao giờ hiện raw email của người: dùng `personLabel` / `formatEmailAsName` trong `src/lib/tasks/people.ts`.
- Chỉ có **một** database, là production (`.env.local` trỏ production). Mọi truy vấn trên production do chủ repo tự chạy trong Supabase SQL editor; câu nào không có `begin … commit` thì chỉ được đọc.
- Server truy cập DB bằng service role (bỏ qua RLS). Trình duyệt chỉ dùng anon key cho Realtime **broadcast** (`src/lib/supabase-browser.ts`); không component nào `.from()` hay `postgres_changes` bằng anon key (đã grep).
- Lệnh kiểm tra: `npm run test:run`, `npm run typecheck`, `npm run lint`. Chạy một file: `npx vitest run <path>`.
- Thứ tự so khớp email: dữ liệu chuẩn hoá `trim().toLowerCase()`. Code mới so email theo dạng đã chuẩn hoá ở cả hai vế.

---

# Phần I — Master plan

## I.1 Quyết định đã chốt

| # | Quyết định | Vì sao | Comment liên quan |
|---|---|---|---|
| D1 | Chủ thể phân quyền là `portal_account.id` (JWT mang `accountId`); email chỉ để tra dữ liệu cũ. Refresh mà email trong token lệch account → hết phiên | Email đổi/tái dùng được → token cũ nhận quyền account mới (S20) | Codex |
| D2 | Grant lưu ở **bảng mới** `role_grants(role_id, action, scope)`. **Không** đổi khoá chính `role_permissions` | `replace_role_permissions` xoá sạch hàng của role rồi chèn key phẳng (`schema.sql:111-128`); đổi PK tại chỗ thì một lần sửa qua UI cũ xoá luôn grant có scope | C6, C17 |
| D3 | Dual-write có nguồn rõ ràng. Phase B–C: `role_permissions` là nguồn; trigger sinh lại `role_grants` tương thích cho đúng role vừa sửa, cùng transaction. Từ cuối Phase C: `role_grants` là nguồn, key phẳng thành bản chiếu tới Phase H. Rollback adapter không đụng `role_grants` | Tránh dữ liệu shadow bị xoá im lặng | C6, C17 |
| D4 | API mới `hasGrant(principal, action, scope?)`. **`can()` giữ nguyên nghĩa so khớp chính xác** cho key cũ | `can()` là `permissions.includes(permission)` (`src/lib/rbac/client.ts:1-14`), không hiểu `task.read:assigned` | C6 |
| D5 | Grant chỉ nằm trong JWT nếu cookie phiên ≤ **3.500 byte** với role lớn nhất + role tổ hợp giả lập. Vượt budget → grant ở server, nạp theo `(accountId, access_version)` | Chưa đo; Auth.js chia cookie > 4 KB thành nhiều cookie, tăng byte mọi request | C7 |
| D6 | Từ vựng scope là **quan hệ logic**, có bảng ánh xạ theo resource (§I.3). Tách `reported` (người tạo) khỏi `participating` (người được @mention) | Lead không có `agent_email`; mention chỉ cho xem, không cho sửa (`tasks/access.ts:137-146`) | C5, C8 |
| D7 | Luật "`shared_queue` bị tắt khi có roster/delegation" là **compat tạm thời** có tên, có số đo (A0), có điều kiện gỡ (trả lời Q2). Đích: `shared_queue` là grant độc lập, hoặc membership hàng đợi tường minh | Không để phạm vi phụ thuộc vào *sự vắng mặt* của quan hệ | C3 |
| D8 | Policy thuần; tải quan hệ là adapter có I/O. Thao tác nhạy cảm có **điểm thi hành trong transaction/RPC**: `UPDATE … WHERE` kèm version/quan hệ, hoặc lock rồi kiểm lại. Áp cho: assign, xoá/archive, đổi `agent_email`, import, mutation role/account | Tránh TOCTOU giữa lúc kiểm và lúc ghi bằng service role | C10 |
| D9 | Capability hai mức: `projectModuleCapabilities(principal)` cho nav/page; `capabilitiesFor(principal, resource)` cho từng bản ghi. API luôn kiểm lại | Một tài liệu toàn cục không trả lời được "assign được task A nhưng không được task B" | C11 |
| D10 | Trần uỷ quyền so **grant hiệu lực trước/sau** (gồm scope, role active, role protected), trong cùng transaction với việc ghi. `system_key` chỉ đổi qua migration. Bất biến admin khôi phục đếm account active + role active + grant hiệu lực, có khoá. "Break-glass" để lại cho Q5 | Chỉ "cấp được thứ mình có" là chưa đủ khi có nhiều role/scope | C12 |
| D11 | Thu hồi quyền: `portal_account.access_version`. Sửa grant của role → tăng version của **mọi thành viên** role đó, cùng transaction. Route đọc so version qua cache chỉ-version TTL 30 s/instance (**SLA thu hồi ≤ 30 s**); route ghi, `/api/admin/*`, chuông, push đọc tươi. Test trên ≥ 2 cache độc lập | Tăng version của người sửa không thu hồi được JWT của thành viên role | C13 |
| D12 | Decision diff chạy theo lô keyset, có `statement_timeout`, chỉ xuất `{accountIdHash, resourceIdHash, action, old, new, reason}` + thống kê, kèm bộ ca biên cố định. Shadow runtime có sampling (mặc định 20%) và budget ≤ 1 truy vấn thêm/request | Kéo dữ liệu khách hàng ra ngoài DB và nhân đôi tải là rủi ro thật | C14 |
| D13 | **Rollback bản vá bảo mật không bao giờ mở lại lỗ**: không có file "đảo ngược" `REVOKE`/`ENABLE RLS`. Invariant (trần uỷ quyền, chặn xoá role còn người, khoá admin cuối) nằm ở DB/shared service, **không** sau feature flag; flag chỉ đổi UI/đường gọi | Lùi flag về mutation cũ sẽ khôi phục S4/S19 | C15, C18 |
| D14 | Cổng persistence chạy được **ngay** trên GitHub Actions (Postgres dùng một lần), không chờ Supabase project riêng. Nếu SQL không chạy sạch trên DB trống, đó là phát hiện phải sửa trước Phase C | Repo đã dùng GitHub Actions (`.github/workflows/task-reminders.yml`) | C19 |
| D15 | `task.import`/`task.export` là tên legacy dùng **chéo domain** (Enrollment, Provider). Grant tương thích map sang `enrollment.import`, `provider.import`… Role Manager đổi nhãn ngay ở Phase B | Không có route import task nào; nhãn "Tasks - Import" khiến quản trị cấp sai mục đích | C9 |
| D16 | Registry gác route là **cổng tĩnh 3 mức** (xác thực / quyền hành động / scope object), chỉ phát hiện thiếu khai báo. Không thay test gọi API trực tiếp | Overview (S8) và roles PATCH (S18) đều "có gác" mà vẫn thủng | C2 |
| D17 | Push: chọn ứng viên → `canReceive` **từng người tại thời điểm gửi** → chọn payload `full/minimal` theo người → mới nhóm theo *payload class + nội dung*. Chuông áp cùng luật lúc đọc | `push-dispatch.ts:107-125` nhóm trước rồi `push-server.ts:120-150` gửi một payload cho cả nhóm | C4 |
| D18 | S0 chỉ kết luận "lộ" khi có đủ: `relrowsecurity = false` + quyền bảng của anon/authenticated + `USAGE` trên schema + request HEAD chỉ-đếm bằng anon key trả 200. Báo cáo SELECT/INSERT/UPDATE/DELETE riêng | Quyền DB chưa đủ chứng minh gọi được qua PostgREST | C21 |
| D19 | Ưu tiên chặn các đường **ghi** đang sai ngay trong Phase A (S5, S6), kèm số đo; S16 chờ quyết định Q23 nhưng có số đo ở A0 | Không cần kiến trúc mới để chặn đầu vào sai | C20 |
| D20 | Đoạn "không thấy vấn đề" của audit đổi thành **giới hạn điều tra** | Không tuyên bố an toàn tuyệt đối | C22 |

## I.2 Tổng quan phase

| Phase | Mục tiêu | Vào khi | Ra khi (exit gate) |
|---|---|---|---|
| **A** | Bịt lỗ khẩn + baseline + hạ tầng test DB | Ngay | Mục "Exit Phase A" ở cuối Phần II |
| **B** | Principal theo id + version; lõi `src/lib/authz/`; `role_grants` + trigger tương thích; decision diff + shadow ở 3 route thí điểm | A xong; có số đo JWT (A0) | Shadow 7 ngày không lệch ở 3 route; decision diff = 0; cookie trong budget D5 |
| **C** | Quản trị role/account an toàn: `system_key`, RPC nguyên tử, trần uỷ quyền, audit, lưới action × scope; `schema.sql` thành full-state | B xong; Q5, Q22 đã trả lời | Ma trận leo quyền + test đồng thời admin cuối xanh trên CI DB; không còn key cũ bị seed ghi đè |
| **D** | Data scope từng domain (Task → Enrollment → Lead → Registration/Dashboard/AI → Time off) qua `scopeQuery`; PEP trong RPC | C xong; Q1, Q2, Q3, Q4, Q11, Q23 đã trả lời cho domain tương ứng | Mỗi domain: test tương đương list ⇔ authorize; shadow sạch; flag bật 100% |
| **E** | Frontend chiếu capability hai mức; registry điều hướng chung | D của domain tương ứng | Test payload server-rendered theo persona |
| **F** | Chính sách sự kiện: `canReceive` từng người, payload class, kiểm lại lúc đọc/gửi | B xong (song song với E) | Replay 14 ngày lịch sử thông báo: không người nhận ngoài scope |
| **G** | Roster/delegation/queue/lead weights: quản lý + eligibility ở server/DB + audit | D (Task, Enrollment, Lead) xong; Q15, Q17 | Test gọi API trực tiếp không tạo được quan hệ sai |
| **H** | Gỡ legacy: `portal_account.role`, so tên role (TS + SQL), compat hết hạn, key phẳng | Mọi phase trước + shadow sạch | CI chặn so tên role; không còn đọc cột legacy |

## I.3 Từ vựng scope và ánh xạ theo resource (D6)

| Scope logic | Task | Enrollment | Lead | Registration | Time off |
|---|---|---|---|---|---|
| `own` | — | — | — | `agent_email = tôi` **hoặc** `selected_agent` ∈ định danh hoa hồng của tôi | `requester_id = tôi` |
| `assigned` | tôi ∈ `task_assignees` / `assignee_email` | `caller_email` hoặc `responsible_enroll_email` = tôi | `assigned_to_email = tôi` | — | — |
| `reported` | `reporter_email = tôi` | `created_by_email = tôi` | — | — | — |
| `participating` | tôi ∈ `task_participants` (@mention) | — (mention **không** cấp quyền xem ở Enrollment) | — | — | — |
| `agent_owned` | `agent_email = tôi` và tôi ∈ `task_agents` | như Task | — (lead dùng `assigned`) | — | — |
| `assistant_for_agent` | `agent_email` ∈ agent tôi được uỷ quyền | như Task | `assigned_to_email` ∈ agent tôi được uỷ quyền (`leads/membership.ts:22-29`) | — | — |
| `shared_queue` | hàng đợi chung (compat D7) | như Task | — | — | — |
| `all` | tất cả | tất cả | tất cả | tất cả | tất cả |

Grant tương thích của Task (sửa lỗi bản 2, C8):
- `task.content.update` ở scope `reported`, `agent_owned`, `assistant_for_agent`, `all` — **không** có `participating`.
- `task.read` và `task.due_date.update` có thêm `participating`.

## I.4 Spec Phase B–H (mỗi phase sẽ có plan chi tiết riêng)

### Phase B — Principal ổn định & lõi authz *(không đổi hành vi)*

1. `portal_account.access_version integer not null default 0`. JWT mang `accountId` + `accessVersion`. Đăng nhập Google: tra account theo email một lần rồi gắn id. Mỗi lần làm mới: tra theo id; email lệch → trả `null` (hết phiên). Phiên cũ chưa có id: tra theo email một lần, gắn id.
2. So version theo D11: cache chỉ-version, khoá accountId, TTL 30 s, trong `src/lib/authz/versions.ts`. Route ghi/admin/chuông/push gọi `requireFreshPrincipal()`.
3. Bảng `role_grants(role_id uuid references roles on delete cascade, action text, scope text, primary key(role_id, action, scope))` + bảng ánh xạ `legacy_permission_grants(permission_key, action, scope, requires_task_admin_name boolean)` sinh từ `catalog.ts`. Hàm `derive_compat_grants(role_id)` + trigger `after insert or delete on role_permissions` (statement-level, theo role) gọi hàm này. Backfill toàn bộ role một lần.
4. `src/lib/authz/`: `catalog.ts` (action, scope hợp lệ, nhãn, cờ `sensitive`), `principal.ts`, `grants.ts` (`hasGrant`), `guards.ts` (hợp đồng 401 chưa đăng nhập / 403 thiếu quyền / 404 ngoài scope), `holders.ts` (một bản "ai nắm grant X", lọc account + role inactive), `relationships.ts` (ánh xạ §I.3), `policies/*` (bọc resolver hiện có), `compat/*` (mỗi luật tương thích một file có hạn gỡ), `decision-log.ts` (sampling, hash).
5. Đo cookie theo D5; quyết grant trong JWT hay ở server.
6. Shadow thí điểm: `GET /api/tasks`, `GET /api/tasks/[id]/detail`, `GET /api/enrollment/[id]/detail`.
7. Script decision diff offline (D12) trong `scripts/authz-diff/`.
8. Role Manager: đổi nhãn `task.export`/`task.import` thành "Export (Task, Enrollment, Provider)" / "Import (Enrollment, Provider)" (D15).

**Rollback:** tắt flag adapter; `role_grants`, `access_version` giữ nguyên (additive).

### Phase C — Quản trị role/account

1. `roles.system_key text unique` (`super_admin`, `default_new_account`); ràng buộc DB cấm sửa/xoá role có `system_key` ngoài migration.
2. RPC nguyên tử, có khoá, tăng `access_version`, ghi `access_audit`:
   - `save_role_grants_atomic`
   - `assign_user_role_atomic`
   - `set_account_active_atomic` (kèm xoá `push_subscriptions`)
   - `change_account_email_atomic`
   - `delete_role_atomic` (từ chối nếu còn người).

   Trần uỷ quyền D10 và bất biến admin khôi phục nằm **trong** RPC.
3. API `/api/admin/*` gọi RPC; flag chỉ chọn UI cũ/mới (D13).
4. Role Manager dạng lưới action × scope (nếu Q22 đồng ý).
5. `schema.sql` thành full-state:
   - gộp 8 bảng hiện chỉ có trong rollout (`notification_preferences`, `provider_directory`, `push_subscriptions`, `sheet_sync_runs`, `sheet_sync_staging`, `time_off_balance_adjustment_batches`, `time_off_monthly_accrual_rules`, `time_off_notifications`);
   - bỏ đoạn đặt lại quyền `Admin`/`Agent` (`:293-321`);
   - thay đoạn xoá key không có trong danh sách (`:219-248`) bằng danh sách deprecate tường minh;
   - seed insert-only sinh từ catalog.
6. Test trên CI DB (Task A10): leo quyền, đồng thời admin cuối, xoá role còn người, lỗi giữa chừng.

### Phase D — Data scope từng domain

1. Mỗi domain một flag. Thay `buildTaskActor`/`isTaskViewAdmin` (~30 call site) và `buildLeadActor`/`isLeadViewAdmin` bằng `authorize`/`scopeQuery`; compat D7 và "task-admin theo tên role" chuyển thành grant tương thích.
2. Gom 7 bản `canViewResolved` (routes `api/tasks/[id]/**`, `lib/tasks/reaction-access.ts`) thành `task.read`; route activity thành `task.activity.read`.
3. `scopeQuery` sinh predicate trước phân trang/đếm/export/search/AI; test tương đương list ⇔ authorize.
4. PEP trong RPC (D8): `assign_unassigned_task`, `patch_task_atomic` (khi đổi assignee/agent/archive), `archive_enrollment_atomic`, import enrollment theo từng dòng.
5. Registration/Dashboard/AI: bảng ánh xạ định danh hoa hồng (Q4) thay khoá tên (sửa gốc S1); tách `registration.*.read` / `.update` (S16, Q23).
6. S2: quyết role nào giữ `task.read:shared_queue` (Q2); gỡ compat D7 khi có câu trả lời.

### Phase E — Frontend

1. Registry điều hướng dùng chung cho `Sidebar.tsx`, `rbac/routes.ts`, guard page, link Settings (TopBar), chuông (hiện cả khi chỉ có Time Off).
2. Props server chỉ chứa phần được phép: /config chỉ nạp scope được quản; danh bạ người tối thiểu (Q19).
3. Editor default dashboard lấy `canEdit` từ policy.
4. Client bỏ tự suy persona; dùng capability hai mức (D9).

### Phase F — Sự kiện & phân phối

1. `recipients.ts`: ứng viên (quan hệ + grant `notify.*` cho 5 nhóm giám sát) → `canReceive` từng người (D17) → payload class → nhóm theo class + nội dung.
2. Chuông kiểm lại active + quyền xem lúc đọc; thông báo cũ sau khi mất quyền hiện dạng rút gọn hay ẩn (Q16).
3. Push mặc định `minimal` nếu Q8 không cho tên khách trên màn hình khoá.
4. Replay 14 ngày lịch sử (read-only) so tập người nhận cũ/mới.
5. Outbox bền: tuỳ chọn, không chặn phase.

### Phase G — Roster/delegation/queue

1. Quản roster + delegation trong chi tiết account; grant `org.agent_roster.manage`, `org.assistant_delegation.manage`; eligibility trong RPC (`create_agent_membership_atomic` + RPC roster mới) theo Q15.
2. `assign_unassigned_task`: bỏ lọc theo tên role/cột legacy (`schema.sql:3679-3710`), dùng grant + `task_assignment_queue_members`.
3. Roster lead: grant/roster thay cho seed theo tên `Health Agent` (Q17).

### Phase H — Gỡ legacy

Bỏ đọc `portal_account.role` (giữ cột chỉ-đọc một release rồi mới xoá); xoá `rbac/system-roles.ts`, `isTaskViewAdmin`, `isLeadViewAdmin`, `compat/*` đã hết hạn, key phẳng; cổng CI cấm so tên role trong TS và SQL; multi-role (Q6) và tenant (Q18) chỉ khi có quyết định.

## I.5 Câu hỏi chặn (chi tiết ở audit §14)

| Chặn | Câu hỏi |
|---|---|
| A5 | **Q21** — @mention/watcher không xem được hồ sơ: bỏ khỏi người nhận (mặc định trong plan này) hay gửi bản rút gọn? |
| A6 | **Q4-tạm** — chấp nhận khoá tự đổi tên hiển thị ở Settings cho tới khi có ánh xạ định danh? |
| A8 | **Q11** — import Enrollment chỉ dành cho task admin (mặc định trong plan này)? |
| B, C | **Q5** (Account/Role Manager có ≡ Admin không), **Q22** (lưới action × scope) |
| D | **Q1, Q2, Q3, Q4, Q23** |
| F | **Q8, Q16, Q20** |
| G | **Q15, Q17** |

---

# Phần II — Phase A: Bịt lỗ khẩn & baseline

## File structure

| File | Trách nhiệm | Task |
|---|---|---|
| `docs/2026-09-26-authz-baseline.md` *(mới)* | Kết quả truy vấn A0 (không ghi secret) | A0 |
| `supabase/rollouts/2026-09-26-rls-lockdown.sql` *(mới)* | Bật RLS + thu quyền anon/authenticated cho các bảng mới | A1 |
| `supabase/schema.sql` | Thêm tên bảng vào `protected_tables` | A1 |
| `src/app/api/admin/roles/[id]/route.ts` (+ `route.test.ts` mới) | Gác vô điều kiện PATCH | A2 |
| `src/app/api/tasks/overview/route.ts` (+ `route.test.ts` mới) | Overview đòi đúng task manager | A3 |
| `src/lib/rbac/access.ts` | `lookupFailed`; `getUserAccessByEmails` (batch) | A4, A5 |
| `src/lib/auth/token-access.ts` *(mới)* (+ test) | Ghép quyền vừa làm mới vào JWT; account khoá → hết phiên | A4 |
| `src/auth.ts` | Dùng `applyRefreshedAccess` | A4 |
| `src/lib/notifications/push-server.ts` (+ test mới) | Chỉ push cho account active; thu hồi subscription | A4 |
| `src/app/api/admin/users/[id]/route.ts` | Khoá/xoá account → thu hồi subscription | A4 |
| `src/lib/enrollment/recipient-access.ts` *(mới)* (+ test) | Lọc người nhận thông báo Enrollment theo quyền xem | A5 |
| `src/lib/tasks/recipient-access.ts` *(mới)* (+ test) | Lọc người nhận `task_created` theo quyền xem | A5 |
| 3 route Enrollment comment/reaction + `src/app/api/tasks/route.ts` | Dùng hai bộ lọc trên | A5 |
| `src/lib/agent-identity.ts` *(mới)* (+ test) | Khoá phạm vi = tên đọc tươi từ DB | A6 |
| 8 page/route Registration/Dashboard/AI | Thay `session.user.name` | A6 |
| `src/app/api/settings/profile/route.ts` (+ test mới), `src/app/(authed)/settings/SettingsClient.tsx` | Khoá tự đổi tên | A6 |
| `src/lib/tasks/roster.ts` *(mới)* (+ test); `src/app/api/tasks/route.ts`; `src/app/api/tasks/[id]/route.ts` | `agent_email` phải thuộc roster | A7 |
| `src/lib/table-config/export-access.ts` (+ test); `src/app/api/enrollment/import/route.ts`; `src/app/(authed)/enrollment/page.tsx` | Import Enrollment chỉ cho task admin | A8 |
| `src/app/api/route-guards.test.ts` *(mới)* | Registry gác route 3 mức + snapshot | A9 |
| `.github/workflows/db-persistence-gate.yml`, `supabase/checks/ci-bootstrap.sql`, `supabase/checks/ci-rls-assert.sql` *(mới)* | Cổng persistence trên Postgres dùng một lần | A10 |

Thứ tự: A0 → (A1 ngay nếu A0 xác nhận lộ) → A2, A3 → A4 → A5 → A6, A7, A8 → A9 → A10.

---

### Task A0: Baseline read-only (chủ repo tự chạy)

**Context:** Các quyết định Phase A và B dựa trên dữ liệu production mà code không cho biết:
- bảng nào đang thật sự mở cho anon key (S0);
- ai giữ quyền gì;
- ai đang rơi vào hàng đợi chung vì "vắng mặt";
- tên hiển thị có trùng không.

Bản kiểm kê gần nhất (`docs/2026-09-04-rbac-role-access-inventory.md`) đã cũ 3 tuần. Tất cả truy vấn dưới đây **chỉ đọc**.

**Files:**
- Create: `docs/2026-09-26-authz-baseline.md`

- [ ] **Step 1: RLS + quyền bảng (S0, D18).** Chạy trong Supabase SQL editor:

```sql
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       g.role_name,
       has_schema_privilege(g.role_name, 'public', 'USAGE') as schema_usage,
       has_table_privilege(g.role_name, c.oid, 'SELECT') as can_select,
       has_table_privilege(g.role_name, c.oid, 'INSERT') as can_insert,
       has_table_privilege(g.role_name, c.oid, 'UPDATE') as can_update,
       has_table_privilege(g.role_name, c.oid, 'DELETE') as can_delete
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('anon'), ('authenticated')) as g(role_name)
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and not c.relrowsecurity
order by c.relname, g.role_name;
```

Expected: mỗi dòng là một bảng **không** bật RLS. Dòng nào `schema_usage = true` và có ít nhất một `can_* = true` thì chuyển sang Step 2 cho bảng đó.

- [ ] **Step 2: Xác nhận qua PostgREST, chỉ đếm (D18).** Chỉ làm cho bảng bị gắn cờ ở Step 1. Chạy ở máy của bạn, `SUPABASE_URL` và `ANON` lấy từ `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`):

```bash
curl -sS -I "$SUPABASE_URL/rest/v1/time_off_requests?select=id" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Prefer: count=exact" -H "Range: 0-0"
```

Expected:
- `HTTP/2 200` kèm header `content-range: 0-0/<số>` → **đang lộ**: làm A1 ngay.
- `401`/`403`/`404`, hoặc body lỗi `42501`/`PGRST` → không lộ qua PostgREST.

Chỉ dùng HEAD với `Range: 0-0`, không tải dữ liệu.

- [ ] **Step 3: Hàm SECURITY DEFINER còn mở.**

```sql
select p.oid::regprocedure as fn,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (has_function_privilege('anon', p.oid, 'execute')
    or has_function_privilege('authenticated', p.oid, 'execute'));
```

Expected: 0 dòng. Có dòng nào thì ghi lại và báo ngay — đó là RPC gọi được bằng anon key, bỏ qua mọi cổng của app.

- [ ] **Step 4: Ma trận role × permission × số người.**

```sql
select r.name as role, r.is_active,
       string_agg(rp.permission_key, ', ' order by rp.permission_key) as permissions,
       (select count(*) from user_roles ur
          join portal_account a on a.id = ur.user_id and a.is_active
         where ur.role_id = r.id) as active_users
from roles r
left join role_permissions rp on rp.role_id = r.id
group by r.id
order by r.name;

select a.email from portal_account a
where a.is_active
  and not exists (select 1 from user_roles ur where ur.user_id = a.id);
```

- [ ] **Step 5: Các nhóm đặc biệt.**

```sql
-- Q1: có task.manage nhưng role không mang tên task-admin và không phải legacy admin
select a.email, r.name as role
from portal_account a
join user_roles ur on ur.user_id = a.id
join roles r on r.id = ur.role_id and r.is_active
join role_permissions rp on rp.role_id = r.id and rp.permission_key = 'task.manage'
where a.is_active and a.role <> 'admin'
  and r.name not in ('Admin', 'Super Admin', 'Admin Health Task', 'Task Admin');

-- S2/D7: người có quyền task nhưng không ở roster, không là assistant, không là task-admin
--        → đang đọc TOÀN BỘ task/enrollment
select a.email, r.name as role
from portal_account a
join user_roles ur on ur.user_id = a.id
join roles r on r.id = ur.role_id and r.is_active
where a.is_active
  and exists (select 1 from role_permissions rp
              where rp.role_id = r.id and rp.permission_key in ('task.work', 'task.manage'))
  and r.name not in ('Admin', 'Super Admin', 'Admin Health Task', 'Task Admin')
  and a.role <> 'admin'
  and not exists (select 1 from task_agents t where lower(t.email) = lower(a.email))
  and not exists (select 1 from agent_members m
                  where lower(m.cs_email) = lower(a.email) and m.is_assistant)
order by r.name, a.email;

-- S6/S16: ai giữ task.import, company.view_all
select rp.permission_key, r.name as role, count(a.id) as active_users
from role_permissions rp
join roles r on r.id = rp.role_id
left join user_roles ur on ur.role_id = r.id
left join portal_account a on a.id = ur.user_id and a.is_active
where rp.permission_key in ('task.import', 'company.view_all')
group by rp.permission_key, r.name
order by 1, 2;

-- S1: tên hiển thị trùng (theo đúng cách normalizeAgentName chuẩn hoá)
select upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) as scope_name,
       count(*) as accounts,
       string_agg(email, ', ') as emails
from portal_account
where is_active and coalesce(btrim(name), '') <> ''
group by 1
having count(*) > 1;

-- S5: task đang mở có agent_email không thuộc roster
select count(*) as tasks_with_unregistered_agent
from tasks t
where t.archived_at is null
  and t.agent_email is not null
  and not exists (select 1 from task_agents a where lower(a.email) = lower(t.agent_email));

-- Q12: role nào chưa có lead.work / timeoff.user
select r.name,
       bool_or(rp.permission_key = 'lead.work') as has_lead_work,
       bool_or(rp.permission_key = 'timeoff.user') as has_timeoff_user
from roles r
left join role_permissions rp on rp.role_id = r.id
where r.is_active
group by r.name
order by r.name;

-- S17: subscription push của account đã khoá
select count(*) as subscriptions_of_inactive_accounts
from push_subscriptions s
join portal_account a on lower(a.email) = lower(s.recipient_email)
where not a.is_active;
```

- [ ] **Step 6: Đo cookie phiên (D5).** Đăng nhập bằng một account role Admin → DevTools → Application → Cookies → ghi độ dài giá trị của `authjs.session-token` (và các `authjs.session-token.N` nếu cookie đã bị chia).

- [ ] **Step 7: Ghi `docs/2026-09-26-authz-baseline.md`** với các mục: `## 1. RLS/quyền bảng`, `## 2. PostgREST`, `## 3. SECURITY DEFINER`, `## 4. Role × permission`, `## 5. Nhóm đặc biệt` (Q1, S2, S6/S16, S1, S5, Q12, S17), `## 6. Cookie`. Không ghi URL, key, token.

- [ ] **Step 8: Cổng quyết định.**
  - Step 1–2 có bảng lộ → làm **A1 trước mọi task khác**.
  - Step 5 có tên trùng → đổi tên cho khác nhau trong Account Manager **trước** khi ship A6.
  - `tasks_with_unregistered_agent > 0` → vẫn làm A7: A7 chỉ kiểm khi `agent_email` được **đặt mới**, không chặn sửa task cũ.

---

### Task A1: Khoá RLS các bảng mới (S0)

**Context:** `schema.sql` bật RLS qua vòng `protected_tables` (`supabase/schema.sql:6203-6270`). Các bảng tạo *sau* vòng đó hoặc chỉ có trong rollout thì không nằm trong danh sách. Server dùng service role (bỏ qua RLS) nên bật RLS **không** đổi hành vi app. Trình duyệt chỉ dùng anon key cho Realtime broadcast, không đọc bảng. Rollback **không** được mở lại quyền (D13).

**Files:**
- Create: `supabase/rollouts/2026-09-26-rls-lockdown.sql`
- Modify: `supabase/schema.sql` (mảng `protected_tables`)

- [ ] **Step 1: Viết rollout**

```sql
-- =====================================================================
-- Khoá RLS cho các bảng tạo sau vòng protected_tables của schema.sql
-- (audit 2026-09-25, S0).
--
-- Server dùng service role (BYPASSRLS) nên app không đổi hành vi. Trình duyệt
-- chỉ dùng anon key cho Realtime broadcast, không đọc bảng.
--
-- KHÔNG có bản "đảo ngược" của file này: mở lại quyền là mở lại lỗ hổng.
-- Nếu có chức năng hỏng, sửa chức năng đó chứ không nới bảng.
--
-- Idempotent. Bảng chưa tồn tại thì bỏ qua.
-- =====================================================================
begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    'time_off_policies',
    'time_off_balances',
    'time_off_balance_adjustments',
    'time_off_balance_adjustment_batches',
    'time_off_holidays',
    'time_off_requests',
    'time_off_monthly_accrual_rules',
    'time_off_notifications',
    'push_subscriptions',
    'notification_preferences',
    'task_comment_edits',
    'zipcode_lookup',
    'provider_directory',
    'sheet_sync_runs',
    'sheet_sync_staging'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

commit;

-- Kiểm chứng: phải trả 0 dòng.
select c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and not c.relrowsecurity
  and (has_table_privilege('anon', c.oid, 'SELECT')
    or has_table_privilege('anon', c.oid, 'INSERT')
    or has_table_privilege('anon', c.oid, 'UPDATE')
    or has_table_privilege('anon', c.oid, 'DELETE')
    or has_table_privilege('authenticated', c.oid, 'SELECT')
    or has_table_privilege('authenticated', c.oid, 'INSERT')
    or has_table_privilege('authenticated', c.oid, 'UPDATE')
    or has_table_privilege('authenticated', c.oid, 'DELETE'));
```

- [ ] **Step 2: Thêm tên bảng vào `protected_tables` trong `schema.sql`.** Tìm dòng cuối của mảng:

```sql
    'enrollment_queue_members',
    'enrollment_overview_settings'
  ];
```

và thay bằng:

```sql
    'enrollment_queue_members',
    'enrollment_overview_settings',
    -- Thêm 2026-09-26 (S0). Các bảng chỉ có trong rollout sẽ được bỏ qua ở đây
    -- (to_regclass null) và khoá bởi rollouts/2026-09-26-rls-lockdown.sql.
    'time_off_policies',
    'time_off_balances',
    'time_off_balance_adjustments',
    'time_off_balance_adjustment_batches',
    'time_off_holidays',
    'time_off_requests',
    'time_off_monthly_accrual_rules',
    'time_off_notifications',
    'push_subscriptions',
    'notification_preferences',
    'task_comment_edits',
    'zipcode_lookup',
    'sheet_sync_runs',
    'sheet_sync_staging'
  ];
```

Vòng lặp này chỉ `enable row level security`. Phần `revoke` nằm trong rollout và được kiểm bởi A10.

- [ ] **Step 3: Chủ repo chạy rollout trên production** trong SQL editor. Expected: câu kiểm chứng cuối trả **0 dòng**. Chạy lại Step 2 của A0 cho các bảng từng bị gắn cờ → expected không còn `200`.

- [ ] **Step 4: Kiểm tay app:** mở Time Off (nộp đơn, duyệt), Settings → bật push, bình luận một task rồi sửa bình luận. Expected: mọi thao tác chạy như trước (service role không bị RLS chặn).

- [ ] **Step 5: Changelog** — thêm trên cùng `changelog.md`:

```markdown
## 2026-09-26 — Khoá RLS cho các bảng tạo sau vòng protected_tables (S0)

`time_off_*`, `push_subscriptions`, `notification_preferences`, `task_comment_edits`,
`zipcode_lookup`, `provider_directory`, `sheet_sync_*` chưa từng được bật RLS: chúng tạo
sau vòng `protected_tables` của `schema.sql` hoặc chỉ có trong rollout. Anon key nằm
công khai trong trình duyệt, nên nếu grant mặc định của Supabase còn thì ai cũng gọi
PostgREST đọc/ghi được. Rollout `2026-09-26-rls-lockdown.sql` bật RLS và thu quyền
anon/authenticated. App không đổi hành vi vì server dùng service role. Không có bản
đảo ngược — mở lại quyền là mở lại lỗ hổng.
```

- [ ] **Step 6: Commit** (chỉ khi đã được cho phép)

```bash
git add supabase/rollouts/2026-09-26-rls-lockdown.sql supabase/schema.sql changelog.md
git commit -m "fix(db): khoá RLS cho bảng time_off, push và task_comment_edits"
```

---

### Task A2: Gác vô điều kiện `PATCH /api/admin/roles/[id]` (S18)

**Context:** Handler hiện chỉ kiểm `management.role_manager` *bên trong* từng nhánh field (`name`, `description`, `is_active`, `permissionKeys`). Body rỗng `{}` lọt qua mọi nhánh, gọi `fetchRoleById` rồi trả về `fetchRolesWithPermissions()`: toàn bộ danh mục role, permission và số người, cho **bất kỳ ai đã đăng nhập** mà biết một role UUID. Sửa bằng một cổng ở đầu handler; các cổng lặp trong từng nhánh bỏ đi. Mã lỗi giữ 401 như các nhánh cũ; hợp đồng 401/403 sẽ thống nhất ở Phase B.

**Files:**
- Modify: `src/app/api/admin/roles/[id]/route.ts`
- Test: `src/app/api/admin/roles/[id]/route.test.ts` *(mới)*

**Interfaces:** Không đổi chữ ký route.

- [ ] **Step 1: Viết test thất bại**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, roleManagement } = vi.hoisted(() => ({
  authMock: vi.fn(),
  roleManagement: {
    fetchRoleById: vi.fn(),
    fetchRolesWithPermissions: vi.fn(),
    replaceRolePermissions: vi.fn(),
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("test này không được chạm database");
  },
}));
vi.mock("@/lib/rbac/role-management", () => roleManagement);

const { PATCH } = await import("./route");

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/admin/roles/r1", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "r1" }) }
  );
}

describe("PATCH /api/admin/roles/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("body rỗng từ người không có role_manager: 401 và không đọc danh mục role", async () => {
    authMock.mockResolvedValue({
      user: { email: "cs@x.com", permissions: ["task.work"] },
    });

    const response = await patch({});

    expect(response.status).toBe(401);
    expect(roleManagement.fetchRoleById).not.toHaveBeenCalled();
    expect(roleManagement.fetchRolesWithPermissions).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập: 401", async () => {
    authMock.mockResolvedValue(null);

    const response = await patch({});

    expect(response.status).toBe(401);
    expect(roleManagement.fetchRolesWithPermissions).not.toHaveBeenCalled();
  });

  it("role_manager vẫn PATCH rỗng để đọc lại được", async () => {
    authMock.mockResolvedValue({
      user: { email: "admin@x.com", permissions: ["management.role_manager"] },
    });
    roleManagement.fetchRoleById.mockResolvedValue({ id: "r1", name: "Task CS" });
    roleManagement.fetchRolesWithPermissions.mockResolvedValue([{ id: "r1", name: "Task CS" }]);

    const response = await patch({});

    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `npx vitest run "src/app/api/admin/roles/[id]/route.test.ts"`
Expected: FAIL ở test đầu — nhận 200 thay vì 401.

- [ ] **Step 3: Sửa route.** Trong `PATCH`, thay:

```ts
export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();

  try {
```

bằng:

```ts
export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();

  // Gác VÔ ĐIỀU KIỆN trước mọi tra cứu. Trước đây quyền chỉ được kiểm trong
  // từng nhánh field, nên một PATCH body rỗng lọt qua hết các nhánh và trả về
  // toàn bộ danh mục role + permission cho bất kỳ ai đã đăng nhập (S18).
  if (!can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
```

Rồi xoá **bốn** khối kiểm lặp (cổng đầu đã bao hết):
- trong nhánh `if (payload.name !== undefined) {` — xoá
  ```ts
      if (!can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
  ```
- khối giống hệt trong nhánh `if (payload.description !== undefined) {`;
- khối giống hệt trong nhánh `if (payload.is_active !== undefined) {`;
- khối
  ```ts
    if (
      permissionKeys &&
      !can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  ```

- [ ] **Step 4: Chạy test để thấy qua**

Run: `npx vitest run "src/app/api/admin/roles/[id]/route.test.ts"`
Expected: PASS 3/3.

- [ ] **Step 5: Changelog**

```markdown
## 2026-09-26 — PATCH /api/admin/roles/[id] gác quyền vô điều kiện (S18)

Quyền `management.role_manager` trước đây chỉ được kiểm trong từng nhánh field, nên
PATCH body rỗng trả về toàn bộ danh mục role + permission + số người cho bất kỳ ai
đã đăng nhập. Nay có một cổng ở đầu handler; các cổng lặp trong từng nhánh bị bỏ.
```

- [ ] **Step 6: Commit** (chỉ khi đã được cho phép)

```bash
git add "src/app/api/admin/roles/[id]/route.ts" "src/app/api/admin/roles/[id]/route.test.ts" changelog.md
git commit -m "fix(rbac): PATCH role gác role_manager trước mọi tra cứu"
```

---

### Task A3: Overview đòi đúng task manager (S8)

**Context:** `GET /api/tasks/overview` chỉ gọi `isTaskViewAdmin(session.user)` — một phép thử **tên role** — mà không đòi `task.manage`. Client chỉ hiện Overview khi `actor.isManager` (`task.manage` **và** tên role, `src/lib/tasks/access.ts:38-51`). Sửa để API dùng đúng luật đó. Theo snapshot 04/09, 8/8 người có `task.manage` đều là manager, nên không ai đang dùng Overview bị mất quyền; xác nhận bằng A0 Step 5 (Q1).

**Files:**
- Modify: `src/app/api/tasks/overview/route.ts`
- Test: `src/app/api/tasks/overview/route.test.ts` *(mới)*

- [ ] **Step 1: Viết test thất bại**

```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, fetchTaskOverviewMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  fetchTaskOverviewMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/tasks/overview-data", () => ({ fetchTaskOverview: fetchTaskOverviewMock }));

const { GET } = await import("./route");

const request = () => new NextRequest("http://localhost/api/tasks/overview");

describe("GET /api/tasks/overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTaskOverviewMock.mockResolvedValue({ ok: true });
  });

  it("tên role task-admin mà thiếu task.manage: 403", async () => {
    authMock.mockResolvedValue({
      user: { email: "x@x.com", role: "agent", roles: ["Task Admin"], permissions: [] },
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(fetchTaskOverviewMock).not.toHaveBeenCalled();
  });

  it("task.manage mà role không phải task-admin: 403", async () => {
    authMock.mockResolvedValue({
      user: { email: "x@x.com", role: "agent", roles: ["Task CS"], permissions: ["task.manage"] },
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
  });

  it("task manager thật: 200", async () => {
    authMock.mockResolvedValue({
      user: {
        email: "x@x.com",
        role: "agent",
        roles: ["Admin Health Task"],
        permissions: ["task.manage"],
      },
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(fetchTaskOverviewMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `npx vitest run src/app/api/tasks/overview/route.test.ts`
Expected: FAIL ở test đầu (200 thay vì 403).

- [ ] **Step 3: Sửa route.** Thay:

```ts
import { isTaskViewAdmin } from "@/lib/tasks/access";
```

bằng:

```ts
import { buildTaskActor, isTaskViewAdmin } from "@/lib/tasks/access";
```

và thay:

```ts
  if (!isTaskViewAdmin(session.user)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
```

bằng:

```ts
  // Cùng luật với Overview trên client (actor.isManager = task.manage VÀ vai trò
  // task-admin). Trước đây API chỉ hỏi tên role, nên role tên "Task Admin" không
  // có task.manage vẫn đọc được workload của mọi người (S8).
  const actor = buildTaskActor(session.user.permissions, session.user.email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!actor.isManager) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
```

- [ ] **Step 4: Chạy test để thấy qua**

Run: `npx vitest run src/app/api/tasks/overview/route.test.ts`
Expected: PASS 3/3.

- [ ] **Step 5: Changelog**

```markdown
## 2026-09-26 — /api/tasks/overview đòi task.manage (S8)

API Overview chỉ kiểm tên role (`isTaskViewAdmin`), trong khi client chỉ hiện Overview
cho `actor.isManager` (`task.manage` VÀ vai trò task-admin). Nay API dùng đúng luật
của client.
```

- [ ] **Step 6: Commit** (chỉ khi đã được cho phép)

```bash
git add src/app/api/tasks/overview/route.ts src/app/api/tasks/overview/route.test.ts changelog.md
git commit -m "fix(tasks): Overview API đòi task manager như client"
```

---

### Task A4: Account bị khoá mất phiên và thôi nhận push (S17)

**Context:** Hiện có hai lỗ:

1. Khi làm mới quyền (`src/auth.ts`, mỗi 5 phút), account bị khoá chỉ bị rút permission; phiên vẫn còn nguyên email. Chuông (`api/tasks/notifications/route.ts` — chỉ kiểm email), đăng ký push và avatar vẫn hoạt động cho tới khi cookie hết hạn (mặc định 30 ngày).
2. Push gửi theo email mà không kiểm account còn active; subscription của người nghỉ việc còn nguyên.

Auth.js v5 hỗ trợ callback `jwt` trả `null` để kết thúc phiên (`node_modules/@auth/core/lib/actions/session.js`: `token === null` → `sessionStore.clean()`; kiểu trả về `Awaitable<JWT | null>`). Cần phân biệt "account khoá/xoá" (→ `null`) với "truy vấn lỗi" (→ giữ phiên nhưng rút quyền và **không** đánh dấu đã làm mới, để request sau thử lại). Nếu không, một sự cố DB nhỏ sẽ đăng xuất mọi người.

**Files:**
- Modify: `src/lib/rbac/access.ts`
- Create: `src/lib/auth/token-access.ts`, `src/lib/auth/token-access.test.ts`
- Modify: `src/auth.ts`
- Modify: `src/lib/notifications/push-server.ts`
- Create: `src/lib/notifications/push-server.test.ts`
- Modify: `src/app/api/admin/users/[id]/route.ts`

**Interfaces:**
- Produces:
  - `UserAccess.lookupFailed: boolean`
  - `applyRefreshedAccess(token: JWT, access: UserAccess, now: number): JWT | null`
  - `filterActiveAccounts(emails: readonly string[]): Promise<string[]>`
  - `revokePushSubscriptions(email: string): Promise<void>`

- [ ] **Step 1: Thêm `lookupFailed` vào `UserAccess`** (`src/lib/rbac/access.ts`). Trong type `UserAccess`, sau `agentId: string | null;` thêm:

```ts
  /** true khi truy vấn quyền LỖI — khác với "không có account". */
  lookupFailed: boolean;
```

Trong `flattenAccess`, cả hai `return` thêm `lookupFailed: false`:

```ts
  if (row.is_active === false) {
    return { userId: row.id, legacyRole, roles: [], permissions: [], isActive: false, agentId: row.agent_id ?? null, lookupFailed: false };
  }
```

và thêm `lookupFailed: false,` vào object trả về cuối hàm (sau `agentId: row.agent_id ?? null,`).

Trong `getUserAccessByEmail`, thay:

```ts
  if (error || !data) {
    return { userId: null, legacyRole: "agent", roles: [], permissions: [], isActive: false, agentId: null };
  }
```

bằng:

```ts
  if (error) {
    return { userId: null, legacyRole: "agent", roles: [], permissions: [], isActive: false, agentId: null, lookupFailed: true };
  }
  if (!data) {
    return { userId: null, legacyRole: "agent", roles: [], permissions: [], isActive: false, agentId: null, lookupFailed: false };
  }
```

- [ ] **Step 2: Viết test thất bại** `src/lib/auth/token-access.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { UserAccess } from "@/lib/rbac/access";
import { applyRefreshedAccess } from "./token-access";

const base: UserAccess = {
  userId: "u1",
  legacyRole: "agent",
  roles: ["Task CS"],
  permissions: ["task.work"],
  isActive: true,
  agentId: "EPS1",
  lookupFailed: false,
};
const token = {
  email: "a@x.com",
  roles: ["Old"],
  permissions: ["old.perm"],
  rbacRefreshedAt: 1,
};

describe("applyRefreshedAccess", () => {
  it("account active: ghi quyền mới và đánh dấu thời điểm làm mới", () => {
    expect(applyRefreshedAccess(token, base, 500)).toMatchObject({
      roles: ["Task CS"],
      permissions: ["task.work"],
      agentId: "EPS1",
      rbacRefreshedAt: 500,
    });
  });

  it("account bị khoá: kết thúc phiên", () => {
    expect(applyRefreshedAccess(token, { ...base, isActive: false }, 500)).toBeNull();
  });

  it("account đã xoá (không có dòng, không lỗi): kết thúc phiên", () => {
    expect(
      applyRefreshedAccess(token, { ...base, userId: null, isActive: false }, 500)
    ).toBeNull();
  });

  it("truy vấn lỗi: giữ phiên, rút quyền, KHÔNG đánh dấu đã làm mới", () => {
    const result = applyRefreshedAccess(
      token,
      { ...base, isActive: false, lookupFailed: true },
      500
    );
    expect(result).toMatchObject({ roles: [], permissions: [], rbacRefreshedAt: 1 });
  });
});
```

- [ ] **Step 3: Chạy test để thấy thất bại**

Run: `npx vitest run src/lib/auth/token-access.test.ts`
Expected: FAIL — "Failed to resolve import ./token-access".

- [ ] **Step 4: Viết `src/lib/auth/token-access.ts`**

```ts
import type { JWT } from "next-auth/jwt";
import type { UserAccess } from "@/lib/rbac/access";

/**
 * Ghép quyền vừa làm mới vào JWT.
 *
 * Account bị khoá hoặc đã xoá → `null`. Auth.js hiểu `null` là kết thúc phiên
 * (`@auth/core/lib/actions/session.js`: token === null → xoá cookie), và `auth()`
 * trả về null → mọi route coi như chưa đăng nhập. Trước đây phiên vẫn sống với
 * email nên chuông, đăng ký push và avatar vẫn chạy tới khi cookie hết hạn (S17).
 *
 * Truy vấn LỖI thì khác: giữ phiên nhưng rút hết quyền cho request này, và KHÔNG
 * đánh dấu đã làm mới để request sau thử lại. Coi lỗi là "đã khoá" thì một sự cố
 * database vài giây đăng xuất toàn công ty.
 */
export function applyRefreshedAccess(
  token: JWT,
  access: UserAccess,
  now: number
): JWT | null {
  if (access.lookupFailed) {
    return { ...token, role: "agent", roles: [], permissions: [] };
  }
  if (!access.isActive) return null;
  return {
    ...token,
    role: access.legacyRole,
    roles: access.roles,
    permissions: access.permissions,
    agentId: access.agentId,
    rbacRefreshedAt: now,
  };
}
```

- [ ] **Step 5: Chạy test để thấy qua**

Run: `npx vitest run src/lib/auth/token-access.test.ts src/lib/rbac/access.test.ts`
Expected: PASS.

- [ ] **Step 6: Nối vào `src/auth.ts`.** Thêm import cạnh các import `@/lib/rbac/access`:

```ts
import { applyRefreshedAccess } from "@/lib/auth/token-access";
```

Trong callback `jwt`, thay:

```ts
      if (token.email && shouldRefreshRbac) {
        const access = await getUserAccessByEmail(token.email);
        if (access.isActive) {
          token.role = access.legacyRole;
          token.roles = access.roles;
          token.permissions = access.permissions;
        } else {
          token.role = "agent";
          token.roles = [];
          token.permissions = [];
        }
        token.agentId = access.agentId;
        token.rbacRefreshedAt = Date.now();
      }

      return token;
```

bằng:

```ts
      if (token.email && shouldRefreshRbac) {
        const access = await getUserAccessByEmail(token.email);
        return applyRefreshedAccess(token, access, Date.now());
      }

      return token;
```

- [ ] **Step 7: Viết test thất bại cho push** `src/lib/notifications/push-server.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => supabaseMock }));

const { filterActiveAccounts, revokePushSubscriptions } = await import("./push-server");

describe("filterActiveAccounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("chỉ giữ email của account còn active, không phân biệt hoa thường", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ email: "A@x.com" }], error: null }),
    };
    supabaseMock.from.mockReturnValue(query);

    await expect(filterActiveAccounts(["a@x.com", "gone@x.com"])).resolves.toEqual(["a@x.com"]);
    expect(supabaseMock.from).toHaveBeenCalledWith("portal_account");
    expect(query.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("truy vấn lỗi thì không gửi cho ai (chuông vẫn còn)", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    };
    supabaseMock.from.mockReturnValue(query);

    await expect(filterActiveAccounts(["a@x.com"])).resolves.toEqual([]);
  });
});

describe("revokePushSubscriptions", () => {
  it("xoá mọi subscription theo email đã chuẩn hoá", async () => {
    const query = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    supabaseMock.from.mockReturnValue(query);

    await revokePushSubscriptions("  Ann@X.com ");

    expect(supabaseMock.from).toHaveBeenCalledWith("push_subscriptions");
    expect(query.eq).toHaveBeenCalledWith("recipient_email", "ann@x.com");
  });
});
```

- [ ] **Step 8: Chạy test để thấy thất bại**

Run: `npx vitest run src/lib/notifications/push-server.test.ts`
Expected: FAIL — `filterActiveAccounts is not a function`.

- [ ] **Step 9: Sửa `push-server.ts`.** Thêm hai hàm export ngay trước `export async function sendPushToEmails`:

```ts
/**
 * Chỉ giữ người nhận có account CÒN hoạt động.
 *
 * Đọc cả danh sách account active (vài chục dòng) rồi lọc trong bộ nhớ để so
 * không phân biệt hoa thường. Lỗi truy vấn → không gửi cho ai: thà thiếu một
 * push (chuông vẫn còn) còn hơn đẩy tên khách hàng tới điện thoại của người đã
 * nghỉ việc (S17).
 */
export async function filterActiveAccounts(emails: readonly string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("email")
    .eq("is_active", true);
  if (error) return [];
  const active = new Set(
    ((data ?? []) as { email: string }[]).map((row) => normalizeEmail(row.email))
  );
  return emails.filter((email) => active.has(normalizeEmail(email)));
}

/** Xoá mọi máy đã đăng ký push của một người — gọi khi khoá hoặc xoá account. */
export async function revokePushSubscriptions(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  const { error } = await getSupabaseAdmin()
    .from("push_subscriptions")
    .delete()
    .eq("recipient_email", normalized);
  if (error) throw new Error(error.message);
}
```

Trong `sendPushToEmails`, thay:

```ts
    const unique = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
    const allowed = await filterByPreference(unique);
```

bằng:

```ts
    const unique = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
    const active = await filterActiveAccounts(unique);
    const allowed = await filterByPreference(active);
```

- [ ] **Step 10: Chạy test để thấy qua**

Run: `npx vitest run src/lib/notifications/push-server.test.ts`
Expected: PASS 3/3.

- [ ] **Step 11: Thu hồi subscription khi khoá/xoá account** (`src/app/api/admin/users/[id]/route.ts`). Thêm import:

```ts
import { revokePushSubscriptions } from "@/lib/notifications/push-server";
```

Trong `PATCH`, ngay sau khối:

```ts
    if (!selectedRoleIds && updates.role) {
      await supabase.from("user_roles").delete().eq("user_id", id);
      await assignDefaultRoleToUser(id, updates.role);
    }
```

thêm:

```ts
    if (updates.is_active === false) {
      // Khoá account thì máy của người đó thôi nhận push ngay, không đợi
      // subscription tự hết hạn. Lỗi ở đây không làm hỏng việc khoá: phiên đã
      // bị chặn ở lần làm mới quyền kế tiếp và push đã lọc account active.
      await revokePushSubscriptions(targetUser.email).catch((revokeError) => {
        console.error("[account-manager:update] push revoke failed", {
          userId: id,
          error: revokeError instanceof Error ? revokeError.message : String(revokeError),
        });
      });
    }
```

Trong `DELETE`, ngay sau khối kiểm `deleteError`:

```ts
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
```

thêm:

```ts
    await revokePushSubscriptions(targetUser.email).catch((revokeError) => {
      console.error("[account-manager:delete] push revoke failed", {
        userId: id,
        error: revokeError instanceof Error ? revokeError.message : String(revokeError),
      });
    });
```

- [ ] **Step 12: Kiểm tra toàn bộ**

Run: `npm run typecheck && npx vitest run src/lib/auth src/lib/rbac src/lib/notifications`
Expected: typecheck không lỗi; test PASS. Nếu typecheck báo chỗ nào dựng `UserAccess` bằng literal mà thiếu `lookupFailed`, thêm `lookupFailed: false` vào đúng chỗ đó.

- [ ] **Step 13: Kiểm tay:**
  1. Đăng nhập account thử A ở trình duyệt 1.
  2. Admin khoá A ở trình duyệt 2.
  3. Đợi tối đa 5 phút, reload trang ở trình duyệt 1.

  Expected: A bị đưa về `/signin`; bảng `push_subscriptions` không còn dòng của A.

- [ ] **Step 14: Changelog**

```markdown
## 2026-09-26 — Account bị khoá mất phiên và thôi nhận push (S17)

Trước đây khoá account chỉ rút permission khi làm mới quyền; phiên vẫn sống với email
nên chuông thông báo, đăng ký push và avatar vẫn chạy tới khi cookie hết hạn (30 ngày).
Nay callback `jwt` trả `null` (Auth.js kết thúc phiên) khi account bị khoá hoặc đã xoá.
Lỗi truy vấn thì giữ phiên, rút quyền và thử lại ở request sau — không đăng xuất cả
công ty vì một sự cố DB. Push chỉ gửi cho account active; khoá/xoá account thì xoá
subscription.
```

- [ ] **Step 15: Commit** (chỉ khi đã được cho phép)

```bash
git add src/lib/rbac/access.ts src/lib/auth/token-access.ts src/lib/auth/token-access.test.ts src/auth.ts src/lib/notifications/push-server.ts src/lib/notifications/push-server.test.ts "src/app/api/admin/users/[id]/route.ts" changelog.md
git commit -m "fix(auth): account bị khoá mất phiên, thôi nhận push"
```

---

### Task A5: Người nhận thông báo phải mở được bản ghi (S15, S27)

**Context:**
- **Enrollment:** @mention nhận bất kỳ account active nào (`api/enrollment/[id]/comments/route.ts:123-135` chỉ lọc `is_active`). Người từng bình luận ("thread watchers") vẫn nhận dù đã ra khỏi scope. Hệ quả: một người Accounting được nhắc tên sẽ nhận thông báo kèm tên khách (chuông + push), trong khi mở hồ sơ thì 404.
- **Task:** `task_created` gửi cho mọi người giữ `task.manage` (`tasks/membership.ts:204-254`), kể cả người không xem được task. Theo snapshot 04/09 hiện chưa có ai như vậy, nhưng chỉ cần một role tuỳ chỉnh là lộ.

Quyết định mặc định (Q21): **bỏ** người không xem được khỏi danh sách nhận; không gửi bản rút gọn. Muốn gửi bản rút gọn thì làm ở Phase F.

Ở Task, @mention **cố ý** cấp quyền xem (người được nhắc thành participant), nên không lọc mention của Task.

**Files:**
- Modify: `src/lib/rbac/access.ts` (thêm `getUserAccessByEmails`)
- Create: `src/lib/enrollment/recipient-access.ts`, `src/lib/enrollment/recipient-access.test.ts`
- Create: `src/lib/tasks/recipient-access.ts`, `src/lib/tasks/recipient-access.test.ts`
- Modify: `src/app/api/enrollment/[id]/comments/route.ts`
- Modify: `src/app/api/enrollment/[id]/comments/[cid]/route.ts`
- Modify: `src/app/api/enrollment/[id]/comments/[cid]/reactions/route.ts`
- Modify: `src/app/api/tasks/route.ts`

**Interfaces:**
- Consumes: `UserAccess.lookupFailed` (A4), `flattenAccess`.
- Produces:
  - `getUserAccessByEmails(emails: readonly string[]): Promise<Map<string, UserAccess>>` — khoá là email chữ thường; ném lỗi khi truy vấn lỗi.
  - `filterEnrollmentRecipientsWithAccess(record, emails): Promise<string[]>`
  - `filterTaskRecipientsWithAccess(task, assigneeEmails, emails): Promise<string[]>`

- [ ] **Step 1: Thêm hàm batch** vào cuối `src/lib/rbac/access.ts` (trước `assignDefaultRoleToUser`):

```ts
/**
 * Quyền của nhiều account trong MỘT truy vấn — dùng khi lọc người nhận thông
 * báo. Khoá của Map là email chữ thường. Ném lỗi khi truy vấn lỗi để nơi gọi
 * fail-closed (không gửi) thay vì gửi mò.
 */
export async function getUserAccessByEmails(
  emails: readonly string[]
): Promise<Map<string, UserAccess>> {
  const unique = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const result = new Map<string, UserAccess>();
  if (unique.length === 0) return result;

  const { data, error } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .select(
      "id,email,role,is_active,agent_id,user_roles(roles(id,name,is_active,role_permissions(permission_key)))"
    )
    .in("email", unique);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as unknown as (AccessRow & { email: string })[]) {
    result.set(row.email.trim().toLowerCase(), flattenAccess(row));
  }
  return result;
}
```

- [ ] **Step 2: Viết test thất bại** `src/lib/enrollment/recipient-access.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccess } from "@/lib/rbac/access";

const { accessMock, resolveScopeMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  resolveScopeMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("test này không được chạm database");
  },
}));
vi.mock("@/lib/rbac/access", () => ({ getUserAccessByEmails: accessMock }));
vi.mock("./scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scope")>();
  return { ...actual, resolveEnrollmentScope: resolveScopeMock };
});

const { filterEnrollmentRecipientsWithAccess } = await import("./recipient-access");

const record = {
  agent_email: "agent.a@x.com",
  caller_email: "caller@x.com",
  responsible_enroll_email: null,
  created_by_email: "creator@x.com",
};

function access(overrides: Partial<UserAccess> = {}): UserAccess {
  return {
    userId: "u",
    legacyRole: "agent",
    roles: ["Task CS"],
    permissions: ["task.work"],
    isActive: true,
    agentId: null,
    lookupFailed: false,
    ...overrides,
  };
}

describe("filterEnrollmentRecipientsWithAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bỏ account khoá, account không có quyền task, và người ngoài scope", async () => {
    accessMock.mockResolvedValue(
      new Map([
        ["plain.cs@x.com", access()],
        ["locked@x.com", access({ isActive: false })],
        ["accounting@x.com", access({ roles: ["Accounting"], permissions: ["company_dashboard.health"] })],
        ["agent.b@x.com", access({ roles: ["Health Agent"] })],
      ])
    );
    resolveScopeMock.mockImplementation(async (actor: { email: string }) =>
      actor.email === "plain.cs@x.com"
        ? { seeAll: true }
        : { seeAll: false, agentEmails: ["agent.b@x.com"], viewerEmail: actor.email }
    );

    const result = await filterEnrollmentRecipientsWithAccess(record, [
      "Plain.CS@x.com",
      "locked@x.com",
      "accounting@x.com",
      "agent.b@x.com",
      "unknown@x.com",
    ]);

    expect(result).toEqual(["plain.cs@x.com"]);
  });

  it("giữ người được giao trực tiếp dù scope theo agent không khớp", async () => {
    accessMock.mockResolvedValue(new Map([["caller@x.com", access()]]));
    resolveScopeMock.mockResolvedValue({
      seeAll: false,
      agentEmails: ["someone.else@x.com"],
      viewerEmail: "caller@x.com",
    });

    await expect(
      filterEnrollmentRecipientsWithAccess(record, ["caller@x.com"])
    ).resolves.toEqual(["caller@x.com"]);
  });

  it("danh sách rỗng không truy vấn gì", async () => {
    await expect(filterEnrollmentRecipientsWithAccess(record, ["", "  "])).resolves.toEqual([]);
    expect(accessMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Chạy test để thấy thất bại**

Run: `npx vitest run src/lib/enrollment/recipient-access.test.ts`
Expected: FAIL — không resolve được `./recipient-access`.

- [ ] **Step 4: Viết `src/lib/enrollment/recipient-access.ts`**

```ts
import { getUserAccessByEmails } from "@/lib/rbac/access";
import { buildTaskActor, canAccessBoard, isTaskViewAdmin } from "@/lib/tasks/access";
import { isRecordInScope, resolveEnrollmentScope } from "./scope";
import type { EnrollmentRecordWithStats } from "./types";

type ScopedRecord = Pick<
  EnrollmentRecordWithStats,
  "agent_email" | "caller_email" | "responsible_enroll_email" | "created_by_email"
>;

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Chỉ giữ những người nhận MỞ ĐƯỢC hồ sơ này, theo đúng luật của trang
 * Enrollment: account active, có quyền vào board, và hồ sơ nằm trong scope
 * (`resolveEnrollmentScope` + `isRecordInScope`).
 *
 * Trước đây @mention nhận bất kỳ account active nào, nên một người Accounting
 * được nhắc tên nhận thông báo kèm tên khách hàng trong khi mở hồ sơ thì 404
 * (S15). Trả về email chữ thường, theo thứ tự đầu vào, đã khử trùng.
 */
export async function filterEnrollmentRecipientsWithAccess(
  record: ScopedRecord,
  emails: readonly (string | null | undefined)[]
): Promise<string[]> {
  const unique = [...new Set(emails.map(normalize).filter(Boolean))];
  if (unique.length === 0) return [];

  const accessByEmail = await getUserAccessByEmails(unique);
  const decisions = await Promise.all(
    unique.map(async (email) => {
      const access = accessByEmail.get(email);
      if (!access || !access.isActive) return false;
      const actor = buildTaskActor(access.permissions, email, {
        isAdmin: isTaskViewAdmin({ role: access.legacyRole, roles: access.roles }),
      });
      if (!canAccessBoard(actor)) return false;
      const scope = await resolveEnrollmentScope(actor);
      return isRecordInScope(scope, record);
    })
  );
  return unique.filter((_, index) => decisions[index]);
}
```

- [ ] **Step 5: Chạy test để thấy qua**

Run: `npx vitest run src/lib/enrollment/recipient-access.test.ts`
Expected: PASS 3/3.

- [ ] **Step 6: Viết test thất bại** `src/lib/tasks/recipient-access.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccess } from "@/lib/rbac/access";

const { accessMock, ownerMock, queueScopeMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  ownerMock: vi.fn(),
  queueScopeMock: vi.fn(),
}));

vi.mock("@/lib/rbac/access", () => ({ getUserAccessByEmails: accessMock }));
vi.mock("./membership", () => ({
  isAgentOwnerOrAssistant: ownerMock,
  resolveTaskQueueScope: queueScopeMock,
}));

const { filterTaskRecipientsWithAccess } = await import("./recipient-access");

function access(overrides: Partial<UserAccess> = {}): UserAccess {
  return {
    userId: "u",
    legacyRole: "agent",
    roles: ["Task CS"],
    permissions: ["task.work"],
    isActive: true,
    agentId: null,
    lookupFailed: false,
    ...overrides,
  };
}

const task = { agent_email: "agent.a@x.com", reporter_email: "reporter@x.com" };

describe("filterTaskRecipientsWithAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerMock.mockResolvedValue(false);
    queueScopeMock.mockResolvedValue({ agentEmails: [], assistantAgentEmails: [], seesAllTasks: false });
  });

  it("giữ task manager, bỏ người giữ task.manage mà không xem được task", async () => {
    accessMock.mockResolvedValue(
      new Map([
        ["boss@x.com", access({ roles: ["Admin Health Task"], permissions: ["task.manage"] })],
        ["scoped.manage@x.com", access({ roles: ["Custom"], permissions: ["task.manage"] })],
      ])
    );

    await expect(
      filterTaskRecipientsWithAccess(task, [], ["boss@x.com", "scoped.manage@x.com"])
    ).resolves.toEqual(["boss@x.com"]);
  });

  it("giữ assistant của agent và CS thường thấy hàng đợi chung", async () => {
    accessMock.mockResolvedValue(
      new Map([
        ["assistant@x.com", access()],
        ["plain@x.com", access()],
      ])
    );
    ownerMock.mockImplementation(async (_agent: string, email: string) => email === "assistant@x.com");
    queueScopeMock.mockImplementation(async (actor: { email: string }) => ({
      agentEmails: [],
      assistantAgentEmails: [],
      seesAllTasks: actor.email === "plain@x.com",
    }));

    await expect(
      filterTaskRecipientsWithAccess(task, [], ["assistant@x.com", "plain@x.com"])
    ).resolves.toEqual(["assistant@x.com", "plain@x.com"]);
  });

  it("bỏ account khoá và account không có quyền task", async () => {
    accessMock.mockResolvedValue(
      new Map([
        ["locked@x.com", access({ isActive: false, roles: ["Admin"], permissions: ["task.manage"] })],
        ["lead.only@x.com", access({ roles: ["Lead"], permissions: ["lead.work"] })],
      ])
    );

    await expect(
      filterTaskRecipientsWithAccess(task, [], ["locked@x.com", "lead.only@x.com"])
    ).resolves.toEqual([]);
  });
});
```

- [ ] **Step 7: Chạy test để thấy thất bại**

Run: `npx vitest run src/lib/tasks/recipient-access.test.ts`
Expected: FAIL — không resolve được `./recipient-access`.

- [ ] **Step 8: Viết `src/lib/tasks/recipient-access.ts`**

```ts
import { getUserAccessByEmails } from "@/lib/rbac/access";
import { buildTaskActor, canViewTask, isTaskViewAdmin } from "./access";
import { isAgentOwnerOrAssistant, resolveTaskQueueScope } from "./membership";

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Chỉ giữ người nhận XEM ĐƯỢC task, theo đúng `canViewTask`.
 *
 * Dùng cho `task_created`: danh sách ứng viên là mọi người giữ `task.manage`
 * (`fetchTaskManagerEmails`), trong khi xem toàn bộ task còn cần vai trò
 * task-admin. Không lọc thì một agent được cấp `task.manage` qua role tuỳ chỉnh
 * sẽ nhận tiêu đề task ngoài phạm vi của mình (S27).
 *
 * Task mới chưa có participant, nên không xét `isParticipant`.
 */
export async function filterTaskRecipientsWithAccess(
  task: { agent_email: string | null; reporter_email: string | null },
  assigneeEmails: readonly string[],
  emails: readonly string[]
): Promise<string[]> {
  const unique = [...new Set(emails.map(normalize).filter(Boolean))];
  if (unique.length === 0) return [];

  const accessByEmail = await getUserAccessByEmails(unique);
  const assignees = new Set(assigneeEmails.map(normalize));
  const reporter = normalize(task.reporter_email);

  const decisions = await Promise.all(
    unique.map(async (email) => {
      const access = accessByEmail.get(email);
      if (!access || !access.isActive) return false;
      const actor = buildTaskActor(access.permissions, email, {
        isAdmin: isTaskViewAdmin({ role: access.legacyRole, roles: access.roles }),
      });
      if (actor.isManager) return true;
      if (!actor.isWorker) return false;
      const [isAgentOwner, scope] = await Promise.all([
        isAgentOwnerOrAssistant(task.agent_email, email),
        resolveTaskQueueScope(actor),
      ]);
      return canViewTask(actor, { assignee_email: null }, {
        isAssignee: assignees.has(email),
        isReporter: reporter === email,
        isAgentOwner,
        seesAllTasks: scope.seesAllTasks,
      });
    })
  );
  return unique.filter((_, index) => decisions[index]);
}
```

- [ ] **Step 9: Chạy test để thấy qua**

Run: `npx vitest run src/lib/tasks/recipient-access.test.ts`
Expected: PASS 3/3.

- [ ] **Step 10: Nối vào bình luận Enrollment** (`src/app/api/enrollment/[id]/comments/route.ts`). Thêm import:

```ts
import { filterEnrollmentRecipientsWithAccess } from "@/lib/enrollment/recipient-access";
```

Trong khối `after(...)`, thay đoạn:

```ts
      const mentions = parseMentions(text).filter((email) => activeEmails.has(email));
      const mentionSet = new Set(mentions);
      const threadWatchers = ((authorsRes.data ?? []) as { author_email: string }[]).map(
        (row) => row.author_email
      );
      const baseRecipients = uniqueEnrollmentNotificationRecipients(
        [
          loaded.record.caller_email,
          loaded.record.responsible_enroll_email,
          ...threadWatchers,
        ],
        [loaded.actor.email, ...mentions]
      );
      const mentionRecipients = uniqueEnrollmentNotificationRecipients(mentions, [
        loaded.actor.email,
      ]);
```

bằng:

```ts
      const mentions = parseMentions(text).filter((email) => activeEmails.has(email));
      const threadWatchers = ((authorsRes.data ?? []) as { author_email: string }[]).map(
        (row) => row.author_email
      );
      // Chỉ báo cho người MỞ ĐƯỢC hồ sơ này (S15): @ một người không có quyền,
      // hay một người từng bình luận nay đã ra khỏi scope, không còn nhận tên khách.
      const reachable = new Set(
        await filterEnrollmentRecipientsWithAccess(loaded.record, [
          ...mentions,
          ...threadWatchers,
          loaded.record.caller_email,
          loaded.record.responsible_enroll_email,
        ])
      );
      const canReach = (email: string | null | undefined) =>
        Boolean(email && reachable.has(email.trim().toLowerCase()));
      const reachableMentions = mentions.filter(canReach);
      const mentionSet = new Set(reachableMentions);
      const baseRecipients = uniqueEnrollmentNotificationRecipients(
        [
          loaded.record.caller_email,
          loaded.record.responsible_enroll_email,
          ...threadWatchers,
        ].filter(canReach),
        [loaded.actor.email, ...reachableMentions]
      );
      const mentionRecipients = uniqueEnrollmentNotificationRecipients(reachableMentions, [
        loaded.actor.email,
      ]);
```

- [ ] **Step 11: Nối vào sửa bình luận** (`src/app/api/enrollment/[id]/comments/[cid]/route.ts`). Thêm import:

```ts
import { filterEnrollmentRecipientsWithAccess } from "@/lib/enrollment/recipient-access";
import type { EnrollmentRecord } from "@/lib/enrollment/types";
```

Trong `loadAuthorContext`, thay object trả về:

```ts
  return {
    supabase,
    email: actorResult.actor.email,
    currentBody: commentRow.body,
    currentUpdatedAt: commentRow.updated_at,
  };
```

bằng:

```ts
  return {
    supabase,
    email: actorResult.actor.email,
    record: scoped.record as EnrollmentRecord,
    currentBody: commentRow.body,
    currentUpdatedAt: commentRow.updated_at,
  };
```

Trong `after(...)` của PATCH, thay:

```ts
      if (newMentions.length > 0) {
        await insertEnrollmentNotifications(
          newMentions.map((recipient) => ({
```

bằng:

```ts
      const reachableNewMentions = await filterEnrollmentRecipientsWithAccess(
        context.record,
        newMentions
      );
      if (reachableNewMentions.length > 0) {
        await insertEnrollmentNotifications(
          reachableNewMentions.map((recipient) => ({
```

- [ ] **Step 12: Nối vào reaction** (`src/app/api/enrollment/[id]/comments/[cid]/reactions/route.ts`). Thêm import:

```ts
import { filterEnrollmentRecipientsWithAccess } from "@/lib/enrollment/recipient-access";
```

Thay:

```ts
        const recipients = uniqueEnrollmentNotificationRecipients(
          [comment?.author_email],
          [access.email],
        );
```

bằng:

```ts
        const { data: recordRow, error: recordError } = await access.supabase
          .from("enrollment_records")
          .select("agent_email,caller_email,responsible_enroll_email,created_by_email")
          .eq("id", id)
          .maybeSingle();
        if (recordError) throw new Error(recordError.message);
        // Tác giả bình luận có thể đã ra khỏi scope của hồ sơ từ lúc viết (S15).
        const recipients = recordRow
          ? await filterEnrollmentRecipientsWithAccess(
              recordRow as {
                agent_email: string | null;
                caller_email: string | null;
                responsible_enroll_email: string | null;
                created_by_email: string | null;
              },
              uniqueEnrollmentNotificationRecipients([comment?.author_email], [access.email]),
            )
          : [];
```

- [ ] **Step 13: Nối vào tạo task** (`src/app/api/tasks/route.ts`). Thêm import:

```ts
import { filterTaskRecipientsWithAccess } from "@/lib/tasks/recipient-access";
```

Thay:

```ts
            const createdRecipients = await fetchTaskManagerEmails();
```

bằng:

```ts
            // Người giữ task.manage nhưng không xem được task này thì không nhận
            // tiêu đề của nó (S27).
            const createdRecipients = await filterTaskRecipientsWithAccess(
              { agent_email: agentEmail, reporter_email: email },
              assignedEmails,
              await fetchTaskManagerEmails()
            );
```

- [ ] **Step 14: Kiểm tra toàn bộ**

Run: `npm run typecheck && npx vitest run src/lib/enrollment src/lib/tasks src/lib/rbac`
Expected: không lỗi. Nếu `EnrollmentRecordWithStats` không có đủ bốn trường trong `ScopedRecord`, dùng kiểu `Pick` đúng tên mà `isRecordInScope` nhận (`src/lib/enrollment/scope.ts:79-88`).

- [ ] **Step 15: Kiểm tay:**
  1. Account Accounting (không có quyền task) được @ trong bình luận Enrollment → không nhận thông báo.
  2. CS thường được @ → vẫn nhận.
  3. Tạo task mới → task admin vẫn nhận `task_created`.

- [ ] **Step 16: Changelog**

```markdown
## 2026-09-26 — Thông báo chỉ tới người mở được bản ghi (S15, S27)

@mention trong Enrollment nhận bất kỳ account active nào, và người từng bình luận vẫn
nhận dù đã ra khỏi scope — nên người không có quyền nhận tên khách hàng qua chuông/push.
Nay mention, watcher, reaction và bình luận sửa lại đều lọc qua đúng luật scope của
trang Enrollment. `task_created` lọc qua `canViewTask`: người giữ `task.manage` mà
không xem được task không nhận tiêu đề. Chọn BỎ người không đủ quyền, không gửi bản rút
gọn (Q21 — có thể đổi ở Phase F). Mention trong Task không đổi vì nó cố ý cấp quyền xem.
```

- [ ] **Step 17: Commit** (chỉ khi đã được cho phép)

```bash
git add src/lib/rbac/access.ts src/lib/enrollment/recipient-access.ts src/lib/enrollment/recipient-access.test.ts src/lib/tasks/recipient-access.ts src/lib/tasks/recipient-access.test.ts "src/app/api/enrollment/[id]/comments/route.ts" "src/app/api/enrollment/[id]/comments/[cid]/route.ts" "src/app/api/enrollment/[id]/comments/[cid]/reactions/route.ts" src/app/api/tasks/route.ts changelog.md
git commit -m "fix(notifications): chỉ báo cho người mở được bản ghi"
```

---

### Task A6: Khoá phạm vi hoa hồng theo tên trong DB, khoá tự đổi tên (giảm nhẹ S1)

**Context:** Registration, Agent Dashboard và AI chat lọc dữ liệu theo `session.user.name`. Có ba đường vào sai:
- **Credentials:** tên nằm trong JWT từ lúc đăng nhập, và `jwt` callback không bao giờ làm mới nó (`src/auth.ts`).
- **Google:** tên là tên hồ sơ Google, người dùng tự đặt được.
- **Settings:** người dùng tự sửa `portal_account.name` (`api/settings/profile/route.ts`).

Hệ quả: đổi tên thành tên một agent khác là xem, sửa và xoá được dữ liệu hoa hồng của agent đó. Sửa gốc là bảng ánh xạ định danh (Phase D, Q4). Giảm nhẹ ngay bây giờ cần **cả hai** việc sau (comment C16):
1. Mọi chỗ lọc đọc tên **tươi từ DB** theo email, nên JWT cũ không còn tác dụng.
2. Người dùng thôi tự sửa tên; chỉ Account Manager sửa được.

Trước khi ship: A0 Step 5 không được còn tên trùng.

**Files:**
- Create: `src/lib/agent-identity.ts`, `src/lib/agent-identity.test.ts`
- Modify: `src/app/(authed)/page.tsx`, `src/app/(authed)/customer-registration/pc/page.tsx`, `src/app/(authed)/dashboard/health/page.tsx`, `src/app/(authed)/dashboard/pc/page.tsx`
- Modify: `src/app/api/entries/route.ts`, `src/app/api/entries/[id]/route.ts`, `src/app/api/pc-entries/route.ts`, `src/app/api/pc-entries/[id]/route.ts`, `src/app/api/ai/dashboard-chat/route.ts`
- Modify: `src/app/api/settings/profile/route.ts`
- Create: `src/app/api/settings/profile/route.test.ts`
- Modify: `src/app/(authed)/settings/SettingsClient.tsx`

**Interfaces:**
- Produces: `fetchScopeAgentName(email: string | null | undefined): Promise<string>` — tên đã chuẩn hoá bằng `normalizeAgentName`; `""` nếu không có account active.

- [ ] **Step 1: Viết test thất bại** `src/lib/agent-identity.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => supabaseMock }));

const { fetchScopeAgentName } = await import("./agent-identity");

function queryReturning(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  supabaseMock.from.mockReturnValue(query);
  return query;
}

describe("fetchScopeAgentName", () => {
  beforeEach(() => vi.clearAllMocks());

  it("đọc tên từ portal_account và chuẩn hoá như normalizeAgentName", async () => {
    const query = queryReturning({ data: { name: "  ann   strambler " }, error: null });

    await expect(fetchScopeAgentName("ann@x.com")).resolves.toBe("ANN STRAMBLER");
    expect(query.eq).toHaveBeenCalledWith("email", "ann@x.com");
    expect(query.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("không có account active thì trả chuỗi rỗng (không thấy gì)", async () => {
    queryReturning({ data: null, error: null });

    await expect(fetchScopeAgentName("ghost@x.com")).resolves.toBe("");
  });

  it("email rỗng không truy vấn", async () => {
    await expect(fetchScopeAgentName("  ")).resolves.toBe("");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("truy vấn lỗi thì ném, không rơi về tên trong phiên", async () => {
    queryReturning({ data: null, error: { message: "boom" } });

    await expect(fetchScopeAgentName("ann@x.com")).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `npx vitest run src/lib/agent-identity.test.ts`
Expected: FAIL — không resolve được `./agent-identity`.

- [ ] **Step 3: Viết `src/lib/agent-identity.ts`**

```ts
import { normalizeAgentName } from "@/lib/agent-name";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Tên agent dùng làm KHOÁ PHẠM VI cho Registration, Agent Dashboard và AI chat.
 *
 * Đọc tươi từ `portal_account` mỗi lần, KHÔNG lấy `session.user.name`: tên trong
 * phiên là tên lúc đăng nhập (không bao giờ làm mới), còn với Google là tên hồ sơ
 * Google người dùng tự đặt. Đổi tên thành tên agent khác từng đủ để xem/sửa/xoá
 * dữ liệu hoa hồng của họ (S1). Từ 2026-09-26 tên chỉ Account Manager sửa được.
 *
 * Đây là giảm nhẹ tạm thời: khoá thật sẽ là bảng ánh xạ định danh (Phase D).
 * Không có account active → "" → truy vấn phía sau không thấy gì (fail-closed).
 */
export async function fetchScopeAgentName(email: string | null | undefined): Promise<string> {
  const normalizedEmail = email?.trim();
  if (!normalizedEmail) return "";

  const { data, error } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .select("name")
    .eq("email", normalizedEmail)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return normalizeAgentName((data as { name?: string | null } | null)?.name ?? "");
}
```

- [ ] **Step 4: Chạy test để thấy qua**

Run: `npx vitest run src/lib/agent-identity.test.ts`
Expected: PASS 4/4.

- [ ] **Step 5: Thay các chỗ lọc.** Mỗi file thêm `import { fetchScopeAgentName } from "@/lib/agent-identity";`, rồi:

| File | Thay | Bằng |
|---|---|---|
| `src/app/(authed)/page.tsx` | `buildVisibleEntriesFilter(email, session.user.name)` | `buildVisibleEntriesFilter(email, await fetchScopeAgentName(email))` |
| `src/app/(authed)/customer-registration/pc/page.tsx` | `buildVisibleEntriesFilter(email, session.user.name)` | `buildVisibleEntriesFilter(email, await fetchScopeAgentName(email))` |
| `src/app/api/entries/route.ts` (GET) | `buildVisibleEntriesFilter(email, session.user.name)` | `buildVisibleEntriesFilter(email, await fetchScopeAgentName(email))` |
| `src/app/api/pc-entries/route.ts` (GET) | `buildVisibleEntriesFilter(email, session.user.name)` | `buildVisibleEntriesFilter(email, await fetchScopeAgentName(email))` |
| `src/app/api/entries/[id]/route.ts` (PATCH và DELETE, 2 chỗ) | `canManageEntry(existing, email, session.user.name)` | `canManageEntry(existing, email, await fetchScopeAgentName(email))` |
| `src/app/api/pc-entries/[id]/route.ts` (2 chỗ) | `canManagePcEntry(existing, email, session.user.name)` | `canManagePcEntry(existing, email, await fetchScopeAgentName(email))` |
| `src/app/api/ai/dashboard-chat/route.ts` | `: normalizeAgentName(session.user.name ?? "");` | `: await fetchScopeAgentName(session.user.email);` |
| `src/app/(authed)/dashboard/health/page.tsx` | `const agentName = normalizeAgentName(session.user.name ?? "");` | `const agentName = await fetchScopeAgentName(session.user.email);` |
| `src/app/(authed)/dashboard/pc/page.tsx` | `const agentName = normalizeAgentName(session.user.name ?? "");` | `const agentName = await fetchScopeAgentName(session.user.email);` |

Hai trang dashboard có hàm cục bộ `normalizeAgentName` (`dashboard/health/page.tsx:165-167`, `dashboard/pc/page.tsx:388-390`) chỉ phục vụ dòng vừa thay → xoá hàm đó:

```ts
function normalizeAgentName(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
```

`api/ai/dashboard-chat/route.ts` vẫn dùng `normalizeAgentName` ở dòng ~179 → **giữ** import đó.

Cột `agent_name` trong POST của `api/entries/route.ts` và `api/pc-entries/route.ts` chỉ là nhãn hiển thị, không dùng để lọc → không đổi trong task này.

- [ ] **Step 6: Viết test thất bại cho khoá tự đổi tên** `src/app/api/settings/profile/route.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("không được ghi tên hiển thị");
  },
}));

const { PATCH } = await import("./route");

describe("PATCH /api/settings/profile", () => {
  it("người dùng không tự đổi được tên hiển thị", async () => {
    authMock.mockResolvedValue({
      user: { email: "a@x.com", permissions: ["settings.access"] },
    });

    const response = await PATCH();

    expect(response.status).toBe(403);
  });

  it("chưa đăng nhập: 401", async () => {
    authMock.mockResolvedValue(null);

    const response = await PATCH();

    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 7: Chạy test để thấy thất bại**

Run: `npx vitest run src/app/api/settings/profile/route.test.ts`
Expected: FAIL — handler hiện đọc body và ghi DB (mock ném lỗi / status khác 403).

- [ ] **Step 8: Thay toàn bộ `src/app/api/settings/profile/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";

/**
 * Tên hiển thị KHÔNG còn tự sửa được (2026-09-26, S1).
 *
 * Tên là khoá phạm vi của Registration / Agent Dashboard / AI chat
 * (`fetchScopeAgentName`). Cho tự sửa là cho tự chọn xem dữ liệu hoa hồng của
 * ai. Chỉ Account Manager đổi tên, cho tới khi có bảng ánh xạ định danh.
 * Giữ route để client cũ nhận 403 rõ ràng thay vì 404.
 */
export async function PATCH() {
  const session = await auth();
  if (!session?.user?.email || !can(session.user.permissions, PERMISSIONS.SETTINGS)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Display name is managed by an administrator in Account Manager." },
    { status: 403 }
  );
}
```

- [ ] **Step 9: Chạy test để thấy qua**

Run: `npx vitest run src/app/api/settings/profile/route.test.ts`
Expected: PASS 2/2.

- [ ] **Step 10: Settings UI chỉ đọc** (`src/app/(authed)/settings/SettingsClient.tsx`):
  1. Thay `const [displayName, setDisplayName] = useState(profile.name);` bằng `const [displayName] = useState(profile.name);`
  2. Xoá ba dòng state:
     ```ts
     const [isSavingProfile, setIsSavingProfile] = useState(false);
     const [profileMessage, setProfileMessage] = useState<string | null>(null);
     const [profileError, setProfileError] = useState<string | null>(null);
     ```
  3. Xoá toàn bộ hàm `async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) { … }` (dòng 50–77 hiện tại).
  4. Thay `onSubmit={handleProfileSubmit}` bằng `onSubmit={(event) => event.preventDefault()}`.
  5. Thay ô nhập:
     ```tsx
                     <input
                       className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#172b4d] outline-none"
                       type="text"
                       value={displayName}
                       onChange={(event) => setDisplayName(event.target.value)}
                       maxLength={120}
                       required
                     />
     ```
     bằng:
     ```tsx
                     <input
                       className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#172b4d] outline-none"
                       type="text"
                       value={displayName}
                       readOnly
                       aria-readonly="true"
                     />
     ```
     và ngay sau `</label>` của ô Display Name thêm:
     ```tsx
                 <p className="text-xs text-[#6b778c]">
                   Display name is managed by an administrator in Account Manager.
                 </p>
     ```
  6. Xoá hai khối `{profileError && ( … )}` và `{profileMessage && ( … )}` (dòng 288–298 hiện tại).
  7. Xoá khối footer chứa nút `Save Changes` của form này (`<div className="flex justify-end border-t border-[#e6eaf0] px-6 py-4"> … </div>`, dòng 302–310 hiện tại). **Không** đụng nút của form đổi mật khẩu.
  8. `router`, `CheckCircle2`, `FormEvent` vẫn được form mật khẩu dùng → giữ import.

- [ ] **Step 11: Kiểm tra toàn bộ**

Run: `npm run typecheck && npm run lint && npx vitest run src/lib/agent-identity.test.ts src/app/api/settings`
Expected: không lỗi, không cảnh báo biến thừa.

- [ ] **Step 12: Kiểm tay:**
  1. Agent A mở Agent Dashboard Health → thấy đúng dữ liệu của mình.
  2. Admin đổi tên A trong Account Manager thành tên agent B → A reload (không cần đăng nhập lại) → thấy dữ liệu của B. Kết quả này là **đúng mong đợi**: nó xác nhận tên được đọc tươi, và chỉ admin làm được. Đổi tên lại ngay.
  3. A vào Settings: ô tên chỉ đọc, không có nút lưu.

- [ ] **Step 13: Changelog**

```markdown
## 2026-09-26 — Phạm vi hoa hồng đọc tên từ DB; người dùng thôi tự đổi tên (giảm nhẹ S1)

Registration, Agent Dashboard và AI chat lọc theo tên hiển thị trong phiên. Tên đó là
tên lúc đăng nhập (không làm mới), với Google là tên hồ sơ Google, và người dùng tự sửa
được trong Settings — đổi tên thành tên agent khác là xem/sửa/xoá được dữ liệu hoa hồng
của họ. Nay mọi chỗ lọc đọc `portal_account.name` tươi theo email
(`fetchScopeAgentName`), và `PATCH /api/settings/profile` trả 403: chỉ Account Manager
đổi tên. Giảm nhẹ tạm thời — sửa gốc là bảng ánh xạ định danh (Phase D).
```

- [ ] **Step 14: Commit** (chỉ khi đã được cho phép)

```bash
git add src/lib/agent-identity.ts src/lib/agent-identity.test.ts "src/app/(authed)/page.tsx" "src/app/(authed)/customer-registration/pc/page.tsx" "src/app/(authed)/dashboard/health/page.tsx" "src/app/(authed)/dashboard/pc/page.tsx" src/app/api/entries/route.ts "src/app/api/entries/[id]/route.ts" src/app/api/pc-entries/route.ts "src/app/api/pc-entries/[id]/route.ts" src/app/api/ai/dashboard-chat/route.ts src/app/api/settings/profile/route.ts src/app/api/settings/profile/route.test.ts "src/app/(authed)/settings/SettingsClient.tsx" changelog.md
git commit -m "fix(scope): phạm vi hoa hồng đọc tên từ DB, khoá tự đổi tên"
```

---

### Task A7: `agent_email` của task phải thuộc roster (S5)

**Context:** `POST /api/tasks` coi người gọi là "có agent scope" nếu `isAgentOwnerOrAssistant(agentEmail, email)` đúng — mà hàm này trả `true` khi `agentEmail === email` (`src/lib/tasks/membership.ts:122-136`). Route không kiểm `agent_email` có trong `task_agents` hay không, nên CS thường gửi thẳng API với `agent_email` = chính mình là tạo được task, tự chọn người làm, rồi thành agent-owner: assign, xoá, QC. Reporter cũng đổi được `agent_email` của task mình tạo thành chính mình (`CONTENT_PATCH_KEYS` có `agent_email`) rồi tự QC. Enrollment đã kiểm roster từ lâu (`src/lib/enrollment/ownership.ts:36-61`); Task thì chưa. UI chỉ đưa ra agent trong roster (`NewTaskDialog.tsx:165-173`), nên người dùng hợp lệ không bị ảnh hưởng. PATCH chỉ kiểm khi `agent_email` **đổi sang giá trị khác**, nên task cũ có agent ngoài roster vẫn sửa các trường khác được.

**Files:**
- Create: `src/lib/tasks/roster.ts`, `src/lib/tasks/roster.test.ts`
- Modify: `src/app/api/tasks/route.ts`, `src/app/api/tasks/[id]/route.ts`

**Interfaces:**
- Consumes: `fetchSelectedAgentEmails(): Promise<Set<string>>` (có sẵn, `src/lib/tasks/assignees.ts:42-48`, `react.cache`).
- Produces: `isRosterAgent(email: string | null | undefined, roster: ReadonlySet<string>): boolean`.

- [ ] **Step 1: Viết test thất bại** `src/lib/tasks/roster.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { isRosterAgent } from "./roster";

const roster = new Set(["ann.strambler@excelplannings.com", "Thuy.Insagent@gmail.com"]);

describe("isRosterAgent", () => {
  it("nhận agent có tên trong roster, không phân biệt hoa thường và khoảng trắng", () => {
    expect(isRosterAgent("  ANN.STRAMBLER@excelplannings.com ", roster)).toBe(true);
    expect(isRosterAgent("thuy.insagent@gmail.com", roster)).toBe(true);
  });

  it("từ chối người ngoài roster, kể cả khi đó là chính người gọi", () => {
    expect(isRosterAgent("plain.cs@epsins.co", roster)).toBe(false);
  });

  it("từ chối rỗng / null", () => {
    expect(isRosterAgent("", roster)).toBe(false);
    expect(isRosterAgent(null, roster)).toBe(false);
    expect(isRosterAgent(undefined, roster)).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `npx vitest run src/lib/tasks/roster.test.ts`
Expected: FAIL — không resolve được `./roster`.

- [ ] **Step 3: Viết `src/lib/tasks/roster.ts`**

```ts
function normalizeRosterEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Người này có tên trong roster agent (`task_agents`) không.
 *
 * Pure, so không phân biệt hoa thường: roster cũ có thể còn email viết hoa, và
 * email trong body request là thứ người gọi tự gõ.
 */
export function isRosterAgent(
  email: string | null | undefined,
  roster: ReadonlySet<string>
): boolean {
  const normalized = normalizeRosterEmail(email);
  if (!normalized) return false;
  for (const member of roster) {
    if (normalizeRosterEmail(member) === normalized) return true;
  }
  return false;
}
```

- [ ] **Step 4: Chạy test để thấy qua**

Run: `npx vitest run src/lib/tasks/roster.test.ts`
Expected: PASS 3/3.

- [ ] **Step 5: Kiểm khi tạo** (`src/app/api/tasks/route.ts`). Sửa import từ `@/lib/tasks/assignees` thành:

```ts
import {
  attachAssigneesToTasks,
  fetchSelectedAgentEmails,
  findIneligibleTaskAssigneeEmail,
} from "@/lib/tasks/assignees";
```

và thêm:

```ts
import { isRosterAgent } from "@/lib/tasks/roster";
```

Ngay sau:

```ts
  if (!agentEmail) {
    return NextResponse.json({ error: "Agent is required." }, { status: 400 });
  }
```

thêm:

```ts
  // Agent phải có tên trong roster (`task_agents`) — Enrollment đã kiểm điều này
  // từ lâu (enrollment/ownership.ts), Task thì chưa. Thiếu kiểm, CS gửi thẳng
  // `agent_email` = chính mình sẽ được coi là agent owner của task đó
  // (isAgentOwnerOrAssistant(self, self) = true) rồi tự assign/xoá/QC (S5).
  if (!isRosterAgent(agentEmail, await fetchSelectedAgentEmails())) {
    return NextResponse.json({ error: "Agent must be a registered agent." }, { status: 400 });
  }
```

- [ ] **Step 6: Kiểm khi sửa** (`src/app/api/tasks/[id]/route.ts`). Sửa import từ `@/lib/tasks/assignees` thành:

```ts
import {
  attachAssigneesToTasks,
  fetchSelectedAgentEmails,
  fetchTaskAssigneeEmails,
  isEligibleTaskAssigneeEmail,
  isTaskAssignee,
} from "@/lib/tasks/assignees";
```

và thêm `import { isRosterAgent } from "@/lib/tasks/roster";`. Ngay sau khối:

```ts
  const capabilityError = patchCapabilityError(bodyRecord, capabilities);
  if (capabilityError) {
    return NextResponse.json({ error: capabilityError }, { status: 403 });
  }
```

thêm:

```ts
  // Chỉ kiểm khi Agent ĐỔI sang giá trị khác: task cũ có agent ngoài roster vẫn
  // sửa được các trường khác. Chặn reporter tự đặt mình làm agent rồi tự QC (S5).
  const requestedAgent = bodyRecord.agent_email;
  if (
    typeof requestedAgent === "string" &&
    requestedAgent.trim() !== "" &&
    requestedAgent.trim().toLowerCase() !== (r.task.agent_email ?? "").trim().toLowerCase() &&
    !isRosterAgent(requestedAgent, await fetchSelectedAgentEmails())
  ) {
    return NextResponse.json({ error: "Agent must be a registered agent." }, { status: 400 });
  }
```

- [ ] **Step 7: Kiểm tra toàn bộ**

Run: `npm run typecheck && npx vitest run src/lib/tasks`
Expected: không lỗi.

- [ ] **Step 8: Kiểm tay:**
  1. Đăng nhập CS thường, mở DevTools console, chạy:
     ```js
     fetch("/api/tasks", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ title: "t", agent_email: "<email của chính mình>", category_id: "<id category có thật>" }),
     }).then((r) => r.status)
     ```
     Expected: `400`.
  2. Manager tạo task bằng UI → vẫn `201`.

- [ ] **Step 9: Changelog**

```markdown
## 2026-09-26 — Agent của task phải thuộc roster (S5)

`POST /api/tasks` coi người gọi là agent owner khi `agent_email` bằng chính email của
họ, mà không kiểm người đó có trong `task_agents` — nên CS thường gọi thẳng API là tạo
được task rồi tự assign/xoá/QC; reporter cũng tự đổi agent thành mình. Nay tạo task và
đổi Agent đều đòi `agent_email` thuộc roster, như Enrollment. PATCH chỉ kiểm khi Agent
thật sự đổi, nên task cũ có agent ngoài roster vẫn sửa được các trường khác.
```

- [ ] **Step 10: Commit** (chỉ khi đã được cho phép)

```bash
git add src/lib/tasks/roster.ts src/lib/tasks/roster.test.ts src/app/api/tasks/route.ts "src/app/api/tasks/[id]/route.ts" changelog.md
git commit -m "fix(tasks): agent của task phải thuộc roster"
```

---

### Task A8: Import Enrollment chỉ dành cho task admin (S6)

**Context:** `POST /api/enrollment/import` chỉ đòi `task.import` + quyền vào board, rồi ghi thẳng `.update()` theo ID (`src/app/api/enrollment/import/route.ts:234-247`). Đường này không qua scope bản ghi, capability từng dòng (đổi `agent_email`, stage), hay `patch_enrollment_atomic` (activity log, stage cycles). Hiện chỉ role Admin có `task.import` (`rollouts/2026-09-21-task-import-permission.sql`), và Admin là task manager — nên đòi thêm `isManager` **không đổi hành vi hôm nay**, nhưng chặn việc cấp `task.import` cho người thường thành một cửa hậu. Làm import áp scope/capability/audit từng dòng là việc của Phase D (Q11). Provider import không đổi: dữ liệu provider là dữ liệu tham chiếu dùng chung.

**Files:**
- Modify: `src/lib/table-config/export-access.ts`, `src/lib/table-config/export-access.test.ts`
- Modify: `src/app/api/enrollment/import/route.ts`, `src/app/(authed)/enrollment/page.tsx`

**Interfaces:**
- Produces: `canActorImportEnrollment(permissions: readonly string[] | undefined, actor: { isManager: boolean }): boolean`.

- [ ] **Step 1: Viết test thất bại** — thêm vào cuối `src/lib/table-config/export-access.test.ts` (đổi dòng import thành `import { canActorExport, canActorImport, canActorImportEnrollment } from "./export-access";`):

```ts
describe("canActorImportEnrollment", () => {
  it("đòi CẢ task.import lẫn task manager", () => {
    expect(canActorImportEnrollment(["task.import"], { isManager: true })).toBe(true);
  });

  // Import ghi thẳng theo ID, bỏ qua scope/capability/activity log — cấp
  // task.import cho người thường không được biến thành cửa hậu sửa mọi hồ sơ.
  it("người thường có task.import vẫn bị từ chối", () => {
    expect(canActorImportEnrollment(["task.import", "task.work"], { isManager: false })).toBe(false);
  });

  it("manager thiếu task.import bị từ chối", () => {
    expect(canActorImportEnrollment(["task.manage"], { isManager: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `npx vitest run src/lib/table-config/export-access.test.ts`
Expected: FAIL — `canActorImportEnrollment` không tồn tại.

- [ ] **Step 3: Thêm hàm** vào cuối `src/lib/table-config/export-access.ts`:

```ts
/**
 * Import Enrollment ghi thẳng `.update()` theo ID — KHÔNG qua scope bản ghi,
 * capability từng dòng hay activity log (api/enrollment/import/route.ts). Cho
 * tới khi import áp đủ các lớp đó (Phase D, Q11), chỉ task admin — người vốn
 * đã thấy và sửa được mọi hồ sơ — mới được dùng. Không nới thêm gì cho họ; chỉ
 * chặn việc cấp `task.import` cho người thường thành cửa hậu (S6).
 */
export function canActorImportEnrollment(
  permissions: readonly string[] | undefined,
  actor: { isManager: boolean }
): boolean {
  return canActorImport(permissions) && actor.isManager;
}
```

- [ ] **Step 4: Chạy test để thấy qua**

Run: `npx vitest run src/lib/table-config/export-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Nối vào route và page.**
  - `src/app/api/enrollment/import/route.ts`:
    - đổi import thành `import { canActorImportEnrollment } from "@/lib/table-config/export-access";`
    - thay `if (!canActorImport(actorResult.permissions)) {` bằng `if (!canActorImportEnrollment(actorResult.permissions, actorResult.actor)) {`.
  - `src/app/(authed)/enrollment/page.tsx`:
    - thêm `canActorImportEnrollment` vào import từ `@/lib/table-config/export-access`;
    - thay `canImport={canActorImport(session.user.permissions)}` bằng `canImport={canActorImportEnrollment(session.user.permissions, actor)}`;
    - nếu `canActorImport` không còn được dùng trong file thì xoá khỏi import.

- [ ] **Step 6: Kiểm tra toàn bộ**

Run: `npm run typecheck && npm run lint`
Expected: không lỗi.

- [ ] **Step 7: Changelog**

```markdown
## 2026-09-26 — Import Enrollment chỉ dành cho task admin (S6)

Import ghi thẳng theo ID, bỏ qua scope, capability từng dòng và activity log. Trước đây
chỉ cần `task.import`; nay cần thêm vai trò task manager. Hôm nay chỉ role Admin có
`task.import` nên không ai mất quyền — thay đổi này chặn việc cấp `task.import` cho
người thường thành cửa hậu. Import theo scope + audit từng dòng để lại Phase D (Q11).
Provider import không đổi.
```

- [ ] **Step 8: Commit** (chỉ khi đã được cho phép)

```bash
git add src/lib/table-config/export-access.ts src/lib/table-config/export-access.test.ts src/app/api/enrollment/import/route.ts "src/app/(authed)/enrollment/page.tsx" changelog.md
git commit -m "fix(enrollment): import chỉ dành cho task admin"
```

---

### Task A9: Registry gác route ba mức (cổng tĩnh)

**Context:** 112 route gác bằng 7 cơ chế khác nhau; người thêm route mới phải tự đoán. Test này đọc mã nguồn mọi `route.ts` dưới `src/app/api` và ghi lại dấu hiệu gác ở ba mức (D16):
- **Xác thực:** biết ai đang gọi.
- **Quyền hành động:** được làm loại việc này.
- **Scope object:** đúng bản ghi / đúng response.

Test fail khi có route mới thiếu hai mức đầu, hoặc khi snapshot đổi (route mới hay cổng bị gỡ phải được review). Nó **chỉ** phát hiện thiếu khai báo. Overview (S8) và roles PATCH (S18) đều "có dấu hiệu gác" mà vẫn thủng — nên đây không thay test gọi API trực tiếp (A2, A3).

**Files:**
- Create: `src/app/api/route-guards.test.ts` (snapshot tự sinh ở `src/app/api/__snapshots__/route-guards.test.ts.snap`)

- [ ] **Step 1: Viết test**

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const API_ROOT = join(process.cwd(), "src/app/api");

// Dấu hiệu (chuỗi con trong mã nguồn) cho từng mức gác. Thêm cơ chế gác mới thì
// thêm dấu hiệu vào đúng mức, đừng nới luật bên dưới.
const AUTHN = [
  "auth()",
  "getTimeOffActor(",
  "loadEnrollmentActor(",
  "loadConfigAdmin(",
  "loadConfigAdminForScope(",
  "loadConfigActorForScope(",
  "authorizeTaskReactionAccess(",
  "authorizeEnrollmentReactionAccess(",
  "checkCronAuthorization(",
] as const;

const ACTION = [
  "can(",
  "canAny(",
  "canAccessBoard(",
  "canAssign(",
  "canManageCategories(",
  "canManageEnrollmentOptions(",
  "canManageLeads(",
  "canWorkLeads(",
  "canActorExport(",
  "canActorImport(",
  "canActorImportEnrollment(",
  ".isManager",
  "getTimeOffActor(",
  "loadEnrollmentActor(",
  "loadConfigAdmin(",
  "loadConfigAdminForScope(",
  "loadConfigActorForScope(",
  "authorizeTaskReactionAccess(",
  "authorizeEnrollmentReactionAccess(",
  "checkCronAuthorization(",
] as const;

const OBJECT = [
  "loadScopedEnrollmentRecord(",
  "resolveEnrollmentScope(",
  "canViewTask(",
  "resolveTaskCapabilities(",
  "resolveLeadCapabilities(",
  "fetchTasksForActor(",
  "resolveLeadOwnerEmails(",
  "buildVisibleEntriesFilter(",
  "canManageEntry(",
  "canManagePcEntry(",
  "recipient_email",
  "requester_id",
  "authorizeTaskReactionAccess(",
  "authorizeEnrollmentReactionAccess(",
] as const;

// Handler của chính Auth.js.
const EXEMPT: Record<string, string> = {
  "auth/[...nextauth]/route.ts": "Handler của Auth.js — chính nó là lớp xác thực.",
};

// Route chỉ phục vụ CHÍNH người đang đăng nhập: không có quyền hành động riêng,
// phạm vi là email trong phiên.
const SELF_SERVICE: Record<string, string> = {
  "notifications/push/subscribe/route.ts": "Chỉ ghi/xoá subscription của email trong phiên.",
  "settings/avatar/route.ts": "Chỉ đổi ảnh của account trong phiên.",
  "tasks/notifications/route.ts": "Chỉ đọc thông báo có recipient_email = email trong phiên.",
  "tasks/notifications/read/route.ts": "Chỉ đánh dấu đã đọc thông báo của chính mình.",
};

function listRoutes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listRoutes(full);
    return name === "route.ts" ? [full] : [];
  });
}

function detect(source: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => source.includes(marker));
}

const routes = listRoutes(API_ROOT)
  .map((file) => {
    const source = readFileSync(file, "utf8");
    return {
      route: relative(API_ROOT, file).split("\\").join("/"),
      authn: detect(source, AUTHN),
      action: detect(source, ACTION),
      object: detect(source, OBJECT),
    };
  })
  .sort((a, b) => a.route.localeCompare(b.route));

describe("registry gác route", () => {
  it("mọi route đều xác thực người gọi", () => {
    const missing = routes
      .filter((entry) => !EXEMPT[entry.route] && entry.authn.length === 0)
      .map((entry) => entry.route);
    expect(missing).toEqual([]);
  });

  it("mọi route không tự phục vụ đều có cổng quyền hành động", () => {
    const missing = routes
      .filter(
        (entry) =>
          !EXEMPT[entry.route] && !SELF_SERVICE[entry.route] && entry.action.length === 0
      )
      .map((entry) => entry.route);
    expect(missing).toEqual([]);
  });

  it("danh sách miễn trừ không trỏ tới route không còn tồn tại", () => {
    const known = new Set(routes.map((entry) => entry.route));
    const stale = [...Object.keys(EXEMPT), ...Object.keys(SELF_SERVICE)].filter(
      (route) => !known.has(route)
    );
    expect(stale).toEqual([]);
  });

  it("bản đồ cổng khớp snapshot — route mới hoặc cổng bị gỡ phải được review", () => {
    expect(routes).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Chạy lần đầu**

Run: `npx vitest run src/app/api/route-guards.test.ts`
Expected: ba test đầu PASS; snapshot được ghi mới. Nếu test 1 hoặc 2 fail và liệt kê route:
- Mở từng route. Nếu route **thật sự** không gác → dừng lại, báo chủ repo; đó là phát hiện mới, không tự sửa trong task này.
- Nếu route gác bằng một hàm có tên mới → thêm tên hàm đó vào đúng mảng dấu hiệu, chạy lại.

- [ ] **Step 3: Review snapshot.** Mở `src/app/api/__snapshots__/route-guards.test.ts.snap` và xác nhận:
  - `tasks/overview/route.ts` có `.isManager` (sau A3);
  - `admin/roles/[id]/route.ts` có `can(`;
  - mọi route `cron/*` có `checkCronAuthorization(`.

- [ ] **Step 4: Commit** (chỉ khi đã được cho phép) — thay đổi test thuần, không ghi changelog.

```bash
git add src/app/api/route-guards.test.ts src/app/api/__snapshots__/route-guards.test.ts.snap
git commit -m "test(authz): registry gác route ba mức"
```

---

### Task A10: Cổng persistence trên Postgres dùng một lần (GitHub Actions)

**Context:** RLS và quyền EXECUTE chỉ kiểm được trên database thật. Repo chỉ có production, nhưng đã dùng GitHub Actions (`.github/workflows/task-reminders.yml`), nên dựng được Postgres dùng một lần ngay trong CI (D14).

`schema.sql` chỉ cần extension `pgcrypto`, `pg_trgm` (có sẵn trong image `postgres:15`) và các role `anon`/`authenticated`/`service_role` (phải tạo trước). **`schema.sql` chưa phải full-state**: 8 bảng chỉ có trong rollout (xem Phase C bước 5), nên job áp thêm đúng các rollout tạo ra chúng, rồi đến `2026-09-26-rls-lockdown.sql`.

Nếu một rollout không chạy được trên DB trống, đó là phát hiện migration phải ghi vào baseline và sửa ở Phase C — **không** bỏ qua bước đó cho CI xanh.

**Files:**
- Create: `supabase/checks/ci-bootstrap.sql`, `supabase/checks/ci-rls-assert.sql`, `.github/workflows/db-persistence-gate.yml`

- [ ] **Step 1: `supabase/checks/ci-bootstrap.sql`**

```sql
-- Giả lập các role mà Supabase tạo sẵn, để schema.sql (có revoke/grant tới
-- chúng) chạy được trên Postgres trơn. Default privileges mô phỏng hành vi của
-- Supabase: bảng mới trong public tự cấp ALL cho anon/authenticated — chính vì
-- vậy mà bảng quên bật RLS là bảng lộ.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
```

- [ ] **Step 2: `supabase/checks/ci-rls-assert.sql`**

```sql
-- Cổng persistence: fail nếu còn bảng public mở cho anon/authenticated mà chưa
-- bật RLS, hoặc hàm SECURITY DEFINER còn EXECUTE cho anon/authenticated.
do $$
declare
  leaked text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into leaked
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity
    and (has_table_privilege('anon', c.oid, 'SELECT')
      or has_table_privilege('anon', c.oid, 'INSERT')
      or has_table_privilege('anon', c.oid, 'UPDATE')
      or has_table_privilege('anon', c.oid, 'DELETE')
      or has_table_privilege('authenticated', c.oid, 'SELECT')
      or has_table_privilege('authenticated', c.oid, 'INSERT')
      or has_table_privilege('authenticated', c.oid, 'UPDATE')
      or has_table_privilege('authenticated', c.oid, 'DELETE'));
  if leaked is not null then
    raise exception 'Bảng public mở cho anon/authenticated mà chưa bật RLS: %', leaked;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute'));
  if leaked is not null then
    raise exception 'SECURITY DEFINER còn mở cho anon/authenticated: %', leaked;
  end if;
end $$;

select 'persistence gate: ok' as result;
```

- [ ] **Step 3: `.github/workflows/db-persistence-gate.yml`**

```yaml
name: DB persistence gate

on:
  pull_request:
    paths:
      - "supabase/**"
      - ".github/workflows/db-persistence-gate.yml"
  workflow_dispatch: {}

permissions:
  contents: read

jobs:
  rls:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
    env:
      PGHOST: localhost
      PGUSER: postgres
      PGPASSWORD: postgres
      PGDATABASE: postgres
    steps:
      - uses: actions/checkout@v4

      - name: Bootstrap Supabase roles
        run: psql -v ON_ERROR_STOP=1 -f supabase/checks/ci-bootstrap.sql

      - name: Apply schema.sql
        run: psql -v ON_ERROR_STOP=1 -f supabase/schema.sql

      # schema.sql chưa phải full-state: các bảng dưới đây chỉ có trong rollout
      # (gộp vào schema.sql ở Phase C). Thứ tự = thứ tự tên file.
      - name: Apply rollout-only tables and the RLS lockdown
        run: |
          for f in \
            2026-08-18-install-sheet-sync-staging.sql \
            2026-09-04-time-off-monthly-accruals.sql \
            2026-09-10-web-push.sql \
            2026-09-12-time-off-manager-notifications.sql \
            2026-09-17-provider-directory-temp.sql \
            2026-09-26-rls-lockdown.sql
          do
            echo "== $f"
            psql -v ON_ERROR_STOP=1 -f "supabase/rollouts/$f"
          done

      - name: Assert RLS and EXECUTE lockdown
        run: psql -v ON_ERROR_STOP=1 -f supabase/checks/ci-rls-assert.sql
```

- [ ] **Step 4: Chạy thử (cần chủ repo cho phép push nhánh).** Push nhánh, vào GitHub → Actions → "DB persistence gate" → Run workflow.

Expected: bước cuối in `persistence gate: ok`. Nếu fail:
- **Fail ở bước "Apply …"** vì một rollout không chạy trên DB trống → ghi tên file + lỗi vào `docs/2026-09-26-authz-baseline.md` mục `## 7. Migration trên DB trống`, báo chủ repo. Phát hiện này chặn Phase C.
- **Fail ở "Assert"** → danh sách trong thông báo lỗi là bảng/hàm cần khoá: thêm vào rollout lockdown (A1) rồi chạy lại.

- [ ] **Step 5: Kiểm cổng thật sự bắt lỗi.** Trên một nhánh nháp, xoá `'task_comment_edits',` khỏi mảng trong `2026-09-26-rls-lockdown.sql` rồi chạy workflow. Expected: fail ở "Assert" với thông báo có `task_comment_edits`. Hoàn tác nhánh nháp, không merge.

- [ ] **Step 6: Commit** (chỉ khi đã được cho phép) — hạ tầng test, không ghi changelog.

```bash
git add supabase/checks/ci-bootstrap.sql supabase/checks/ci-rls-assert.sql .github/workflows/db-persistence-gate.yml
git commit -m "ci(db): cổng persistence kiểm RLS và EXECUTE trên Postgres dùng một lần"
```

---

## Exit Phase A

- [ ] `docs/2026-09-26-authz-baseline.md` đủ 6 mục (7 nếu A10 phát hiện migration).
- [ ] Truy vấn kiểm chứng cuối A1 trên production trả 0 dòng; A0 Step 2 không còn bảng trả `200`.
- [ ] `npm run test:run`, `npm run typecheck`, `npm run lint` đều xanh.
- [ ] Workflow "DB persistence gate" xanh, và đã được chứng minh bắt lỗi (A10 Step 5).
- [ ] `changelog.md` có đủ entry cho A1–A8.
- [ ] Các câu hỏi chặn Phase B đã có câu trả lời hoặc được ghi là "chấp nhận mặc định": Q5, Q22, và số đo cookie D5.

## Self-review (đã chạy khi viết plan)

- **Độ phủ comment:** 22 comment `[sol5.5]` ↔ D1–D20 và các task A0–A10. Bảng đối chiếu đầy đủ ở audit §17.
- **Placeholder:** không có TBD/TODO. Mọi bước code có code đầy đủ; mọi bước chạy có lệnh và kết quả mong đợi.
- **Nhất quán kiểu:**
  - `UserAccess.lookupFailed` (A4) được `getUserAccessByEmails` (A5) dùng qua `flattenAccess`.
  - `filterEnrollmentRecipientsWithAccess` / `filterTaskRecipientsWithAccess` / `fetchScopeAgentName` / `isRosterAgent` / `canActorImportEnrollment` / `revokePushSubscriptions` / `filterActiveAccounts` / `applyRefreshedAccess` có cùng tên và chữ ký ở phần Interfaces, code và test.

---

# Phần III — Ghi chú thực thi

## Phase B (nhánh `feat/authz-phase-b`)

Đã làm: lõi `src/lib/authz/` (`catalog.ts`, `grants.ts`, `compat.ts`, `principal.ts`, `versions.ts`); phiên gắn `accountId`; `portal_account.access_version` + `bump_account_access_version` / `bump_role_members_access_version` (rollout `2026-09-27-authz-phase-b.sql`); Account/Role Manager tăng version; đổi nhãn Export/Import (D15).

Lệch so với spec, có lý do:

| Spec | Thực tế | Vì sao |
|---|---|---|
| D2/D3: trigger trên `role_permissions` sinh `role_grants` tương thích | Không có trigger. Grant tương thích suy **trong TypeScript** (`deriveCompatGrants`) mỗi request, từ định nghĩa role. Role có hàng `role_grants` (Phase C) thì dùng hàng đó | Logic ánh xạ nằm một chỗ và test được bằng unit test đối chiếu với hàm cũ; không có PL/pgSQL chạy mù trên production. Vẫn đạt mục tiêu của C6/C17: Role Manager cũ ghi `role_permissions` không xoá được gì của `role_grants` |
| D5: grant trong JWT nếu ≤ budget | **Không** đi trong JWT | Đo được 3.940 byte cho Admin trước mã hoá (test "lý do của D5"). JWT chỉ mang `roleIds`; `getPrincipal()` suy grant qua cache định nghĩa role 30 giây |
| D11: tăng version mọi thành viên khi sửa role | Có, cộng thêm: cache định nghĩa role TTL 30 giây | Hai cơ chế cùng cho SLA ≤ 30 giây |
| Shadow evaluation runtime ở 3 route thí điểm | Thay bằng **tương đương ở test**: mỗi persona được đối chiếu hàm mới với hàm cũ (`compat.test.ts`, và các test policy ở Phase D) + script decision diff offline (Phase D) | 43 account; shadow runtime nhân đôi truy vấn quan hệ trên mọi request, trong khi auth từng là điểm nóng CPU. Test-time equivalence bắt cùng loại lệch mà không tốn CPU production |
| Kiểm SQL trên CI | Kiểm thêm tại máy bằng PGlite (Postgres WASM) chạy đúng chuỗi của cổng A10 | Máy không có `psql`/Docker; chuỗi A10 + rollout B chạy sạch và cổng xác nhận bắt lỗi khi bỏ rollout khoá |

## Phase C (nhánh `feat/authz-phase-c`)

Đã làm:

- **SQL** (rollout `2026-09-28-authz-phase-c.sql`, cùng khối trong `schema.sql`): `roles.system_key` (backfill `Admin` → `super_admin`, `Agent` → `default_new_account`), `roles.grants_managed`, `role_grants`, `access_audit` (RLS bật, revoke anon/authenticated); RPC `upsert_role_atomic`, `delete_role_atomic`, `assign_account_access_atomic`, `delete_account_atomic`, `assert_recovery_admin_exists`.
- **TS:** `src/lib/authz/delegation.ts` (`grantsBeyondCeiling`, `projectLegacyPermissions`), `guards.ts` (`requireApiGrant` — 401/403), `page-guards.ts` (`requirePageGrant`), `audit.ts` (audit roster/delegation); `/api/admin/{roles,permissions,users}` ghi qua RPC; Role Manager dạng lưới action × scope; Account Manager khoá role vượt trần.
- **Seed `schema.sql` (S10):** hết ghi đè quyền Admin/Agent; xoá key cũ theo danh sách tường minh.
- **Cổng CI:** áp thêm rollout B, C (chứng minh idempotent) và `supabase/checks/ci-authz-rpc.sql` (tên dành riêng, trùng tên, role bảo vệ, tăng version, xoá role còn người, admin khôi phục cuối + rollback, audit).

Lệch so với spec, có lý do:

| Spec | Thực tế | Vì sao |
|---|---|---|
| C.2: 5 RPC (`save_role_grants_atomic`, `assign_user_role_atomic`, `set_account_active_atomic`, `change_account_email_atomic`, `delete_role_atomic`) | 4 RPC: role/trạng thái gộp vào `assign_account_access_atomic`; thêm `delete_account_atomic`. Đổi email vẫn là `update` + `bumpAccessVersion` ở app; thu hồi push ở app sau RPC | Role và trạng thái cùng chịu bất biến admin khôi phục nên chung khoá + transaction. Đổi email không đụng bất biến nào; `push_subscriptions` chỉ có trong rollout (S28) nên RPC trong `schema.sql` không tham chiếu được |
| C.2: trần uỷ quyền D10 nằm **trong** RPC | Trần kiểm ở route TS (`grantsBeyondCeiling`) ngay trước RPC; bất biến admin khôi phục nằm trong RPC | Grant của role chưa chuyển được suy trong TS (`deriveCompatGrants`, Phase B) — SQL không biết grant tương thích. Khe TOCTOU giữa kiểm và RPC ≤ độ trễ đổi quyền vốn có (30 s). Chuyển trần vào SQL khi mọi role đã `grants_managed` (Phase H) |
| C.1: DB cấm sửa/xoá role có `system_key` ngoài migration | `upsert_role_atomic` chặn sửa `super_admin`; `delete_role_atomic` chặn xoá mọi role có `system_key`. Không có trigger chặn `update` trực tiếp | Mọi đường ghi của app đi qua RPC; trigger sẽ chặn luôn migration hợp lệ |
| C.3: flag chọn UI cũ/mới (D13) | Không có flag; UI mới thay hẳn | UI cũ ghi permission phẳng, không biểu diễn được scope; API mới vẫn nhận `permissionKeys` cũ (`readRequestedGrants`) nên client cũ đang mở vẫn lưu được |
| C.5: `schema.sql` full-state (gộp 8 bảng chỉ có trong rollout) | **Hoãn.** Chỉ làm phần seed (S10) | Gộp bảng rollout vào file mà chủ repo chạy lại trên production kéo theo cả phần chuyển dữ liệu trong rollout. Làm riêng, có review, sau Phase D. CI vẫn áp các rollout đó theo tên |
| C.5: seed insert-only sinh từ catalog | Seed vẫn viết tay, nhưng insert-only (`on conflict do update` chỉ `is_system`) | Sinh SQL từ TS cần bước build mới; lợi ích nhỏ khi catalog còn đổi trong Phase D |
| C.6: kiểm "leo quyền" trên CI DB | Leo quyền kiểm bằng test route (`admin/roles/[id]/route.test.ts`, `admin/users/[id]/route.test.ts`) vì trần nằm ở TS | Theo dòng trên |

**Chạy tay trên production (sau rollout Phase B):** `supabase/rollouts/2026-09-28-authz-phase-c.sql`.
