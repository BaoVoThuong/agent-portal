-- Sample data for Lead Management. Safe to re-run: it removes its own event and
-- everything hanging off it first.
--
-- Interactions go through log_lead_interaction_atomic rather than straight
-- INSERTs. That RPC is the only writer of first_contacted_at,
-- last_contacted_at and contact_attempt_count, so inserting rows by hand would
-- leave a lead whose history says four calls and whose counter says zero — and
-- every alert reads the counter, not the history.
--
-- The ten leads are chosen to light up each alert exactly once, including the
-- case that must NOT light up: a promise kept.
--
-- Delete everything this created:
--   delete from lead_events where name = 'Sample Event — Aug 2026';
--   (leads cascade from the event? no — event_id is ON DELETE SET NULL, so:)
--   delete from leads where phone like '5550%';

do $$
declare
  event_value uuid;
  lead_value uuid;
  call_type uuid;
  text_type uuid;
  note_type uuid;
  bao   text := 'bao.vo@excelplannings.com';
  khang text := 'khang.nguyen@excelplannings.com';
  nam   text := 'nam.nguyen@excelplannings.com';

  function_status_new       uuid;
  function_status_working   uuid;
  function_status_noanswer  uuid;
  function_status_callback  uuid;
  function_status_won       uuid;
  function_status_lost      uuid;
begin
  -- Clean out any previous run.
  delete from leads where phone like '5550%';
  delete from lead_events where name = 'Sample Event — Aug 2026';

  insert into lead_events (name, event_date, location, created_by_email)
  values ('Sample Event — Aug 2026', current_date - 7, 'Community Center, Garden Grove', bao)
  returning id into event_value;

  select id into call_type from lead_interaction_types where label = 'Call' and archived_at is null;
  select id into text_type from lead_interaction_types where label = 'Text' and archived_at is null;
  select id into note_type from lead_interaction_types where label = 'Note' and archived_at is null;

  select id into function_status_new      from lead_statuses where product='health' and label='New';
  select id into function_status_working  from lead_statuses where product='health' and label='Working';
  select id into function_status_noanswer from lead_statuses where product='health' and label='No answer';
  select id into function_status_callback from lead_statuses where product='health' and kind='scheduled';
  select id into function_status_won      from lead_statuses where product='health' and kind='won';
  select id into function_status_lost     from lead_statuses where product='health' and label='Not interested';

  ---------------------------------------------------------------- 1. RED: nobody called
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,custom_values,created_by_email)
  values ('health',event_value,'Maria Gonzalez','5550101','maria.g@example.com',bao,now()-interval '3 day',bao,function_status_new,
          jsonb_build_object('secondary_phone','7145550101'),bao);

  ---------------------------------------------------------------- 2. quiet: still inside the window
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'David Tran','5550102','david.t@example.com',khang,now()-interval '2 hour',bao,function_status_new,bao);

  ---------------------------------------------------------------- 3. RED: called once, then dropped
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Linda Pham','5550103',nam,now()-interval '8 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_noanswer,
    'Rang twice, no answer. Will try again.', nam, null, null, now()-interval '6 day');

  ---------------------------------------------------------------- 4. RED: promise broken
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Robert Lee','5550104',bao,now()-interval '4 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_callback,
    'Busy at work. Asked me to call back Tuesday afternoon.', bao,
    now()-interval '1 day', null, now()-interval '2 day');

  ---------------------------------------------------------------- 5. quiet: promise KEPT (regression case)
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Anh Nguyen','5550105',khang,now()-interval '5 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_callback,
    'Asked for a call back on Thursday morning.', khang,
    now()-interval '2 day', null, now()-interval '4 day');
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_noanswer,
    'Called back exactly when promised. No answer this time.', khang, null, null, now()-interval '1 hour');

  ---------------------------------------------------------------- 6. AMBER: tried hard, cannot reach
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Hoa Dang','5550106',nam,now()-interval '6 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_noanswer, 'No answer.', nam, null, null, now()-interval '5 day');
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_noanswer, 'No answer, left voicemail.', nam, null, null, now()-interval '4 day');
  perform log_lead_interaction_atomic(lead_value, text_type, function_status_noanswer, 'Sent a text introducing myself.', nam, null, null, now()-interval '2 day');
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_noanswer, 'Still nothing. Someone else may have better luck.', nam, null, null, now()-interval '3 hour');

  ---------------------------------------------------------------- 7. closed won
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Kevin Ho','5550107','kevin.ho@example.com',bao,now()-interval '7 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_working, 'Interested in a family plan. Sending a quote.', bao, null, null, now()-interval '6 day');
  perform log_lead_interaction_atomic(lead_value, note_type, null, 'Quote emailed. Waiting on the household income figure.', bao, null, null, now()-interval '5 day');
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_won, 'Signed up for the silver plan.', bao, null, null, now()-interval '2 day');

  ---------------------------------------------------------------- 8. closed lost
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Sara Vu','5550108',khang,now()-interval '6 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_lost, 'Already covered through her employer.', khang, null, null, now()-interval '4 day');

  ---------------------------------------------------------------- 9. still in the pool, nobody at fault
  insert into leads (product,event_id,full_name,phone,status_id,custom_values,created_by_email)
  values ('health',event_value,'Minh Le','5550109',function_status_new,
          jsonb_build_object('secondary_phone','7145550109'),bao);

  ---------------------------------------------------------------- 10. healthy, in progress
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Trang Bui','5550110','trang.b@example.com',nam,now()-interval '1 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_working, 'Good conversation. Comparing two plans, calling back Friday.', nam, null, null, now()-interval '3 hour');
end $$;

-- What you should see.
select
  l.full_name,
  coalesce(s.label, '—')                        as status,
  coalesce(l.assigned_to_email, 'unassigned')   as owner,
  l.contact_attempt_count                       as attempts,
  (select count(*) from lead_interactions i where i.lead_id = l.id) as logged
from leads l
left join lead_statuses s on s.id = l.status_id
where l.phone like '5550%'
order by l.phone;
