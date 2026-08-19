-- 2026-08-18 — Cài staging cho sheet sync + sửa lỗi 23502 trên health_raw_data.id
--
-- CHẠY LẠI FILE NÀY nếu bạn đã chạy bản trước đó. Toàn bộ là idempotent
-- (`if not exists` / `or replace`), chạy bao nhiêu lần cũng an toàn.
--
-- ── Vì sao cần ───────────────────────────────────────────────────────────────
-- Commit f0b327d (2026-08-11) chuyển datasync sang cơ chế nạp-tạm-rồi-hoán-đổi,
-- nhưng 2 bảng và 3 hàm đi kèm chưa bao giờ được cài lên database. Hậu quả:
--   * `npm run sync:health` / `sync:pc` chết ngay: PGRST202 begin_sheet_sync
--   * Cron Vercel /api/cron/sync-data cũng chết ở lần chạy kế tiếp
--
-- ── Lỗi thứ hai, phát hiện khi chạy thật ─────────────────────────────────────
-- Bản finalize_sheet_sync gốc chèn bằng:
--     insert into <bảng> select (jsonb_populate_record(null::<bảng>, payload)).*
-- Cách này cấp giá trị TƯỜNG MINH cho MỌI cột của bảng, kể cả cột payload
-- không có. Cấp tường minh NULL thì DEFAULT bị bỏ qua, nên:
--     health_raw_data.id  (uuid primary key default gen_random_uuid())
-- nhận NULL và vi phạm not-null → SQLSTATE 23502, sync Health hỏng hoàn toàn.
--
-- Cột `id` đó KHÔNG được xoá: nó là primary key. Nó tồn tại vì bảng này vốn là
-- bảng `health_mart` cũ được đổi tên (supabase/schema.sql dòng 5-11); lệnh
-- `create table if not exists` sau đó không đụng tới bảng đã có, nên cột id cũ
-- ở lại còn hai file schema thì không khai báo nó.
--
-- Bản sửa chỉ ghi những cột mà payload thực sự mang theo, để cột nào không có
-- thì DEFAULT tự chạy. Cột generated/identity cũng bị loại vì không ghi được.
--
-- ── Đã kiểm chứng ───────────────────────────────────────────────────────────
-- Dựng lại đúng cấu trúc bảng production (kể cả thứ tự cột) trên PostgreSQL
-- 16.8 cục bộ và chạy 4 kịch bản:
--   1. health_raw_data (có id)  → chèn đủ dòng, id được sinh tự động
--   2. gọi lại cùng run_id      → trả về số cũ, không nhân đôi dữ liệu
--   3. pc_raw_data (không id)   → vẫn chạy, không phá luồng đang hoạt động
--   4. staging rỗng             → trả 0, không ném lỗi
-- Bản cũ tái hiện đúng lỗi 23502 của production trước khi vá.
--
-- Chạy được trong Supabase Studio: không CREATE INDEX CONCURRENTLY, không temp
-- table, nên bị bọc trong transaction cũng không sao.

-- Sheet refreshes are staged here and atomically promoted by finalize_sheet_sync().
-- Keeping the payload as JSON lets one staging contract serve the three raw tables,
-- while the finalizer only permits the known table names below.
create table if not exists public.sheet_sync_runs (
  run_id uuid primary key,
  target_table text not null,
  source_sheet_id text not null,
  source_gid text not null,
  status text not null default 'running' check (status in ('running', 'finalized')),
  inserted_count integer not null default 0,
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);

create table if not exists public.sheet_sync_staging (
  run_id uuid not null references public.sheet_sync_runs(run_id) on delete cascade,
  target_table text not null,
  source_sheet_id text not null,
  source_gid text not null,
  source_row_number integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, target_table, source_sheet_id, source_gid, source_row_number)
);

create index if not exists sheet_sync_staging_created_idx
  on public.sheet_sync_staging (created_at);

revoke all on table public.sheet_sync_runs, public.sheet_sync_staging
  from public, anon, authenticated;
grant all on table public.sheet_sync_runs, public.sheet_sync_staging to service_role;

create or replace function public.begin_sheet_sync(
  p_run_id uuid,
  p_target_table text,
  p_source_sheet_id text,
  p_source_gid text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_run_id is null
    or p_target_table not in ('provider_address', 'pc_raw_data', 'health_raw_data')
    or nullif(btrim(p_source_sheet_id), '') is null
    or nullif(btrim(p_source_gid), '') is null then
    raise exception 'invalid sheet sync metadata';
  end if;

  insert into public.sheet_sync_runs (run_id, target_table, source_sheet_id, source_gid)
  values (p_run_id, p_target_table, p_source_sheet_id, p_source_gid)
  on conflict (run_id) do update
    set target_table = excluded.target_table,
        source_sheet_id = excluded.source_sheet_id,
        source_gid = excluded.source_gid
  where public.sheet_sync_runs.status = 'running'
    and public.sheet_sync_runs.target_table = excluded.target_table
    and public.sheet_sync_runs.source_sheet_id = excluded.source_sheet_id
    and public.sheet_sync_runs.source_gid = excluded.source_gid;

  if not exists (
    select 1 from public.sheet_sync_runs
    where run_id = p_run_id
      and target_table = p_target_table
      and source_sheet_id = p_source_sheet_id
      and source_gid = p_source_gid
  ) then
    raise exception 'run id is already finalized with different metadata';
  end if;
end;
$$;

create or replace function public.finalize_sheet_sync(
  p_run_id uuid,
  p_target_table text,
  p_source_sheet_id text,
  p_source_gid text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_row public.sheet_sync_runs%rowtype;
  v_inserted_count integer;
  v_payload_keys text[];
  v_insert_columns text;
  v_select_columns text;
begin
  if p_run_id is null
    or p_target_table not in ('provider_address', 'pc_raw_data', 'health_raw_data')
    or nullif(btrim(p_source_sheet_id), '') is null
    or nullif(btrim(p_source_gid), '') is null then
    raise exception 'invalid sheet sync metadata';
  end if;

  select * into run_row
  from public.sheet_sync_runs
  where run_id = p_run_id
  for update;

  if not found then
    raise exception 'unknown sheet sync run';
  end if;

  if run_row.target_table <> p_target_table
    or run_row.source_sheet_id <> p_source_sheet_id
    or run_row.source_gid <> p_source_gid then
    raise exception 'sheet sync metadata does not match run';
  end if;

  if run_row.status = 'finalized' then
    return run_row.inserted_count;
  end if;

  -- Only write columns the payload actually carries. The previous version used
  -- `select (jsonb_populate_record(...)).*`, which supplies a value for EVERY
  -- column of the target rowtype, including ones absent from the payload. An
  -- explicit NULL suppresses the column DEFAULT, so health_raw_data.id (uuid
  -- primary key default gen_random_uuid()) received NULL and failed its
  -- not-null constraint with 23502. Leaving the column out of the list is what
  -- lets the default fire. Generated and identity columns are excluded for the
  -- same reason: they cannot be written directly.
  -- One staged row is enough: rowToRecord() in datasync/lib/transform.js builds
  -- every record from the same config.columns list and always assigns each
  -- target (null included), so the key set is identical across the run.
  -- Aggregating over all rows instead costs 285ms per 14.7k rows versus 1ms,
  -- and that difference is most of the statement-timeout budget.
  select array_agg(k)
    into v_payload_keys
  from jsonb_object_keys((
    select s.payload
    from public.sheet_sync_staging s
    where s.run_id = p_run_id
      and s.target_table = p_target_table
      and s.source_sheet_id = p_source_sheet_id
      and s.source_gid = p_source_gid
    limit 1
  )) as k;

  -- Serialize replacement of one source partition. A concurrent run may stage
  -- independently, but only one can promote at a time.
  perform pg_advisory_xact_lock(
    hashtextextended(p_target_table || '|' || p_source_sheet_id || '|' || p_source_gid, 0)
  );

  execute format(
    'delete from public.%I where source_sheet_id = $1 and source_gid = $2',
    p_target_table
  ) using p_source_sheet_id, p_source_gid;

  if v_payload_keys is null then
    -- Nothing staged. Keep the documented contract: an emptied sheet empties
    -- the partition rather than erroring.
    v_inserted_count := 0;
  else
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
           string_agg('r.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
      into v_insert_columns, v_select_columns
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = p_target_table
      and c.is_generated = 'NEVER'
      and c.is_identity = 'NO'
      and c.column_name = any(v_payload_keys);

    if v_insert_columns is null then
      raise exception
        'no writable column of public.% matches the staged payload keys (%)',
        p_target_table, array_to_string(v_payload_keys, ', ');
    end if;

    execute format(
      'insert into public.%I (%s)
         select %s
         from public.sheet_sync_staging s
         cross join lateral jsonb_populate_record(null::public.%I, s.payload) r
         where s.run_id = $1
           and s.target_table = $2
           and s.source_sheet_id = $3
           and s.source_gid = $4
         order by s.source_row_number',
      p_target_table, v_insert_columns, v_select_columns, p_target_table
    ) using p_run_id, p_target_table, p_source_sheet_id, p_source_gid;

    get diagnostics v_inserted_count = row_count;
  end if;

  update public.sheet_sync_runs
  set status = 'finalized', inserted_count = v_inserted_count,
      finalized_at = clock_timestamp()
  where run_id = p_run_id;

  delete from public.sheet_sync_staging where run_id = p_run_id;
  return v_inserted_count;
end;
$$;

create or replace function public.purge_sheet_sync_staging(
  p_before timestamptz default now() - interval '24 hours'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed_count integer;
begin
  delete from public.sheet_sync_runs
  where created_at < coalesce(p_before, now() - interval '24 hours');
  get diagnostics removed_count = row_count;
  return removed_count;
end;
$$;

revoke all on function public.begin_sheet_sync(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.begin_sheet_sync(uuid, text, text, text) to service_role;
revoke all on function public.finalize_sheet_sync(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finalize_sheet_sync(uuid, text, text, text) to service_role;
revoke all on function public.purge_sheet_sync_staging(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_sheet_sync_staging(timestamptz) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Dọn rác của lần chạy hỏng. Lần finalize thất bại đã cuộn lại (dữ liệu gốc
-- còn nguyên) nhưng các dòng đã nạp vào staging thì được commit ở bước trước
-- nên vẫn nằm lại. Xoá run mồ côi; staging tự xoá theo (on delete cascade).
-- Chặn theo mốc 5 phút để không đụng vào một lần sync đang chạy dở.
-- ─────────────────────────────────────────────────────────────────────────────
delete from public.sheet_sync_runs
where status = 'running'
  and created_at < now() - interval '5 minutes';

-- ─────────────────────────────────────────────────────────────────────────────
-- LỐI THOÁT DỰ PHÒNG — chỉ chạy nếu VẪN gặp lỗi 57014 (statement timeout).
--
-- Bỏ dấu -- ở dòng ALTER ROLE bên dưới rồi chạy lại.
--
-- Vì sao phải làm ở tầng role: đặt `set statement_timeout` ngay trong hàm KHÔNG
-- có tác dụng. Đã thử trên PostgreSQL 16.8: bộ đếm được lên cò lúc câu lệnh
-- ngoài bắt đầu, đổi giá trị bên trong hàm không lên cò lại, hàm vẫn bị giết.
-- Thiết lập theo role thì được áp trước khi câu lệnh chạy nên mới ăn.
--
-- Đánh đổi: nới cho MỌI truy vấn của service_role, không riêng sync. Một truy
-- vấn chạy lỗi sẽ ngốn 2 phút thay vì bị cắt sau vài giây. Chỉ dùng khi cần.
--
-- alter role service_role set statement_timeout = '120s';

-- ─────────────────────────────────────────────────────────────────────────────
-- KIỂM TRA. Studio KHÔNG hiện `raise notice`, nên trả về dạng bảng để đọc.
-- Mong đợi: 6 dòng, cột `ok` đều là true.
-- ─────────────────────────────────────────────────────────────────────────────
select 'table  sheet_sync_runs' as doi_tuong,
       to_regclass('public.sheet_sync_runs') is not null as ok
union all
select 'table  sheet_sync_staging',
       to_regclass('public.sheet_sync_staging') is not null
union all
select 'func   begin_sheet_sync',
       to_regprocedure('public.begin_sheet_sync(uuid,text,text,text)') is not null
union all
select 'func   finalize_sheet_sync',
       to_regprocedure('public.finalize_sheet_sync(uuid,text,text,text)') is not null
union all
select 'func   purge_sheet_sync_staging',
       to_regprocedure('public.purge_sheet_sync_staging(timestamptz)') is not null
union all
-- Dau hieu KHANG DINH: bien v_insert_columns chi co trong ban da va. Khong dung
-- cach tim chuoi cua ban cu, vi chuoi do con nam trong comment mo ta loi.
select 'finalize DA duoc va (chi ghi cot ma payload co)',
       (select prosrc like '%v_insert_columns%'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'finalize_sheet_sync');
