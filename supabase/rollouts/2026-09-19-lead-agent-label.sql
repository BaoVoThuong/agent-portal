-- Lead list label cleanup: expose the assignee column as "Agent".
-- Forward-only rollout; do not edit or replay an older rollout file.

update public.table_column
set label = 'Agent',
    updated_at = now()
where scope = 'lead'
  and key = 'assignee'
  and is_system = true
  and archived_at is null;

-- Verification
select scope, key, label, type, position, archived_at
from public.table_column
where scope = 'lead'
  and key = 'assignee';
