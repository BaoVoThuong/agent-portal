-- =====================================================================
-- Carrier của ACA / Medicare chọn được NHIỀU hãng.
--
-- Cách lưu (giống leads.products / leads.product):
--   - `carrier_ids uuid[]` là nguồn sự thật, theo thứ tự người dùng chọn.
--   - `carrier_id` VẪN GIỮ và luôn = carrier_ids[1] (hãng đầu), do trigger
--     enrollment_sync_carrier_ids giữ khớp. Nhờ vậy khoá ngoại, ràng buộc
--     Medicaid, Overview ("đã điền Carrier chưa") và mọi đường ghi cũ chỉ biết
--     `carrier_id` vẫn chạy đúng.
--
-- Hai hàm ghi (patch_enrollment_atomic, create_enrollment_atomic) và hàm đếm
-- option đang dùng được VÁ TẠI CHỖ (mục 5) thay vì viết lại cả thân hàm: trong
-- repo có hai phiên bản khác nhau của hai hàm ghi (rollout 2026-08-09 và
-- schema.sql), không biết chắc production đang chạy bản nào. Vá theo đúng từng
-- đoạn chữ, và mỗi đoạn phải xuất hiện ĐÚNG MỘT lần — không khớp là dừng cả
-- file, không có gì được ghi.
--
-- Thứ tự: chạy file này TRƯỚC khi deploy code. Code cũ vẫn chạy bình thường
-- trên DB đã chạy file này (nó chỉ ghi `carrier_id`, trigger tự điền mảng).
--
-- Idempotent. Chạy lại lần hai là no-op. Supabase Studio bọc cả file trong MỘT
-- transaction, nên hỏng giữa chừng thì không có gì được ghi.
-- =====================================================================

-- ---------- 1. Cột mới + backfill ----------
alter table enrollment_records
  add column if not exists carrier_ids uuid[] not null default '{}'::uuid[];

-- Backfill TRƯỚC khi có trigger: trigger kiểm hãng thuộc đúng bộ Carrier của
-- chương trình, và dữ liệu cũ lệch chuẩn (nếu có) không được làm hỏng rollout.
update enrollment_records
set carrier_ids = array[carrier_id]
where carrier_id is not null
  and cardinality(carrier_ids) = 0;

create index if not exists enrollment_records_carrier_ids_idx
  on enrollment_records using gin (carrier_ids);

-- ---------- 2. Trigger giữ carrier_id = carrier_ids[1] ----------
-- Bản TS của luật này: src/lib/enrollment/carriers.ts và optimistic-patch.ts.
create or replace function enrollment_sync_carrier_ids()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  requested uuid[];
  previous uuid[];
begin
  if tg_op = 'UPDATE' and new.carrier_ids is distinct from old.carrier_ids then
    -- Ghi mảng: mảng là nguồn sự thật, kể cả mảng rỗng (= bỏ hết hãng).
    requested := coalesce(new.carrier_ids, '{}'::uuid[]);
  elsif tg_op = 'UPDATE' and new.carrier_id is distinct from old.carrier_id then
    -- Đường ghi một hãng kiểu cũ (client/RPC chưa biết carrier_ids): chọn hãng
    -- mới là bỏ danh sách cũ, y như ô một giá trị trước đây.
    requested := case when new.carrier_id is null then '{}'::uuid[]
                      else array[new.carrier_id] end;
  elsif tg_op = 'INSERT' and cardinality(coalesce(new.carrier_ids, '{}'::uuid[])) = 0 then
    requested := case when new.carrier_id is null then '{}'::uuid[]
                      else array[new.carrier_id] end;
  else
    requested := coalesce(new.carrier_ids, '{}'::uuid[]);
  end if;

  -- Bỏ null, bỏ trùng, giữ thứ tự chọn.
  requested := array(
    select item.id
    from unnest(requested) with ordinality as item(id, ord)
    where item.id is not null
    group by item.id
    order by min(item.ord)
  );

  -- Chỉ kiểm hãng MỚI thêm vào: hồ sơ đang giữ một hãng (kể cả đã archive)
  -- vẫn sửa được các trường khác.
  previous := case when tg_op = 'UPDATE'
                   then coalesce(old.carrier_ids, '{}'::uuid[])
                   else '{}'::uuid[] end;
  if exists (
    select 1
    from unnest(requested) as item(id)
    where not (item.id = any (previous))
      and not exists (
        select 1
        from enrollment_options option_row
        join enrollment_option_sets option_set on option_set.id = option_row.set_id
        where option_row.id = item.id
          and option_set.key = 'carrier'
          and option_set.program = new.program
      )
  ) then
    raise exception 'ENROLLMENT_CARRIER_INVALID';
  end if;

  new.carrier_ids := requested;
  new.carrier_id := requested[1];
  return new;
end;
$$;

drop trigger if exists enrollment_sync_carrier_ids_trg on enrollment_records;
create trigger enrollment_sync_carrier_ids_trg
  before insert or update of carrier_ids, carrier_id on enrollment_records
  for each row execute function enrollment_sync_carrier_ids();

-- ---------- 3. Bất biến: hai cột luôn khớp ----------
alter table enrollment_records
  drop constraint if exists enrollment_records_carrier_ids_sync_check;
alter table enrollment_records
  add constraint enrollment_records_carrier_ids_sync_check check (
    carrier_id is not distinct from carrier_ids[1]
  );

-- ---------- 4. Cột Carrier trong Table Configuration là multiselect ----------
update table_column
set type = 'multiselect', updated_at = now()
where scope in ('aca', 'medicare')
  and key = 'carrier'
  and is_system
  and type <> 'multiselect';

-- ---------- 5. Vá tại chỗ các hàm đọc/ghi Carrier ----------
-- p_pairs = [tìm_1, thay_1, tìm_2, thay_2, ...]. Mỗi đoạn "tìm" phải có ĐÚNG
-- MỘT lần trong định nghĩa hàm hiện tại, không thì dừng. Hàm đã có chữ
-- `carrier_ids` là đã vá rồi — bỏ qua, để chạy lại file là no-op.
-- `create or replace` giữ nguyên quyền (grant/revoke) đang có của hàm.
create or replace function pg_temp.enrollment_carrier_patch_function(
  p_name text,
  p_pairs text[],
  p_required boolean
) returns text
language plpgsql
as $$
declare
  fn_oid oid;
  fn_count integer;
  definition text;
  i integer;
  hits integer;
begin
  select count(*), min(p.oid) into fn_count, fn_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = p_name;

  if fn_count = 0 then
    if p_required then
      raise exception 'CARRIER_ROLLOUT: không thấy hàm public.%', p_name;
    end if;
    return p_name || ': không có trên DB này, bỏ qua';
  end if;
  if fn_count > 1 then
    raise exception 'CARRIER_ROLLOUT: public.% có % bản overload — dừng để kiểm tay',
      p_name, fn_count;
  end if;

  definition := pg_get_functiondef(fn_oid);
  if position('carrier_ids' in definition) > 0 then
    return p_name || ': đã vá từ trước';
  end if;

  for i in 1 .. array_length(p_pairs, 1) by 2 loop
    hits := (length(definition) - length(replace(definition, p_pairs[i], '')))
      / length(p_pairs[i]);
    if hits <> 1 then
      raise exception 'CARRIER_ROLLOUT: public.% — đoạn "%" xuất hiện % lần (cần đúng 1)',
        p_name, p_pairs[i], hits;
    end if;
    definition := replace(definition, p_pairs[i], p_pairs[i + 1]);
  end loop;

  execute definition;
  return p_name || ': đã vá';
end;
$$;

select pg_temp.enrollment_carrier_patch_function(
  'patch_enrollment_atomic',
  array[
    -- Danh sách khoá được phép trong p_patch.
    $f$'stage_id','carrier_id','platform_id'$f$,
    $r$'stage_id','carrier_id','carrier_ids','platform_id'$r$,
    -- Dòng SET: thêm carrier_ids ngay sau carrier_id.
    $f$carrier_id = case when p_patch ? 'carrier_id' then (p_patch->>'carrier_id')::uuid else carrier_id end,$f$,
    $r$carrier_id = case when p_patch ? 'carrier_id' then (p_patch->>'carrier_id')::uuid else carrier_id end,
    carrier_ids = case when p_patch ? 'carrier_ids'
      then array(select item.value::uuid from jsonb_array_elements_text(coalesce(nullif(p_patch->'carrier_ids', 'null'::jsonb), '[]'::jsonb)) with ordinality as item(value, ord) order by item.ord)
      else carrier_ids end,$r$
  ],
  true
) as patch_enrollment_atomic;

select pg_temp.enrollment_carrier_patch_function(
  'create_enrollment_atomic',
  array[
    $f$'stage_id','carrier_id','platform_id'$f$,
    $r$'stage_id','carrier_id','carrier_ids','platform_id'$r$,
    -- Danh sách cột của INSERT.
    $f$stage_id, carrier_id, platform_id,$f$,
    $r$stage_id, carrier_id, carrier_ids, platform_id,$r$,
    -- Giá trị tương ứng, cùng vị trí.
    $f$(p_record->>'stage_id')::uuid, (p_record->>'carrier_id')::uuid,$f$,
    $r$(p_record->>'stage_id')::uuid, (p_record->>'carrier_id')::uuid,
    array(select item.value::uuid from jsonb_array_elements_text(coalesce(nullif(p_record->'carrier_ids', 'null'::jsonb), '[]'::jsonb)) with ordinality as item(value, ord) order by item.ord),$r$
  ],
  true
) as create_enrollment_atomic;

-- Đếm hồ sơ đang dùng một option (Config chặn archive option đang được dùng).
-- Hãng thứ hai trở đi không có khoá ngoại nào che, nên phải đếm cả mảng.
select pg_temp.enrollment_carrier_patch_function(
  'enrollment_option_usage_count',
  array[
    $f$record_row.carrier_id = p_option_id$f$,
    $r$p_option_id = any (record_row.carrier_ids)$r$
  ],
  true
) as enrollment_option_usage_count;

select pg_temp.enrollment_carrier_patch_function(
  'enrollment_option_usage_counts',
  array[
    $f$select carrier_id from enrollment_records where archived_at is null$f$,
    $r$select unnest(carrier_ids) from enrollment_records where archived_at is null$r$
  ],
  false
) as enrollment_option_usage_counts;

notify pgrst, 'reload schema';

-- ---------- Kiểm chứng ----------
-- Một dòng. Mọi cột phải đọc ok.
select
  case when exists (select 1 from information_schema.columns
                    where table_name = 'enrollment_records' and column_name = 'carrier_ids')
       then 'ok' else 'FAIL: thiếu cột carrier_ids' end                       as carrier_ids_column,
  case when (select count(*) from enrollment_records
             where carrier_id is distinct from carrier_ids[1]) = 0
       then 'ok' else 'FAIL: carrier_id lệch carrier_ids[1]' end              as in_sync,
  case when exists (select 1 from pg_trigger
                    where tgname = 'enrollment_sync_carrier_ids_trg' and not tgisinternal)
       then 'ok' else 'FAIL: thiếu trigger' end                               as sync_trigger,
  case when position('carrier_ids' in pg_get_functiondef('public.patch_enrollment_atomic'::regproc)) > 0
        and position('carrier_ids' in pg_get_functiondef('public.create_enrollment_atomic'::regproc)) > 0
        and position('carrier_ids' in pg_get_functiondef('public.enrollment_option_usage_count'::regproc)) > 0
       then 'ok' else 'FAIL: hàm chưa được vá' end                            as functions_patched,
  (select string_agg(scope || '=' || type, ', ' order by scope)
   from table_column where key = 'carrier' and scope in ('aca', 'medicare'))  as carrier_column_type;
