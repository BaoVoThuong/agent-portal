-- Run the preflight query from the remediation plan first. This file is
-- intentionally a CONCURRENTLY statement so production option reads stay
-- available while the index is built. CREATE INDEX CONCURRENTLY must run
-- outside an explicit transaction.
create unique index concurrently if not exists table_column_option_active_label_uniq
  on public.table_column_option (column_id, lower(btrim(label)))
  where archived_at is null;
