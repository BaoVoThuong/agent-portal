-- Lead Management: schema nền. Forward-only.
-- Quy ước theo enrollment_records: uuid pk, custom_values jsonb cho cột do
-- admin thêm, archived_at cho soft-delete, email luôn chuẩn hoá lower+btrim.

create or replace function lead_norm_email(p_email text)
returns text language sql immutable set search_path = public as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

create table if not exists lead_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  location text,
  notes text,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- kind là thứ máy đọc; label là thứ người đọc. Admin đặt nhãn tiếng Việt hay
-- tiếng Anh tuỳ ý, engine cảnh báo chỉ nhìn kind.
create table if not exists lead_statuses (
  id uuid primary key default gen_random_uuid(),
  product text not null check (product in ('pc', 'health')),
  label text not null,
  color text,
  position integer not null default 0,
  kind text not null check (kind in ('open', 'scheduled', 'won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- counts_as_contact quyết định loại này có tắt đèn đỏ hay không.
-- Call/Text/Email = true, Note = false.
create table if not exists lead_interaction_types (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  color text,
  position integer not null default 0,
  counts_as_contact boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create sequence if not exists leads_display_number_seq;

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  display_number bigint not null default nextval('leads_display_number_seq'),
  product text not null check (product in ('pc', 'health')),
  event_id uuid references lead_events(id) on delete set null,
  full_name text,
  phone text,
  email text,
  assigned_to_email text,
  assigned_at timestamptz,
  assigned_by_email text,
  status_id uuid references lead_statuses(id) on delete restrict,
  -- Bốn cột dưới suy ra được từ lead_interactions nhưng cố tình lưu sẵn: bảng
  -- List phải hiện "3 lần thử, lần cuối 2 ngày trước" cho vài trăm dòng cùng
  -- lúc, aggregate cho từng dòng là đúng lỗi MEDIUM-09 trong review 23/08.
  -- log_lead_interaction_atomic là nơi DUY NHẤT được ghi bốn cột này.
  first_contacted_at timestamptz,
  last_contacted_at timestamptz,
  contact_attempt_count integer not null default 0,
  next_follow_up_at timestamptz,
  closed_at timestamptz,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_by_email text,
  updated_at timestamptz not null default now(),
  custom_values jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  client_request_id uuid
);

create table if not exists lead_interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  type_id uuid not null references lead_interaction_types(id) on delete restrict,
  status_id uuid references lead_statuses(id) on delete restrict,
  note text,
  actor_email text not null,
  occurred_at timestamptz not null default now(),
  follow_up_at timestamptz,
  client_request_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists lead_assignment_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  from_email text,
  to_email text,
  reason text,
  actor_email text not null,
  created_at timestamptz not null default now()
);

create table if not exists lead_alert_settings (
  product text primary key check (product in ('pc', 'health')),
  no_contact_hours integer not null default 24 check (no_contact_hours > 0),
  stale_days integer not null default 3 check (stale_days > 0),
  max_attempts integer not null default 4 check (max_attempts > 0),
  updated_by_email text,
  updated_at timestamptz not null default now()
);

insert into lead_alert_settings (product) values ('pc'), ('health')
on conflict (product) do nothing;



-- Index bám đúng cách bảng được đọc: luôn lọc archived_at is null, rồi lọc
-- theo product, rồi sắp theo created_at.
-- Bắt buộc phải có trước phần seed bên trên: `on conflict do nothing` không có
-- unique index nào để bấu vào thì nó im lặng không làm gì cả, và chạy lại
-- rollout lần hai sẽ nhân đôi toàn bộ từ vựng.
create unique index if not exists lead_interaction_types_label_unique_idx
  on lead_interaction_types (label) where archived_at is null;
create unique index if not exists lead_statuses_label_unique_idx
  on lead_statuses (product, label) where archived_at is null;

create index if not exists leads_product_active_idx
  on leads (product, created_at desc) where archived_at is null;
create index if not exists leads_assigned_idx
  on leads (assigned_to_email, product) where archived_at is null;
create index if not exists leads_event_idx on leads (event_id);
create index if not exists lead_interactions_lead_idx
  on lead_interactions (lead_id, occurred_at desc);
create index if not exists lead_assignment_history_lead_idx
  on lead_assignment_history (lead_id, created_at desc);

-- Chống import trùng: cùng một sự kiện không được có hai lead trùng số.
create unique index if not exists leads_event_phone_unique_idx
  on leads (event_id, phone) where phone is not null and archived_at is null;

-- Từ vựng mặc định. Admin sửa/xoá/thêm thoải mái sau, nhưng phải có sẵn thứ gì
-- đó ngay từ đầu: không có status và loại tương tác thì form ghi nhật ký chỉ
-- là hai dropdown rỗng và cả module không dùng được.
insert into lead_interaction_types (label, position, counts_as_contact) values
  ('Call',  10, true),
  ('Text',  20, true),
  ('Email', 30, true),
  ('Note',  40, false)
on conflict do nothing;

do $$
declare
  product_value text;
begin
  foreach product_value in array array['pc', 'health'] loop
    insert into lead_statuses (product, label, position, kind) values
      (product_value, 'New',             10, 'open'),
      (product_value, 'Working',         20, 'open'),
      (product_value, 'No answer',       30, 'open'),
      (product_value, 'Call back',       40, 'scheduled'),
      (product_value, 'Won',             50, 'won'),
      (product_value, 'Not interested',  60, 'lost'),
      (product_value, 'Wrong number',    70, 'lost')
    on conflict do nothing;
  end loop;
end $$;
