-- Enrollment go-live: expose the derived Time Progress column on all programs.
-- Apply once with the normal rollout process. This only changes table config;
-- enrollment_records remains read-only for this rollout.
insert into table_column
  (scope, key, label, type, is_system, position, pinned, hidden_default, required)
values
  ('aca', 'timeProgress', 'Time Progress', 'text', true, 35, false, false, false),
  ('medicare', 'timeProgress', 'Time Progress', 'text', true, 35, false, false, false),
  ('medicaid', 'timeProgress', 'Time Progress', 'text', true, 65, false, false, false)
on conflict (scope, key) do nothing;

-- Rollback:
-- delete from table_column
-- where key = 'timeProgress' and scope in ('aca', 'medicare', 'medicaid');
