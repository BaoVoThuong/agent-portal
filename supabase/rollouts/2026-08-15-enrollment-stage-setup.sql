-- Normalize the ACA and Medicare enrollment stage catalogs.
--
-- This migration is intentionally additive/archival:
--   * existing option IDs are reused when their labels map to a new stage;
--   * enrollment_records and enrollment_stage_history therefore keep their
--     foreign keys and historical meaning;
--   * stages outside the requested catalog are archived, never deleted;
--   * the migration is safe to run repeatedly.
--
-- Apply during a maintenance window. The application can continue to read
-- archived options for historical records, while new selectors expose only
-- active canonical stages.
--
-- ---------------------------------------------------------------------------
-- 2026-08-15 REVISION — two corrections. Do not revert to the earlier shape.
--
-- 1. WRAPPED IN A SINGLE `DO` BLOCK.
--    The previous version used top-level `create temporary table ... on commit
--    drop` and then referenced those tables from later statements. Clients that
--    do not execute the script as one unit (the Supabase Studio SQL editor is
--    one) drop the temp table before the next statement runs, producing:
--        ERROR: 42P01: relation "_enrollment_stage_setup" does not exist
--    As one `DO` block the whole migration is a single statement: no client can
--    split it, the temp tables live for its entire duration, and any failure
--    rolls back everything. The logic is otherwise unchanged.
--
-- 2. RECORDS ON A SOON-TO-BE-ARCHIVED STAGE ARE SET TO NULL.
--    Previously a record whose stage fell outside the canonical catalog kept
--    pointing at that stage after it was archived, so the value existed in the
--    row but could not be seen or re-selected in any picker. Those records now
--    get `stage_id = null` (with the matching `stage_entered_at` /
--    `stage_entered_source` pair cleared) so the gap is explicit and an
--    operator can reassign a canonical stage. Only active records are touched;
--    archived records keep their historical stage reference.
-- ---------------------------------------------------------------------------

do $mig$
declare
  missing_count integer;
  extra_count   integer;
  nulled_count  integer;
begin
  -- CỐ Ý không có "drop table if exists" ở đây. Hai bảng tạm bên dưới khai báo
  -- "on commit drop": commit thì tự mất, còn nếu khối này lỗi thì lệnh "create"
  -- cũng bị rollback. Chúng không thể tồn tại sẵn ở đầu transaction.
  -- Ngoài ra "drop table if exists <tên>" không kèm schema sẽ phân giải theo
  -- search_path và có thể xoá nhầm bảng thật cùng tên trong public.

  lock table enrollment_option_sets, enrollment_options in share row exclusive mode;

  insert into enrollment_option_sets (program, key, label, is_stage)
  values
    ('aca', 'stage', 'Stage', true),
    ('medicare', 'stage', 'Stage', true)
  on conflict (program, key) do update
  set label = excluded.label,
      is_stage = excluded.is_stage,
      updated_at = now();

  create temporary table _enrollment_stage_setup (
    program text not null,
    label text not null,
    color text not null,
    position integer not null,
    is_terminal boolean not null,
    treat_as_terminal boolean not null,
    triggers_qc boolean not null,
    primary key (program, label)
  ) on commit drop;

  insert into _enrollment_stage_setup
    (program, label, color, position, is_terminal, treat_as_terminal, triggers_qc)
  values
    ('aca', '1-Need quote', '#6B778C', 10, false, false, false),
    ('aca', '2-Quoted', '#0C66E4', 20, false, false, false),
    ('aca', '3-Waiting for Confirmation', '#F5A524', 30, false, false, false),
    ('aca', '4-Need documents', '#FFAB00', 40, false, false, false),
    ('aca', '5-Ready to Enroll', '#36B37E', 50, false, false, false),
    ('aca', '6-Enrolled', '#00A3BF', 60, false, false, false),
    ('aca', '7-1st payment done', '#6554C0', 70, false, false, false),
    ('aca', '8-Need assign PCP', '#FF7452', 80, false, false, false),
    ('aca', '9-Need ID card', '#00875A', 90, false, false, false),
    ('aca', '10-ID card done', '#00875A', 100, true, false, true),
    ('aca', '11-ID card unavailable', '#FF7452', 110, false, true, false),
    ('aca', '12-Terminated', '#C9372C', 120, true, false, false),
    ('medicare', '1-Need quote', '#6B778C', 10, false, false, false),
    ('medicare', '2-Quoted', '#0C66E4', 20, false, false, false),
    ('medicare', '3-Waiting for Confirmation', '#F5A524', 30, false, false, false),
    ('medicare', '4-Need documents', '#FFAB00', 40, false, false, false),
    ('medicare', '5-Ready to Enroll', '#36B37E', 50, false, false, false),
    ('medicare', '6-Enrolled-1stpayment done', '#6554C0', 60, false, false, false),
    ('medicare', '7-Need assign PCP', '#FF7452', 70, false, false, false),
    ('medicare', '8-Need ID card', '#00875A', 80, false, false, false),
    ('medicare', '9-ID card done', '#00875A', 90, true, false, true),
    ('medicare', '10-ID card unavailable', '#FF7452', 100, false, false, false),
    ('medicare', '11-Terminated', '#C9372C', 110, true, false, false);

  create temporary table _enrollment_stage_renames (
    program text not null,
    old_label text not null,
    new_label text not null,
    primary key (program, old_label)
  ) on commit drop;

  insert into _enrollment_stage_renames (program, old_label, new_label)
  values
    ('aca', '5-Ready to enroll', '5-Ready to Enroll'),
    ('aca', '9-Assigned PCP/Get ID Card', '9-Need ID card'),
    ('aca', '10-DONE', '10-ID card done'),
    ('aca', '11-Terminated', '12-Terminated'),
    ('aca', 'Can not get ID card', '11-ID card unavailable'),
    ('medicare', 'New', '1-Need quote'),
    ('medicare', 'E- ID Card Unavailable', '10-ID card unavailable'),
    ('medicare', '10 - DONE', '9-ID card done');

  -- Đổi tên tại chỗ, GIỮ NGUYÊN id — nên enrollment_records và
  -- enrollment_stage_history không mất tham chiếu. Nếu admin đã tự tạo sẵn
  -- nhãn đích thì bỏ qua, hàng cũ sẽ bị archive ở bước dọn dẹp bên dưới.
  update enrollment_options as options
  set label = renames.new_label,
      updated_at = now()
  from enrollment_option_sets as sets
  join _enrollment_stage_renames as renames
    on renames.program = sets.program
  where options.set_id = sets.id
    and sets.key = 'stage'
    and options.archived_at is null
    and lower(options.label) = lower(renames.old_label)
    and not exists (
      select 1
      from enrollment_options as target
      where target.set_id = options.set_id
        and target.archived_at is null
        and target.id <> options.id
        and lower(target.label) = lower(renames.new_label)
    );

  -- Chuẩn hoá chính tả, màu, thứ tự và ngữ nghĩa stage cho các hàng đang active.
  update enrollment_options as options
  set label = setup.label,
      color = setup.color,
      position = setup.position,
      is_terminal = setup.is_terminal,
      treat_as_terminal = setup.treat_as_terminal,
      triggers_qc = setup.triggers_qc,
      updated_at = now()
  from enrollment_option_sets as sets
  join _enrollment_stage_setup as setup
    on setup.program = sets.program
  where options.set_id = sets.id
    and sets.key = 'stage'
    and options.archived_at is null
    and lower(options.label) = lower(setup.label);

  -- Bổ sung stage chuẩn còn thiếu, không đụng tham chiếu sẵn có.
  insert into enrollment_options (
    set_id, label, color, position, is_terminal, treat_as_terminal, triggers_qc
  )
  select sets.id, setup.label, setup.color, setup.position,
         setup.is_terminal, setup.treat_as_terminal, setup.triggers_qc
  from enrollment_option_sets as sets
  join _enrollment_stage_setup as setup
    on setup.program = sets.program
  where sets.key = 'stage'
    and not exists (
      select 1
      from enrollment_options as existing
      where existing.set_id = sets.id
        and existing.archived_at is null
        and lower(existing.label) = lower(setup.label)
    );

  -- ─────────────────────────────────────────────────────────────────────
  -- THÊM (không có trong rollout gốc): record nào đang trỏ vào stage sắp bị
  -- archive thì đưa stage về NULL, thay vì để nó trỏ vào một stage không còn
  -- chọn được trong picker. Người dùng sẽ gán lại stage chuẩn sau.
  --
  -- Chạy TRƯỚC bước archive bên dưới, và SAU các bước đổi tên — nên stage đã
  -- được đổi sang nhãn chuẩn không lọt vào đây.
  --
  -- Đã kiểm tra trên DB thật trước khi viết:
  --   • enrollment_records.stage_id là nullable (schema.sql:4067)
  --   • table_column key='stage' có required=false ở cả aca và medicare
  --     → đưa về null không làm record bị chặn khi sửa
  --   • ràng buộc enrollment_records_stage_entered_pair_check chỉ buộc
  --     (stage_entered_at is null) = (stage_entered_source is null)
  --     → set cả hai về null là hợp lệ
  --
  -- CHỈ đụng record đang active (archived_at is null). Record đã xoá mềm thì
  -- không sửa được nữa, để chúng trỏ vào stage đã archive mới đúng lịch sử —
  -- nulling chúng chỉ phá thông tin chứ không được lợi gì.
  -- ─────────────────────────────────────────────────────────────────────
  update enrollment_records as records
  set stage_id = null,
      stage_entered_at = null,
      stage_entered_source = null
  from enrollment_options as options
  join enrollment_option_sets as sets on sets.id = options.set_id
  where records.stage_id = options.id
    and records.archived_at is null
    and sets.key = 'stage'
    and options.archived_at is null
    and not exists (
      select 1
      from _enrollment_stage_setup as setup
      where setup.program = sets.program
        and lower(setup.label) = lower(options.label)
    );
  get diagnostics nulled_count = row_count;

  -- Giữ lại hàng lịch sử để đọc được, nhưng không cho chọn stage ngoài catalog.
  update enrollment_options as options
  set archived_at = coalesce(options.archived_at, now()),
      updated_at = now()
  from enrollment_option_sets as sets
  where options.set_id = sets.id
    and sets.key = 'stage'
    and options.archived_at is null
    and not exists (
      select 1
      from _enrollment_stage_setup as setup
      where setup.program = sets.program
        and lower(setup.label) = lower(options.label)
    );

  -- ── Tự kiểm tra: sai là raise, cả khối rollback ────────────────────────
  select count(*)
    into missing_count
  from _enrollment_stage_setup as setup
  join enrollment_option_sets as sets
    on sets.program = setup.program and sets.key = 'stage'
  where not exists (
    select 1
    from enrollment_options as options
    where options.set_id = sets.id
      and options.archived_at is null
      and lower(options.label) = lower(setup.label)
  );

  if missing_count <> 0 then
    raise exception 'Thiếu % stage chuẩn sau khi chạy', missing_count;
  end if;

  select count(*)
    into extra_count
  from enrollment_option_sets as sets
  join enrollment_options as options on options.set_id = sets.id
  where sets.key = 'stage'
    and options.archived_at is null
    and not exists (
      select 1
      from _enrollment_stage_setup as setup
      where setup.program = sets.program
        and lower(setup.label) = lower(options.label)
    );

  if extra_count <> 0 then
    raise exception 'Còn % stage ngoài catalog đang active', extra_count;
  end if;

  raise notice 'OK. Số record được đưa stage về null: %', nulled_count;
end
$mig$;
