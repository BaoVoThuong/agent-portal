-- =====================================================================
-- Event Leads: thêm cột FUB link.
--
-- Bảng `tasks` đã có `fub_link` từ lâu và màn CS Task hiện một mũi tên xanh
-- cạnh tên để mở thẳng hồ sơ FUB. Leads chưa có gì tương đương, nên muốn mở
-- hồ sơ của một lead thì phải tự đi tìm trong FollowUpBoss.
--
-- Đặt tên `fub_link` trùng với `tasks.fub_link` một cách cố ý: hai màn hình làm
-- cùng một việc thì nên gọi cùng một tên, để người đọc code sau này không phải
-- kiểm xem hai bên có khác nhau chỗ nào không.
--
-- Chỉ thêm cột, không đụng dữ liệu cũ. Mọi lead hiện có sẽ có giá trị NULL và
-- mũi tên đơn giản là không hiện — giống hệt cách một task chưa nhập FUB.
--
-- Idempotent: `if not exists` nên chạy lại không lỗi.
-- ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================

begin;

alter table public.leads
  add column if not exists fub_link text;

-- ---------------------------------------------------------------------
-- Kiểm chứng — cả hai cột phải ra 'ok'.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads' and column_name = 'fub_link'
  ) then
    raise exception 'Cot leads.fub_link chua duoc tao';
  end if;
end $$;

select
  case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'leads'
           and column_name = 'fub_link' and data_type = 'text'
       ) then 'ok' else 'FAIL: thiếu cột fub_link' end                  as co_cot,
  case when (select count(*) from public.leads where fub_link is not null) = 0
       then 'ok' else 'chú ý: đã có lead mang fub_link (chạy lại lần hai?)' end as du_lieu_cu;

commit;

notify pgrst, 'reload schema';
