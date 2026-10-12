-- Drop three unused indexes on health_raw_data. All three are leftovers from
-- when the table was health_statement_summary; none is defined in
-- datasync/schema.sql or supabase/schema.sql.
--
-- health_raw_data is deleted and rewritten in full by every daily sheet sync
-- (finalize_sheet_sync), so each extra index is rewritten 17k times a day.
--
-- Checked on 2026-10-10 (index stats cover 2026-04-30 onwards):
-- - health_statement_summary_month_report_idx: identical to
--   health_raw_data_report_month_idx (btree on month_report), which stays and
--   is the one the schema files define. 1 scan in 5 months.
-- - health_statement_summary_source_hash_idx (4 MB): 0 scans. No code or SQL
--   function filters on source_row_hash; datasync only writes the column.
-- - health_statement_summary_agent_idx: 0 scans. refresh_health_mart() reads
--   the whole table; no app code queries health_raw_data directly.
-- None backs a constraint.
--
-- Avoid running during the 02:00 UTC sync. To roll back:
--   create index health_statement_summary_source_hash_idx on public.health_raw_data (source_row_hash);
--   create index health_statement_summary_agent_idx on public.health_raw_data (agent);

drop index if exists public.health_statement_summary_month_report_idx;
drop index if exists public.health_statement_summary_source_hash_idx;
drop index if exists public.health_statement_summary_agent_idx;
