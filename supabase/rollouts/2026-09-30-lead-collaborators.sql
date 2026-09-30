-- Store collaborators independently from leads.assigned_to_email. Collaborators
-- may view and edit the lead, while assignment history remains tied to the Agent.
alter table leads
  add column if not exists collaborator_emails text[] not null default '{}'::text[];

create index if not exists leads_collaborator_emails_gin_idx
  on leads using gin (collaborator_emails);
