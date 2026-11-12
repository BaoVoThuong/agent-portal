-- ACA Consent: tick box -> dropdown (Yes / Not Yet). Data is untouched:
-- consent_id already stores an option id; empty records stay empty.
update public.table_column
set type = 'dropdown', updated_at = now()
where scope = 'aca' and key = 'consent' and type = 'checkbox';
