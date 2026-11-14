# Health State Licensing Map — plan

Ngày: 2026-11-14 · Người yêu cầu: anh Khang (qua user) · Trạng thái: CHỜ DUYỆT, chưa code.

## 1. Bối cảnh (đọc trước, không cần biết gì khác)

Hiện bản đồ "Health State Licensing Map" là một ẢNH thiết kế tay (poster EPS, "Last Updated
06/09/2026"): bản đồ Mỹ tô xanh các bang công ty được appoint, kèm bảng 30 bang × 5 cột sản phẩm
(Obamacare, Medicare Advantage, Medicare PDP, Medicare Supplement, UHC), mỗi ô là danh sách hãng
(carrier). Mỗi lần có hãng/bang mới thì phải thiết kế lại ảnh.

Mục tiêu: đưa thành một trang trong agent-portal, dữ liệu trong Supabase, người có quyền sửa trực
tiếp. User đã chốt (2026-11-14):

| Câu hỏi | Chốt |
|---|---|
| Nơi đặt | Trang trong agent-portal |
| Thêm được gì | bang/hãng mới; cột sản phẩm mới (vd Dental); chi tiết từng ô; lịch sử thay đổi |
| Chi tiết mỗi ô (hãng × sản phẩm × bang) | ngày appoint + ghi chú; agent nào đã appoint; trạng thái Active/Pending/Terminated |
| Quyền | 2 ô tick trong Role Manager: View / Manage (Manage bao gồm View) |
| Menu | "Nhóm Health" — portal CHƯA có nhóm tên Health (xem câu hỏi mở Q1) |
| Dữ liệu ban đầu | Theo file CSV `Appointment list.csv` (mới hơn ảnh; khác ảnh ở AR, FL, TN, AZ, WA) |

Luật dự án phải theo (từ memory, không suy ra được từ code):
- RBAC chỉ bằng tick quyền; không hardcode tên role. Mỗi rollout thêm quyền phải cấp luôn cho role Admin
  (xem `src/lib/rbac/admin-role.ts`).
- UI theo kiểu module Task: ít chữ mô tả, ô tick hơn toggle, khung cố định cuộn bên trong, dialog theo
  kiểu "New enrollment". Hiện TÊN người, không hiện email (`personLabel` / `formatEmailAsName` ở
  `src/lib/tasks/people.ts`).
- Dưới 768px: bảng → thẻ (xem `src/lib/use-is-phone.ts`).
- Mọi thay đổi logic ghi vào `changelog.md` (entry mới trên cùng).
- File rollout SQL mới KHÔNG commit; chạy qua Supabase CLI và PHẢI hỏi user trước mỗi lần chạy.
- Không tự commit/push. Local dev = DB production → không tạo dữ liệu TEST tuỳ tiện.
- Next.js 16.2.4 có thay đổi so với kiến thức cũ: đọc `node_modules/next/dist/docs/` trước khi viết
  route/page.

## 2. Mô hình dữ liệu

Một "appointment" = 1 hãng × 1 sản phẩm × 1 bang. Ô bảng = mọi appointment cùng (bang, sản phẩm).

Bang KHÔNG có bảng riêng: danh sách 50 bang + DC là hằng số trong code (đã có `STATE_NAME_TO_ABBR`
trong `src/app/(authed)/sales-dashboard/pc/PcStateHeatMap.tsx` — tách ra `src/lib/us-states.ts` để
dùng chung). "Thêm bang" = thêm appointment đầu tiên cho bang đó; bang có ≥1 appointment không
Terminated thì tô màu trên bản đồ và có dòng trong bảng.

Rollout `supabase/rollouts/2026-11-14-health-licensing.sql` (+ chép phần schema vào
`supabase/schema.sql`):

```sql
begin;

-- Cột sản phẩm. Manage thêm/đổi tên/sắp xếp/ẩn; key không đổi sau khi tạo.
create table if not exists licensing_products (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null check (length(btrim(label)) between 1 and 60),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into licensing_products (key, label, sort_order) values
  ('obamacare', 'Obamacare', 100),
  ('medicare_advantage', 'Medicare Advantage', 200),
  ('medicare_pdp', 'Medicare PDP', 300),
  ('medicare_supplement', 'Medicare Supplement', 400),
  ('uhc', 'UHC', 500)
on conflict (key) do nothing;

create table if not exists licensing_appointments (
  id uuid primary key default gen_random_uuid(),
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  product_key text not null references licensing_products(key) on update cascade,
  carrier text not null check (length(btrim(carrier)) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'pending', 'terminated')),
  appointed_on date,
  note text check (note is null or length(note) <= 1000),
  sort_order int not null default 0,          -- thứ tự hãng trong ô (giữ thứ tự như CSV)
  created_at timestamptz not null default now(),
  created_by uuid references portal_account(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references portal_account(id),
  deleted_at timestamptz
);

create unique index if not exists licensing_appointments_cell_carrier_key
  on licensing_appointments (state_code, product_key, lower(btrim(carrier)))
  where deleted_at is null;
create index if not exists licensing_appointments_state_idx
  on licensing_appointments (state_code) where deleted_at is null;

-- Agent nào đã được appoint với hãng đó ở bang đó (cho sản phẩm đó).
create table if not exists licensing_appointment_agents (
  appointment_id uuid not null references licensing_appointments(id) on delete cascade,
  account_id uuid not null references portal_account(id) on delete restrict,
  appointed_on date,
  primary key (appointment_id, account_id)
);
create index if not exists licensing_appointment_agents_account_idx
  on licensing_appointment_agents (account_id);

-- Lịch sử. "Last Updated" trên trang = max(created_at).
create table if not exists licensing_events (
  id bigint generated always as identity primary key,
  appointment_id uuid references licensing_appointments(id) on delete set null,
  product_key text,
  state_code text,
  action text not null check (action in (
    'appointment.create', 'appointment.update', 'appointment.delete',
    'product.create', 'product.update')),
  before jsonb,
  after jsonb,
  actor_id uuid references portal_account(id),
  created_at timestamptz not null default now()
);
create index if not exists licensing_events_created_idx on licensing_events (created_at desc);

alter table licensing_products enable row level security;
alter table licensing_appointments enable row level security;
alter table licensing_appointment_agents enable row level security;
alter table licensing_events enable row level security;
-- Không policy nào: chỉ service role (getSupabaseAdmin) đọc/ghi, như các bảng khác của portal.

-- Quyền
insert into permissions (key, label, description, group_key, group_label, sort_order) values
  ('health_licensing.manage', 'State Licensing - Manage',
   'Everything in State Licensing - View, plus: add, edit and remove appointments, agents and product columns.',
   'health_licensing', 'State Licensing', 100),
  ('health_licensing.view', 'State Licensing - View',
   'Open the Health State Licensing Map and see every appointment and its history.',
   'health_licensing', 'State Licensing', 200)
on conflict (key) do update set label = excluded.label, description = excluded.description,
  group_key = excluded.group_key, group_label = excluded.group_label, sort_order = excluded.sort_order;

-- Admin giữ mọi quyền (src/lib/rbac/admin-role.ts). Chỉ cần lưu Manage — Manage bao gồm View.
insert into role_permissions (role_id, permission_key)
select r.id, 'health_licensing.manage' from roles r where lower(btrim(r.name)) = 'admin'
on conflict (role_id, permission_key) do nothing;

commit;
notify pgrst, 'reload schema';
```

Hàm ghi (để thay đổi + dòng lịch sử nằm trong CÙNG một transaction):

```sql
-- p_id null = tạo mới. p_agents: [{"account_id": uuid, "appointed_on": "YYYY-MM-DD"|null}] — thay toàn bộ.
create or replace function public.licensing_save_appointment(
  p_id uuid, p_state_code text, p_product_key text, p_carrier text, p_status text,
  p_appointed_on date, p_note text, p_agents jsonb, p_actor uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_before jsonb; v_after jsonb;
begin
  if p_id is not null then
    select to_jsonb(a) || jsonb_build_object('agents', coalesce((
      select jsonb_agg(jsonb_build_object('account_id', x.account_id, 'appointed_on', x.appointed_on)
                       order by x.account_id)
      from licensing_appointment_agents x where x.appointment_id = a.id), '[]'::jsonb))
    into v_before from licensing_appointments a where a.id = p_id and a.deleted_at is null for update;
    if v_before is null then raise exception 'LICENSING_NOT_FOUND'; end if;
    update licensing_appointments set state_code = p_state_code, product_key = p_product_key,
      carrier = btrim(p_carrier), status = p_status, appointed_on = p_appointed_on,
      note = nullif(btrim(p_note), ''), updated_at = now(), updated_by = p_actor
    where id = p_id returning id into v_id;
  else
    insert into licensing_appointments (state_code, product_key, carrier, status, appointed_on, note,
      sort_order, created_by, updated_by)
    values (p_state_code, p_product_key, btrim(p_carrier), p_status, p_appointed_on,
      nullif(btrim(p_note), ''),
      coalesce((select max(sort_order) + 1 from licensing_appointments
                where state_code = p_state_code and product_key = p_product_key and deleted_at is null), 0),
      p_actor, p_actor)
    returning id into v_id;
  end if;

  delete from licensing_appointment_agents where appointment_id = v_id;
  insert into licensing_appointment_agents (appointment_id, account_id, appointed_on)
  select v_id, (e->>'account_id')::uuid, nullif(e->>'appointed_on', '')::date
  from jsonb_array_elements(coalesce(p_agents, '[]'::jsonb)) e;

  select to_jsonb(a) || jsonb_build_object('agents', coalesce(p_agents, '[]'::jsonb))
  into v_after from licensing_appointments a where a.id = v_id;

  insert into licensing_events (appointment_id, product_key, state_code, action, before, after, actor_id)
  values (v_id, p_product_key, p_state_code,
          case when p_id is null then 'appointment.create' else 'appointment.update' end,
          v_before, v_after, p_actor);
  return v_id;
exception when unique_violation then raise exception 'LICENSING_DUPLICATE_CARRIER';
end $$;

-- Xoá mềm: deleted_at + event 'appointment.delete'. Tương tự licensing_save_product(p_key, p_label,
-- p_sort_order, p_is_active, p_actor) cho cột sản phẩm (create nếu key chưa có, update nếu có).
revoke all on function public.licensing_save_appointment(uuid,text,text,text,text,date,text,jsonb,uuid)
  from public, anon, authenticated;
```

Seed từ CSV: script `scripts/licensing-seed-from-csv.mjs` đọc CSV → sinh
`supabase/rollouts/2026-11-14-health-licensing-seed.sql` (insert thẳng, `created_by` null, mỗi hãng 1
dòng, `sort_order` = vị trí trong ô, status 'active', 1 event `appointment.create` cho cả lô với actor
null). Giữ nguyên chữ hãng như CSV, kể cả "HealthSpring (SHL)" — không tách "(SHL)" ra ghi chú (xem Q3).
Cột CSV → product key: Obamacare→obamacare, Medicare Advantage→medicare_advantage, Medicare PDP→
medicare_pdp, Medicare Supplement→medicare_supplement, UHC→uhc. Cột "State" dạng "Texas - TX" → lấy 2
chữ cuối. Ô rỗng → không tạo dòng. Seed idempotent: `on conflict do nothing` theo unique index.

## 3. Quyền trong code

`src/lib/rbac/permissions.ts`:
- `PERMISSIONS.HEALTH_LICENSING_VIEW = "health_licensing.view"`,
  `PERMISSIONS.HEALTH_LICENSING_MANAGE = "health_licensing.manage"`.
- `IMPLIED_PERMISSIONS[HEALTH_LICENSING_MANAGE] = [HEALTH_LICENSING_VIEW]`.
- 2 mục trong `PERMISSION_DEFINITIONS`, group `health_licensing` / "State Licensing", chữ y như SQL.

`src/lib/health-licensing/access.ts` (mẫu: `src/lib/time-off/access.ts`):

```ts
export type LicensingActor = { accountId: string; name: string; canManage: boolean };
export function canViewLicensing(u: { permissions?: readonly string[] }) {
  return canAny(u.permissions, [PERMISSIONS.HEALTH_LICENSING_VIEW, PERMISSIONS.HEALTH_LICENSING_MANAGE]);
}
export function canManageLicensing(u: { permissions?: readonly string[] }) {
  return can(u.permissions, PERMISSIONS.HEALTH_LICENSING_MANAGE);
}
export async function getLicensingActor(): Promise<LicensingActor | null>; // auth() + portal_account active, như getTimeOffActor
```

Menu (`src/app/(authed)/_components/Sidebar.tsx`) + `src/lib/rbac/routes.ts`: thêm `/health/licensing`
với `anyPermission: [VIEW, MANAGE]`. Trong `ACCESSIBLE_ROUTES` đặt CUỐI danh sách để không đổi trang
đích sau đăng nhập của ai. Vị trí menu: xem Q1.

Kiểm thử: thêm vào các test hiện có bảo đảm PERMISSION_DEFINITIONS khớp key (`permissions.test.ts`,
`no-role-name-authz.test.ts` phải vẫn xanh); test mới `access.test.ts` cho can*.

## 4. API (`src/app/api/health-licensing/`)

Mọi route: `getLicensingActor()` → 401; ghi thì thêm `canManage` → 403. Lỗi DB dịch qua một
`databaseMessage()` (LICENSING_DUPLICATE_CARRIER → "This carrier is already listed for that state and
product.", LICENSING_NOT_FOUND → "This appointment was removed. Reload the page.").

| Route | Việc |
|---|---|
| `GET /api/health-licensing` | `{ products, appointments (kèm agents[{accountId,name,appointedOn}]), lastUpdatedAt }` — bảng nhỏ (~250 dòng), đọc 1 lần; vẫn dùng `readAllRowsById` cho chắc trần 1.000 |
| `POST /api/health-licensing/appointments` | tạo (RPC `licensing_save_appointment` p_id null) |
| `PATCH /api/health-licensing/appointments/[id]` | sửa |
| `DELETE /api/health-licensing/appointments/[id]` | xoá mềm |
| `POST/PATCH /api/health-licensing/products[/key]` | thêm/sửa cột |
| `GET /api/health-licensing/history?before=<id>` | 50 event/lần, keyset theo id, kèm tên actor |
| `GET /api/health-licensing/agents` | account active có position kind 'agent' (`portal_account.position_id → positions.kind = 'agent'`), trả id + tên |

Kiểm tra đầu vào ở route: state_code thuộc danh sách 51 bang; product_key tồn tại & active; carrier
1–80 ký tự; status thuộc 3 giá trị; ngày đúng `YYYY-MM-DD`; note ≤1000; agents ≤200, mỗi id là agent
active.

Trang server `src/app/(authed)/health/licensing/page.tsx` gọi cùng hàm đọc
(`src/lib/health-licensing/queries.ts`) để render lần đầu không chờ fetch, như `time-off/page.tsx`.

## 5. Giao diện

Một trang, hai vùng — giống poster nhưng sống:

1. **Bản đồ** (`LicensingMap.tsx`, SVG thuần bằng `d3-geo` `geoAlbersUsa` + `us-atlas/states-10m.json`
   + `topojson-client`, giống cách `PcStateHeatMap.tsx` dòng 187–214 dựng path; KHÔNG cần ECharts).
   Bang có appointment Active → xanh đậm; chỉ Pending → xanh nhạt có viền đứt; còn lại xám nhạt.
   Nhãn mã bang ở tâm (bang nhỏ vùng Đông Bắc dùng leader line như poster). Hover = tooltip số hãng
   theo sản phẩm; bấm bang = mở ngăn chi tiết bang. Góc phải: "Last updated <ngày> by <tên>".
2. **Bảng** (`LicensingTable.tsx`): dòng = bang có appointment (sắp theo tên), cột = sản phẩm active
   theo `sort_order`. Ô = các chip hãng: Active chữ thường, Pending chip vàng, Terminated ẩn mặc định
   (ô tick "Show terminated" trên toolbar). Toolbar: ô tìm hãng (lọc dòng + làm mờ bang trên map),
   chọn sản phẩm. Khung cố định, cuộn bên trong, header dính.
3. **Ngăn chi tiết bang** (drawer phải, kiểu drawer Enrollment): nhóm theo sản phẩm, mỗi hãng một
   dòng: trạng thái, ngày appoint, ghi chú, avatar+tên agents. Manage thấy nút sửa/xoá và "+ Add
   carrier" ở mỗi sản phẩm.
4. **Dialog Add/Edit appointment** (kiểu New enrollment): State (select 51 bang), Product, Carrier
   (input có gợi ý từ các hãng đã có), Status, Appointed on, Note, Agents (multi-select tên agent, mỗi
   agent có ô ngày riêng tuỳ chọn). Nút "+ Add appointment" trên toolbar (chỉ Manage) mở dialog trống
   — đây là đường "thêm bang mới".
5. **Products** (chỉ Manage, nút "Columns" trên toolbar): danh sách cột, đổi tên, kéo/nút lên-xuống,
   ô tick Active, thêm cột mới (label → key tự sinh dạng snake_case).
6. **History** (nút trên toolbar, ai View cũng xem): danh sách sự kiện mới nhất trước, mỗi dòng "Tên ·
   thời gian · thêm/sửa/xoá Hãng · Sản phẩm · Bang" + diff các trường đổi; "Load more".
7. **Điện thoại (<768px)**: bản đồ thu nhỏ trên cùng; bảng thành thẻ theo bang (tiêu đề bang, mỗi sản
   phẩm một dòng chip); drawer thành sheet đáy.

Không làm trong đợt này: xuất ảnh/PDF poster, Export/Import Excel, thông báo chuông (xem Q4).

## 6. Thứ tự làm

1. `src/lib/us-states.ts` (tách từ PcStateHeatMap, PcStateHeatMap import lại) + test.
2. Rollout SQL schema + hàm + quyền; script seed + file seed SQL. **Hỏi user trước khi chạy cả hai
   lên prod.** Chạy xong mới deploy code (role_permissions có FK tới permissions).
3. permissions.ts / access.ts / routes.ts / Sidebar + test.
4. queries.ts + API routes + test validate.
5. Page + Map + Table + Drawer (chỉ đọc) → user xem localhost.
6. Dialog sửa, Products, History.
7. Mobile.
8. `changelog.md` entry; `npm run lint`, `npx tsc --noEmit`, `npx vitest run`.
9. Báo user; không commit/push.

## 7. Câu hỏi mở

- **Q1 Menu**: portal không có nhóm "Health". Đề xuất: thêm nhóm menu mới "Health" (đặt sau Dashboard)
  có một mục "State Licensing Map" — sau này các trang Health khác có thể dời vào. Hay để trong
  "Customer Registration" cạnh "Health"?
- **Q2 Agent cho từng ô**: ai sẽ nhập danh sách agent? Nếu ~50 agent × ~250 ô thì rất nhiều; có muốn
  thêm nút "Áp agent này cho mọi hãng của bang X" không (đợt sau)?
- **Q3 "(SHL)"**: giữ "HealthSpring (SHL)" là một hãng riêng (lọc "HealthSpring" vẫn khớp vì tìm theo
  chuỗi con), hay tách thành HealthSpring + ghi chú "SHL"?
- **Q4** Cần báo chuông khi có hãng/bang mới không?
