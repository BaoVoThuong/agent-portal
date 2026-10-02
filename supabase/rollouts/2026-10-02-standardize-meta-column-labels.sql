-- Chuẩn hoá tên các cột siêu dữ liệu theo bảng Task CS (2026-10-02).
--
-- Trước đây mỗi màn một tên cho cùng một khái niệm:
--   Task CS     : Created date / Last activity / Opened by
--   Enrollment  : Created time / Last edited time / Created by / Last edited by
--   Leads       : Imported Date
--   Provider    : Added on / Last updated / Added by / Updated by
-- Sau rollout này mọi bảng dùng: Created date / Last Updated / Opened by /
-- Last Updated by.
--
-- Chỉ đổi những dòng CÒN mang tên mặc định cũ: admin đã tự đặt tên khác trong
-- /config thì giữ nguyên tên của admin. Khoá cột (key) không đổi, nên layout đã
-- lưu của từng người, bộ lọc và Import theo khoá vẫn chạy.
--
-- Chạy lại nhiều lần vô hại: lần sau không còn dòng nào khớp tên cũ.

update table_column as column_row
set label = rename.new_label,
    updated_at = now()
from (
  values
    ('cs',       'activity',         'Last activity',    'Last Updated'),
    ('aca',      'createdAt',        'Created time',     'Created date'),
    ('aca',      'updated',          'Last edited time', 'Last Updated'),
    ('aca',      'createdBy',        'Created by',       'Opened by'),
    ('aca',      'updatedBy',        'Last edited by',   'Last Updated by'),
    ('medicare', 'createdAt',        'Created time',     'Created date'),
    ('medicare', 'updated',          'Last edited time', 'Last Updated'),
    ('medicare', 'createdBy',        'Created by',       'Opened by'),
    ('medicare', 'updatedBy',        'Last edited by',   'Last Updated by'),
    ('medicaid', 'createdAt',        'Created time',     'Created date'),
    ('medicaid', 'updated',          'Last edited time', 'Last Updated'),
    ('medicaid', 'createdBy',        'Created by',       'Opened by'),
    ('medicaid', 'updatedBy',        'Last edited by',   'Last Updated by'),
    ('lead',     'createdAt',        'Imported',         'Created date'),
    ('lead',     'createdAt',        'Imported Date',    'Created date'),
    ('provider', 'created_at',       'Added on',         'Created date'),
    ('provider', 'updated_at',       'Last updated',     'Last Updated'),
    ('provider', 'created_by_email', 'Added by',         'Opened by'),
    ('provider', 'updated_by_email', 'Updated by',       'Last Updated by')
) as rename(scope, key, old_label, new_label)
where column_row.scope = rename.scope
  and column_row.key = rename.key
  and column_row.label = rename.old_label;

-- Kiểm tra: mọi dòng dưới đây phải mang tên mới (trừ cột admin đã tự đặt tên).
select scope, key, label
from table_column
where (scope, key) in (
  ('cs', 'created'), ('cs', 'activity'), ('cs', 'reporter'),
  ('aca', 'createdAt'), ('aca', 'updated'), ('aca', 'createdBy'), ('aca', 'updatedBy'),
  ('medicare', 'createdAt'), ('medicare', 'updated'), ('medicare', 'createdBy'), ('medicare', 'updatedBy'),
  ('medicaid', 'createdAt'), ('medicaid', 'updated'), ('medicaid', 'createdBy'), ('medicaid', 'updatedBy'),
  ('lead', 'createdAt'),
  ('provider', 'created_at'), ('provider', 'updated_at'),
  ('provider', 'created_by_email'), ('provider', 'updated_by_email')
)
order by scope, key;
