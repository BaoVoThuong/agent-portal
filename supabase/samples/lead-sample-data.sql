-- Sample data for Lead Management. Safe to re-run: it removes its own event and
-- everything hanging off it first.
--
-- Interactions go through log_lead_interaction_atomic rather than straight
-- INSERTs. That RPC is the only writer of first_contacted_at,
-- last_contacted_at and contact_attempt_count, so inserting rows by hand would
-- leave a lead whose history says four calls and whose counter says zero — and
-- every alert reads the counter, not the history.
--
-- The first ten leads are chosen to light up each alert exactly once, including
-- the case that must NOT light up: a promise kept. The next twenty provide a
-- realistic-length table with a mix of owners, contact histories and statuses.
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
  email_type uuid;
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
  select id into email_type from lead_interaction_types where label = 'Email' and archived_at is null;
  select id into note_type from lead_interaction_types where label = 'Note' and archived_at is null;

  select id into function_status_new      from lead_statuses where label='New';
  select id into function_status_working  from lead_statuses where label='Working';
  select id into function_status_noanswer from lead_statuses where label='No answer';
  select id into function_status_callback from lead_statuses where kind='scheduled';
  select id into function_status_won      from lead_statuses where kind='won';
  select id into function_status_lost     from lead_statuses where label='Not interested';

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

  ---------------------------------------------------------------- 11. unassigned, new
  insert into leads (product,event_id,full_name,phone,email,status_id,custom_values,created_by_email)
  values ('health',event_value,'Olivia Chen','5550111','olivia.c@example.com',function_status_new,
          jsonb_build_object('secondary_phone','7145550111'),bao);

  ---------------------------------------------------------------- 12. newly assigned
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Daniel Park','5550112',bao,now()-interval '4 hour',bao,function_status_new,bao);

  ---------------------------------------------------------------- 13. active conversation
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Grace Nguyen','5550113','grace.n@example.com',khang,now()-interval '2 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_working,
    'Interested in the coverage options. Preparing a side-by-side comparison.', khang, null, null, now()-interval '6 hour');
  perform log_lead_interaction_atomic(lead_value, email_type, function_status_working,
    'Emailed the side-by-side coverage comparison.', khang, null, null, now()-interval '4 hour');

  ---------------------------------------------------------------- 14. no answer after two attempts
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Ethan Williams','5550114',nam,now()-interval '3 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_noanswer,
    'No answer; left a short voicemail.', nam, null, null, now()-interval '2 day');
  perform log_lead_interaction_atomic(lead_value, text_type, function_status_noanswer,
    'Sent a text with my direct callback number.', nam, null, null, now()-interval '4 hour');

  ---------------------------------------------------------------- 15. scheduled follow-up, still in the future
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Sophia Tran','5550115','sophia.t@example.com',bao,now()-interval '2 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_callback,
    'Requested a call after reviewing the plan with her spouse.', bao,
    now()+interval '2 day', null, now()-interval '4 hour');

  ---------------------------------------------------------------- 16. working, seven entries to exercise the history rail
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Liam Pham','5550116',bao,now()-interval '4 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_working,
    'Needs help comparing deductible levels.', bao, null, null, now()-interval '1 day');
  perform log_lead_interaction_atomic(lead_value, email_type, function_status_working,
    'Emailed a deductible comparison for both plan options.', bao, null, null, now()-interval '20 hour');
  perform log_lead_interaction_atomic(lead_value, text_type, function_status_working,
    'Texted to confirm the comparison reached him.', bao, null, null, now()-interval '16 hour');
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_working,
    'Clarified the out-of-pocket maximum.', bao, null, null, now()-interval '12 hour');
  perform log_lead_interaction_atomic(lead_value, email_type, function_status_working,
    'Sent the provider-network summary.', bao, null, null, now()-interval '8 hour');
  perform log_lead_interaction_atomic(lead_value, text_type, function_status_working,
    'Texted a reminder about tomorrow’s decision call.', bao, null, null, now()-interval '4 hour');
  perform log_lead_interaction_atomic(lead_value, note_type, null,
    'Will send a bilingual summary before the next conversation.', bao, null, null, now()-interval '2 hour');

  ---------------------------------------------------------------- 17. closed won
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Ava Martinez','5550117','ava.m@example.com',khang,now()-interval '6 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_working,
    'Selected a plan and asked for enrollment support.', khang, null, null, now()-interval '3 day');
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_won,
    'Enrollment completed successfully.', khang, null, null, now()-interval '1 day');

  ---------------------------------------------------------------- 18. closed lost
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Noah Kim','5550118',nam,now()-interval '5 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_lost,
    'Decided to stay with the current insurer this year.', nam, null, null, now()-interval '2 day');

  ---------------------------------------------------------------- 19. unassigned, new
  insert into leads (product,event_id,full_name,phone,status_id,custom_values,created_by_email)
  values ('health',event_value,'Emma Brown','5550119',function_status_new,
          jsonb_build_object('secondary_phone','7145550119'),bao);

  ---------------------------------------------------------------- 20. healthy, in progress
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Mason Le','5550120','mason.l@example.com',bao,now()-interval '1 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_working,
    'Open to a quote; asked for plan details by email.', bao, null, null, now()-interval '1 hour');

  ---------------------------------------------------------------- 21. no answer
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Isabella Ho','5550121',khang,now()-interval '2 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_noanswer,
    'Reached voicemail; will retry tomorrow.', khang, null, null, now()-interval '5 hour');

  ---------------------------------------------------------------- 22. scheduled follow-up, still in the future
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Lucas Do','5550122','lucas.d@example.com',nam,now()-interval '2 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_callback,
    'Available after work on Thursday.', nam, now()+interval '1 day', null, now()-interval '7 hour');

  ---------------------------------------------------------------- 23. just assigned
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Mia Vo','5550123','mia.v@example.com',bao,now()-interval '30 minute',bao,function_status_new,bao);

  ---------------------------------------------------------------- 24. working across two conversations
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Henry Nguyen','5550124',khang,now()-interval '4 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_working,
    'Discussed provider network and prescription coverage.', khang, null, null, now()-interval '2 day');
  perform log_lead_interaction_atomic(lead_value, text_type, function_status_working,
    'Sent the requested provider-network link.', khang, null, null, now()-interval '3 hour');

  ---------------------------------------------------------------- 25. unassigned, new
  insert into leads (product,event_id,full_name,phone,status_id,custom_values,created_by_email)
  values ('health',event_value,'Chloe Dang','5550125',function_status_new,
          jsonb_build_object('secondary_phone','7145550125'),bao);

  ---------------------------------------------------------------- 26. multiple unsuccessful attempts
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Benjamin Truong','5550126','benjamin.t@example.com',nam,now()-interval '4 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_noanswer,
    'No answer on the primary number.', nam, null, null, now()-interval '3 day');
  perform log_lead_interaction_atomic(lead_value, text_type, function_status_noanswer,
    'Texted an introduction and availability.', nam, null, null, now()-interval '1 day');
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_noanswer,
    'Second call went to voicemail.', nam, null, null, now()-interval '2 hour');

  ---------------------------------------------------------------- 27. closed won
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Harper Phan','5550127',bao,now()-interval '7 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_working,
    'Reviewed benefits and confirmed eligibility.', bao, null, null, now()-interval '5 day');
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_won,
    'Chose a plan and completed the application.', bao, null, null, now()-interval '1 day');

  ---------------------------------------------------------------- 28. closed lost
  insert into leads (product,event_id,full_name,phone,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Jack Vu','5550128',khang,now()-interval '5 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_lost,
    'Not interested in changing plans at this time.', khang, null, null, now()-interval '1 day');

  ---------------------------------------------------------------- 29. scheduled follow-up, still in the future
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'Ella Bui','5550129','ella.b@example.com',nam,now()-interval '3 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_callback,
    'Requested a reminder after the upcoming family meeting.', nam,
    now()+interval '3 day', null, now()-interval '1 day');

  ---------------------------------------------------------------- 30. healthy, in progress
  insert into leads (product,event_id,full_name,phone,email,assigned_to_email,assigned_at,assigned_by_email,status_id,created_by_email)
  values ('health',event_value,'James Nguyen','5550130','james.n@example.com',bao,now()-interval '3 day',bao,function_status_new,bao)
  returning id into lead_value;
  perform log_lead_interaction_atomic(lead_value, call_type, function_status_working,
    'Requested a follow-up after reviewing the family budget.', bao, null, null, now()-interval '5 hour');
  perform log_lead_interaction_atomic(lead_value, email_type, function_status_working,
    'Sent the requested family-plan summary by email.', bao, null, null, now()-interval '2 hour');

  -- Extra interaction-log corpus for the list's horizontal history rail. Each
  -- lead's calls are chronological: the RPC derives last_contacted_at and the
  -- attempt counter from its invocation order, so do not add an older event
  -- after a newer one here.

  ---------------------------------------------------------------- Grace: 8 total history entries
  select l.id into lead_value from leads as l where l.event_id = event_value and l.phone = '5550113';
  perform log_lead_interaction_atomic(lead_value, note_type, null,
    'Reviewed the quote before the next conversation.', khang, null, null, now()-interval '3 hour 30 minute');
  perform log_lead_interaction_atomic(lead_value, call_type, null,
    'Confirmed her spouse wants a lower-deductible option.', khang, null, null, now()-interval '3 hour');
  perform log_lead_interaction_atomic(lead_value, email_type, null,
    'Emailed both plan summaries and premium estimates.', khang, null, null, now()-interval '2 hour 30 minute');
  perform log_lead_interaction_atomic(lead_value, text_type, null,
    'Texted to confirm the comparison link opened correctly.', khang, null, null, now()-interval '2 hour');
  perform log_lead_interaction_atomic(lead_value, call_type, null,
    'Answered a question about prescription coverage.', khang, null, null, now()-interval '1 hour 30 minute');
  perform log_lead_interaction_atomic(lead_value, note_type, null,
    'Waiting for the household to choose a deductible.', khang, null, null, now()-interval '45 minute');

  ---------------------------------------------------------------- Ethan: 8 total history entries
  select l.id into lead_value from leads as l where l.event_id = event_value and l.phone = '5550114';
  perform log_lead_interaction_atomic(lead_value, call_type, null,
    'Second call reached voicemail.', nam, null, null, now()-interval '3 hour 30 minute');
  perform log_lead_interaction_atomic(lead_value, email_type, null,
    'Sent a brief email with plan highlights.', nam, null, null, now()-interval '3 hour');
  perform log_lead_interaction_atomic(lead_value, text_type, null,
    'Texted the direct callback number.', nam, null, null, now()-interval '2 hour 30 minute');
  perform log_lead_interaction_atomic(lead_value, call_type, null,
    'Third call also went to voicemail.', nam, null, null, now()-interval '2 hour');
  perform log_lead_interaction_atomic(lead_value, note_type, null,
    'Try the secondary number during the evening.', nam, null, null, now()-interval '1 hour 30 minute');
  perform log_lead_interaction_atomic(lead_value, email_type, null,
    'Sent a final availability reminder by email.', nam, null, null, now()-interval '1 hour');

  ---------------------------------------------------------------- Lucas: 7 total history entries
  select l.id into lead_value from leads as l where l.event_id = event_value and l.phone = '5550122';
  perform log_lead_interaction_atomic(lead_value, email_type, null,
    'Sent the requested plan brochure.', nam, null, null, now()-interval '6 hour');
  perform log_lead_interaction_atomic(lead_value, text_type, null,
    'Texted the appointment reminder.', nam, null, null, now()-interval '5 hour');
  perform log_lead_interaction_atomic(lead_value, note_type, null,
    'Prefers a concise comparison before the callback.', nam, null, null, now()-interval '4 hour');
  perform log_lead_interaction_atomic(lead_value, call_type, null,
    'Confirmed the follow-up time still works.', nam, null, null, now()-interval '3 hour');
  perform log_lead_interaction_atomic(lead_value, email_type, null,
    'Emailed a list of required enrollment documents.', nam, null, null, now()-interval '2 hour');
  perform log_lead_interaction_atomic(lead_value, text_type, null,
    'Texted a reminder to keep the insurance card nearby.', nam, null, null, now()-interval '1 hour');

  ---------------------------------------------------------------- Henry: 8 total history entries
  select l.id into lead_value from leads as l where l.event_id = event_value and l.phone = '5550124';
  perform log_lead_interaction_atomic(lead_value, call_type, null,
    'Reviewed the preferred provider list.', khang, null, null, now()-interval '2 hour 30 minute');
  perform log_lead_interaction_atomic(lead_value, email_type, null,
    'Emailed the network lookup results.', khang, null, null, now()-interval '2 hour');
  perform log_lead_interaction_atomic(lead_value, note_type, null,
    'Prescription list needs a formulary check.', khang, null, null, now()-interval '1 hour 30 minute');
  perform log_lead_interaction_atomic(lead_value, text_type, null,
    'Texted the formulary-check link.', khang, null, null, now()-interval '1 hour');
  perform log_lead_interaction_atomic(lead_value, call_type, null,
    'Confirmed the primary doctor is in-network.', khang, null, null, now()-interval '30 minute');
  perform log_lead_interaction_atomic(lead_value, email_type, null,
    'Sent the final network confirmation.', khang, null, null, now()-interval '15 minute');

  ---------------------------------------------------------------- Benjamin: 9 total history entries
  select l.id into lead_value from leads as l where l.event_id = event_value and l.phone = '5550126';
  perform log_lead_interaction_atomic(lead_value, note_type, null,
    'Primary phone consistently goes to voicemail.', nam, null, null, now()-interval '1 hour 45 minute');
  perform log_lead_interaction_atomic(lead_value, text_type, null,
    'Sent a short introduction by text.', nam, null, null, now()-interval '1 hour 30 minute');
  perform log_lead_interaction_atomic(lead_value, email_type, null,
    'Emailed the available appointment windows.', nam, null, null, now()-interval '1 hour 15 minute');
  perform log_lead_interaction_atomic(lead_value, call_type, null,
    'Call reached voicemail again.', nam, null, null, now()-interval '1 hour');
  perform log_lead_interaction_atomic(lead_value, text_type, null,
    'Texted an option to reply after work.', nam, null, null, now()-interval '45 minute');
  perform log_lead_interaction_atomic(lead_value, note_type, null,
    'Queue for a final retry tomorrow morning.', nam, null, null, now()-interval '30 minute');

  ---------------------------------------------------------------- James: 8 total history entries
  select l.id into lead_value from leads as l where l.event_id = event_value and l.phone = '5550130';
  perform log_lead_interaction_atomic(lead_value, text_type, null,
    'Texted the premium range for the family plan.', bao, null, null, now()-interval '1 hour 45 minute');
  perform log_lead_interaction_atomic(lead_value, call_type, null,
    'Discussed the household budget and effective date.', bao, null, null, now()-interval '1 hour 30 minute');
  perform log_lead_interaction_atomic(lead_value, note_type, null,
    'Wants to compare bronze and silver before deciding.', bao, null, null, now()-interval '1 hour 15 minute');
  perform log_lead_interaction_atomic(lead_value, email_type, null,
    'Emailed the bronze versus silver comparison.', bao, null, null, now()-interval '1 hour');
  perform log_lead_interaction_atomic(lead_value, text_type, null,
    'Texted a reminder about the comparison email.', bao, null, null, now()-interval '45 minute');
  perform log_lead_interaction_atomic(lead_value, call_type, null,
    'Confirmed he received the estimate.', bao, null, null, now()-interval '30 minute');
end $$;

-- What you should see: 30 leads and 78 interaction-log rows.
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
