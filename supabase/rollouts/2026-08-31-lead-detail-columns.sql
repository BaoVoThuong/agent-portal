-- Lead Management: mark the lead columns that belong in the detail view, and
-- seed Secondary Phone.
--
-- ensureTableColumns() only INSERTS default columns that are missing; it never
-- rewrites the flags of a row that already exists. The eleven lead columns were
-- created before show_in_detail was set on any of them, so changing the code
-- defaults alone leaves every existing row at false.
--
-- Forward-only and idempotent.

update table_column
set show_in_detail = true,
    updated_at = now()
where scope in ('lead_pc', 'lead_health')
  and key in ('name', 'phone', 'email', 'assignee', 'status', 'followUp', 'event')
  and show_in_detail is distinct from true;

-- Secondary Phone is seeded as a NON-system column on purpose: its value lives
-- in leads.custom_values like any column an admin adds, an admin may rename or
-- archive it, and the lead create dialog only offers non-system columns. The key
-- must stay `secondary_phone` — that is slugifyColumnKey('Secondary Phone'),
-- which is the key the spreadsheet importer writes and every screen reads back.
insert into table_column
  (scope, key, label, type, is_system, position, pinned, hidden_default, show_in_detail, required)
values
  ('lead_pc',     'secondary_phone', 'Secondary Phone', 'text', false, 35, false, false, true, false),
  ('lead_health', 'secondary_phone', 'Secondary Phone', 'text', false, 35, false, false, true, false)
on conflict (scope, key) do nothing;

-- Verification. Expect 16 rows: 8 per lead scope, every one show_in_detail = t.
select scope, key, label, is_system, show_in_detail
from table_column
where scope in ('lead_pc', 'lead_health')
  and show_in_detail
order by scope, position;
