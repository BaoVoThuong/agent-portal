-- =====================================================================
-- Dọn hai cột provider còn sót lại trong `table_column`.
--
-- Bối cảnh: khi Provider List chuyển từ `provider_address` sang bảng sạch
-- `provider_directory` (commit b4a5242), hai cột này đã bị gỡ khỏi phần mặc
-- định trong MÃ NGUỒN (`src/lib/table-config/queries.ts`). Nhưng bảng thật lấy
-- danh sách cột từ DATABASE, không phải từ mã — nên hai dòng này vẫn sống và
-- vẫn hiện ra:
--
--   • `source`     — `hidden_default = false`, tức ĐANG HIỆN trên bảng. Nó trỏ
--                    vào `source_sheet_id`, trường không còn tồn tại ở bảng mới.
--                    Kết quả: một cột trống, bấm sửa thì API trả lỗi
--                    "source cannot be edited here."
--   • `synced_at`  — `hidden_default = true` nên đang ẩn, nhưng ai bật lên
--                    trong Table settings sẽ gặp đúng vấn đề đó.
--
-- Vì sao archive chứ không xoá: `fetchTableColumns...` lọc `archived_at is null`
-- (queries.ts:226) nên archive là đủ để cột biến mất khỏi giao diện, mà vẫn giữ
-- lại dấu vết cho ai cần tra sau này. Cùng lối với phần còn lại của hệ cấu hình
-- cột, vốn archive chứ không xoá.
--
-- Về layout cá nhân: có 1 bản ghi `user_table_layout` (scope provider) còn nhắc
-- tới hai khoá này. Không cần đụng — khoá thừa trong layout không khớp cột nào
-- nên bị bỏ qua khi dựng bảng.
--
-- Idempotent: mệnh đề `archived_at is null` khiến chạy lại không đổi gì thêm.
-- Chạy nguyên file trong một transaction; notify nằm sau commit.
-- =====================================================================

begin;

update public.table_column
set archived_at = now(),
    updated_at  = now()
where scope = 'provider'
  and key in ('source', 'synced_at')
  and archived_at is null;

-- ---------------------------------------------------------------------
-- Kiểm chứng — không đếm cứng tổng số cột vì admin có thể thêm custom column.
-- Chỉ kiểm các invariant mà rollout này sở hữu.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from public.table_column
    where scope = 'provider'
      and key in ('source', 'synced_at')
      and archived_at is null
  ) then
    raise exception 'Provider legacy columns are still active';
  end if;

  if not exists (
    select 1
    from public.table_column
    where scope = 'provider'
      and key = 'doctors'
      and archived_at is null
  ) then
    raise exception 'Provider columns look incomplete: doctors is missing';
  end if;
end $$;

select
  case when (select count(*) from public.table_column
             where scope = 'provider' and archived_at is null) >= 21
       then 'ok' else 'FAIL: provider columns look incomplete' end    as so_cot_song,
  case when (select count(*) from public.table_column
             where scope = 'provider'
               and key in ('source', 'synced_at')
               and archived_at is null) = 0
       then 'ok' else 'FAIL: vẫn còn cột cũ đang sống' end            as da_don_sach,
  case when (select count(*) from public.table_column
             where scope = 'provider'
               and key = 'needs_review'
               and archived_at is null) = 1
       then 'ok' else 'FAIL: thiếu cột needs_review' end              as co_needs_review;

-- Danh sách cột đang sống, để đối chiếu bằng mắt với màn hình.
select key, label, type, position, hidden_default
from public.table_column
where scope = 'provider' and archived_at is null
order by position;

commit;

notify pgrst, 'reload schema';
