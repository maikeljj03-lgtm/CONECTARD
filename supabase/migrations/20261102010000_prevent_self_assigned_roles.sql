-- A signup's raw_user_meta_data is controlled by the user. Preserve the request
-- for review, but do not turn it into an application role automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested text;
  verification text;
begin
  requested := coalesce(new.raw_user_meta_data ->> 'requested_role', 'citizen');
  if requested not in ('citizen', 'volunteer', 'organization', 'institution') then
    requested := 'citizen';
  end if;

  verification := case when requested in ('volunteer', 'organization', 'institution') then 'pending' else 'not_required' end;

  insert into public.profiles (id, full_name, role, requested_role, verification_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'citizen',
    requested,
    verification
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

-- Remove unapproved volunteer assignments created by the previous trigger.
-- Previously approved assignments are retained.
update public.profiles
set role = 'citizen',
    verification_status = case
      when requested_role = 'volunteer' then 'pending'
      else verification_status
    end
where role = 'volunteer'
  and verification_status <> 'approved';
