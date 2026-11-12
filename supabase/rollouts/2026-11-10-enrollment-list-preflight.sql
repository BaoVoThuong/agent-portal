explain (analyze, buffers)
with ids as (
  select array_agg(id) as a from enrollment_records
  where program = 'aca' and archived_at is null
),
comment_stats as (
  select record_id, count(*)::int as comment_count,
         string_agg(nullif(body, ''), ' ') as comment_search_text
  from enrollment_comments cross join ids
  where record_id = any(ids.a) and deleted_at is null
  group by record_id
),
attachment_stats as (
  select record_id, count(*)::int as attachment_count
  from enrollment_attachments cross join ids
  where record_id = any(ids.a)
  group by record_id
)
select coalesce(jsonb_object_agg(
  coalesce(c.record_id, a.record_id),
  jsonb_build_object(
    'comment_count', coalesce(c.comment_count, 0),
    'attachment_count', coalesce(a.attachment_count, 0),
    'comment_search_text', coalesce(c.comment_search_text, '')
  )
), '{}'::jsonb)
from comment_stats c
full join attachment_stats a on a.record_id = c.record_id;
