-- Remove everything lead-sample-data.sql created.
-- Every sample lead has a phone starting 5550, and its interactions cascade.
delete from leads where phone like '5550%';
delete from lead_events where name = 'Sample Event — Aug 2026';

select
  (select count(*) from leads where phone like '5550%')                        as leads_left,
  (select count(*) from lead_events where name = 'Sample Event — Aug 2026')    as events_left;
