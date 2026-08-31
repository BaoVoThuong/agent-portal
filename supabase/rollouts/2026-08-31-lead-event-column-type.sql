-- Lead Management: the Event column is a reference, not free text.
--
-- leads.event_id is a foreign key to lead_events, so the create dialog offers a
-- list of existing events — you cannot type a new one into it. The column was
-- nevertheless declared 'text', which told anyone reading Config Table that the
-- field is typed by hand.
--
-- 'dropdown' is what the Enrollment scopes already use for the same shape:
-- stage, carrier and platform are all declared dropdown while their choices come
-- from enrollment_options rather than table_column_option. Event follows that
-- precedent, drawing its choices from lead_events.
--
-- ensureTableColumns() never rewrites an existing row, so the code default alone
-- would leave the live column at 'text'.
--
-- Forward-only and idempotent.

update table_column
set type = 'dropdown',
    updated_at = now()
where scope in ('lead_pc', 'lead_health')
  and key = 'event'
  and type is distinct from 'dropdown';

-- Verification. Expect two rows, both type = dropdown.
select scope, key, label, type
from table_column
where scope in ('lead_pc', 'lead_health') and key = 'event'
order by scope;
