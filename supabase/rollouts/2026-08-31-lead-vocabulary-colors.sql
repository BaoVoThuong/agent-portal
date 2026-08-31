-- Lead Management: give the interaction types and statuses deliberate colours.
--
-- Both tables have a `color` column but were seeded with NULL, which sends the
-- badge palette down its fallback: a hash of the row's uuid. That is stable but
-- arbitrary, so two types can land on the same colour and "Note" can end up
-- looking more urgent than "Call".
--
-- Colours come from TASK_CATEGORY_COLORS (src/lib/tasks/category-colors.ts), the
-- same set the task board uses, so the two boards read as one product. Note is
-- grey on purpose: it is the one interaction type that does not count as
-- contact, and it should not look like work that moved a lead forward.
--
-- Only fills colours that are still NULL, so an admin's own choice is never
-- overwritten. Forward-only and idempotent.

update lead_interaction_types set color = '#4c9aff' where label = 'Call'  and color is null;
update lead_interaction_types set color = '#36b37e' where label = 'Text'  and color is null;
update lead_interaction_types set color = '#6554c0' where label = 'Email' and color is null;
update lead_interaction_types set color = '#5e6c84' where label = 'Note'  and color is null;

update lead_statuses set color = '#4c9aff' where label = 'New'            and color is null;
update lead_statuses set color = '#00b8d9' where label = 'Working'        and color is null;
update lead_statuses set color = '#5e6c84' where label = 'No answer'      and color is null;
update lead_statuses set color = '#ffab00' where label = 'Call back'      and color is null;
update lead_statuses set color = '#36b37e' where label = 'Won'            and color is null;
update lead_statuses set color = '#ff7452' where label = 'Not interested' and color is null;
update lead_statuses set color = '#ff7452' where label = 'Wrong number'   and color is null;

-- Verification. Expect no NULL colours left on either vocabulary.
select 'interaction_type' as vocabulary, label, color
from lead_interaction_types where archived_at is null
union all
select 'status', label || ' (' || product || ')', color
from lead_statuses where archived_at is null
order by vocabulary, label;
