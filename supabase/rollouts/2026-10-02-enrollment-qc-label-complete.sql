-- Enrollment: cột "QC" của ACA và Medicare đổi tên thành "Complete" (2026-10-02),
-- cùng tên với Medicaid đang dùng. Chỉ đổi tên hiển thị; khoá cột `qc`, dữ liệu
-- qc_checked_at và luật QC theo stage giữ nguyên.
--
-- Chỉ đổi dòng còn mang tên mặc định "QC" — admin đã tự đặt tên khác thì giữ.
-- Chạy lại nhiều lần vô hại.

update table_column
set label = 'Complete',
    updated_at = now()
where scope in ('aca', 'medicare')
  and key = 'qc'
  and label = 'QC';

select scope, key, label
from table_column
where scope in ('aca', 'medicare', 'medicaid')
  and key = 'qc'
order by scope;
