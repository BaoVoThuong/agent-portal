-- Provider Backlog: atomic Update existing. Apply after 2026-10-26-provider-backlog.sql.
-- New rollout because APPLIED.md records the original Backlog SQL as already run.

begin;

-- Update existing phải là một transaction: không được đóng dòng Backlog rồi
-- mới thử sửa dòng cũ bằng một HTTP request khác. Phiên bản của cả hai dòng
-- được kiểm dưới row lock để không ghi đè một lượt sửa/duyệt vừa xảy ra.
create or replace function public.merge_provider_backlog_atomic(
  p_submission_id uuid,
  p_target_id uuid,
  p_submission_updated_at timestamptz,
  p_target_updated_at timestamptz,
  p_patch jsonb,
  p_actor_email text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_submission public.provider_directory%rowtype;
  v_target public.provider_directory%rowtype;
  v_next public.provider_directory%rowtype;
  v_updated public.provider_directory%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_patch) as key
       where key not in (
         'doctors', 'facility', 'npi', 'practices_as', 'phone', 'street',
         'city', 'state', 'zip_code', 'accepting_new_patients',
         'business_hours', 'obamacare', 'medicare', 'other_plans',
         'verified_by', 'date', 'needs_review', 'custom_values',
         'latitude', 'longitude', 'geocode_source', 'geocoded_at', 'geocode_key'
       )
     ) then
    raise exception 'INVALID_PROVIDER_MERGE_PATCH';
  end if;

  select * into v_submission from public.provider_directory
  where id = p_submission_id for update;
  if not found or not v_submission.pending
     or v_submission.archived_at is not null
     or v_submission.duplicate_of is distinct from p_target_id
     or v_submission.updated_at is distinct from p_submission_updated_at then
    raise exception 'BACKLOG_CONFLICT';
  end if;

  select * into v_target from public.provider_directory
  where id = p_target_id for update;
  if not found or v_target.pending or v_target.archived_at is not null
     or v_target.updated_at is distinct from p_target_updated_at then
    raise exception 'BACKLOG_CONFLICT';
  end if;

  select * into v_next from jsonb_populate_record(v_target, p_patch);
  update public.provider_directory set
    doctors = v_next.doctors,
    facility = v_next.facility,
    npi = v_next.npi,
    practices_as = v_next.practices_as,
    phone = v_next.phone,
    street = v_next.street,
    city = v_next.city,
    state = v_next.state,
    zip_code = v_next.zip_code,
    accepting_new_patients = v_next.accepting_new_patients,
    business_hours = v_next.business_hours,
    obamacare = v_next.obamacare,
    medicare = v_next.medicare,
    other_plans = v_next.other_plans,
    verified_by = v_next.verified_by,
    date = v_next.date,
    needs_review = v_next.needs_review,
    custom_values = v_next.custom_values,
    latitude = v_next.latitude,
    longitude = v_next.longitude,
    geocode_source = v_next.geocode_source,
    geocoded_at = v_next.geocoded_at,
    geocode_key = v_next.geocode_key,
    updated_at = v_now,
    updated_by_email = p_actor_email
  where id = p_target_id
  returning * into v_updated;

  update public.provider_directory set
    archived_at = v_now,
    updated_at = v_now,
    updated_by_email = p_actor_email
  where id = p_submission_id;

  return to_jsonb(v_updated);
end;
$$;

revoke all on function public.merge_provider_backlog_atomic(
  uuid, uuid, timestamptz, timestamptz, jsonb, text
) from public, anon, authenticated;
grant execute on function public.merge_provider_backlog_atomic(
  uuid, uuid, timestamptz, timestamptz, jsonb, text
) to service_role;

commit;

notify pgrst, 'reload schema';
