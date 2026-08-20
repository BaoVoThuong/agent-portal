-- 2026-08-20 — Behaviour test for comment reactions.
--
-- Run AFTER 2026-08-20-comment-reactions.sql. This creates only scratch rows
-- plus a session-local TEMP result table; it leaves no permanent test object.
-- Expected output: 8 rows, ok = true.

drop table if exists pg_temp.reaction_selftest_result;
create temporary table reaction_selftest_result (
  object text,
  ok boolean
) on commit preserve rows;

do $$
declare
  v_task_id uuid;
  v_comment_id uuid;
  v_identity_canonical boolean;
  v_idempotent_count integer;
  v_task_read_count integer;
  v_after_remove integer;
  v_after_soft_delete integer;
  v_deleted_comment_rejected boolean;
begin
  insert into public.tasks (title, reporter_email)
  values ('reaction selftest', 'reaction-selftest@local')
  returning id into v_task_id;

  insert into public.task_comments (task_id, author_email, body)
  values (v_task_id, 'reaction-selftest@local', 'selftest')
  returning id into v_comment_id;

  perform public.set_task_comment_reaction_atomic(
    v_comment_id,
    v_task_id,
    '  REACTION-SELFTEST@LOCAL ',
    '👍',
    true
  );

  select exists (
    select 1
    from public.task_comment_reactions
    where comment_id = v_comment_id
      and reactor_email = 'reaction-selftest@local'
      and emoji = '👍'
  ) into v_identity_canonical;

  -- A lost PUT response may be retried. Re-adding must stay a one-row no-op.
  perform public.set_task_comment_reaction_atomic(
    v_comment_id,
    v_task_id,
    'reaction-selftest@local',
    '👍',
    true
  );
  select count(*) into v_idempotent_count
  from public.task_comment_reactions
  where comment_id = v_comment_id
    and reactor_email = 'reaction-selftest@local'
    and emoji = '👍';

  select count(*) into v_task_read_count
  from public.task_comment_reactions_for_task(v_task_id)
  where comment_id = v_comment_id;

  perform public.set_task_comment_reaction_atomic(
    v_comment_id,
    v_task_id,
    'REACTION-SELFTEST@LOCAL',
    '👍',
    false
  );
  select count(*) into v_after_remove
  from public.task_comment_reactions
  where comment_id = v_comment_id;

  perform public.set_task_comment_reaction_atomic(
    v_comment_id,
    v_task_id,
    'reaction-selftest@local',
    '🎉',
    true
  );
  perform public.delete_task_comment_atomic(
    v_comment_id,
    v_task_id,
    'reaction-selftest@local'
  );
  select count(*) into v_after_soft_delete
  from public.task_comment_reactions
  where comment_id = v_comment_id;

  begin
    perform public.set_task_comment_reaction_atomic(
      v_comment_id,
      v_task_id,
      'reaction-selftest@local',
      '👍',
      true
    );
    v_deleted_comment_rejected := false;
  exception when others then
    v_deleted_comment_rejected := position(
      'COMMENT_NOT_FOUND' in sqlerrm
    ) > 0;
  end;

  insert into pg_temp.reaction_selftest_result values
    ('table task_comment_reactions exists',
     to_regclass('public.task_comment_reactions') is not null),
    ('RPC normalizes reactor email', v_identity_canonical),
    ('PUT retry remains idempotent', v_idempotent_count = 1),
    ('task-level canonical read returns reaction', v_task_read_count = 1),
    ('DELETE removes the viewer reaction', v_after_remove = 0),
    ('soft delete removes reactions', v_after_soft_delete = 0),
    ('soft-deleted comment rejects new reactions', v_deleted_comment_rejected),
    ('self-test leaves no public result table',
     to_regclass('public.reaction_selftest_result') is null);

  delete from public.tasks where id = v_task_id;
end $$;

select * from pg_temp.reaction_selftest_result;
