-- Clean up staging left behind by failed Health sheet syncs.
--
-- sheet_sync_staging held 366 MB / 163,878 rows (76% of the database), all from
-- 10 health_raw_data runs still marked 'running': six 02:00 UTC cron runs in
-- September and four manual runs on 2026-10-03 that hit the statement timeout.
-- Staged rows are kept on a failed promotion on purpose so the run can be
-- resumed, but nothing ever expires them.
--
-- Every run removed here has a newer finalized run for the same sheet tab, so
-- resuming it would overwrite live data with an older copy. Deleting the run
-- row cascades to its staged rows (sheet_sync_staging_run_id_fkey).
--
-- Run once. Safe to re-run: it only matches runs superseded by a finalized one.

delete from public.sheet_sync_runs stale
where stale.status = 'running'
  and exists (
    select 1
    from public.sheet_sync_runs newer
    where newer.target_table = stale.target_table
      and newer.source_sheet_id = stale.source_sheet_id
      and newer.source_gid = stale.source_gid
      and newer.status = 'finalized'
      and newer.created_at > stale.created_at
  );
