-- =====================================================================
-- BÁO CÁO comment rỗng mồ côi. KHÔNG xoá gì cả.
--
-- "Mồ côi" = không có chữ nào VÀ không còn đính kèm nào đang hoạt động.
-- Comment chỉ-đính-kèm là hợp lệ và KHÔNG nằm trong danh sách này.
--
-- Nguyên nhân: luồng gửi tạo comment trước rồi mới upload từng tệp; khi mọi
-- tệp đều hỏng, dòng rỗng ở lại. Đã chặn ở phía client (shouldDiscardEmptyComment),
-- nhưng các dòng tạo ra TRƯỚC bản vá vẫn còn.
--
-- Chạy file này để có danh sách. Chỉ xoá sau khi chủ sản phẩm xác nhận, và xoá
-- bằng soft-delete có sẵn (delete_task_comment_atomic) để giữ audit trail.
-- =====================================================================

select
  t.code                                as task_code,
  c.id                                  as comment_id,
  c.author_email,
  c.created_at,
  c.parent_id is not null               as is_reply,
  -- Đếm cả đính kèm đã xoá: nếu từng có tệp rồi bị xoá tay thì dòng rỗng này
  -- là hệ quả của một thao tác có chủ ý, không phải upload hỏng.
  (select count(*) from task_attachments a where a.comment_id = c.id) as attachments_ever
from task_comments c
join tasks t on t.id = c.task_id
where c.deleted_at is null
  and btrim(c.body) = ''
  and not exists (
    select 1
    from task_attachments a
    where a.comment_id = c.id
      and a.deleted_at is null
  )
order by c.created_at desc;
