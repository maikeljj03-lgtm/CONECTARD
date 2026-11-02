create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  province text,
  municipality text,
  sector text,
  bio text,
  role text not null default 'citizen'
    check (role in ('citizen', 'volunteer', 'organization', 'institution', 'administrator')),
  requested_role text not null default 'citizen'
    check (requested_role in ('citizen', 'volunteer', 'organization', 'institution')),
  verification_status text not null default 'not_required'
    check (verification_status in ('not_required', 'pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, province, municipality, sector, bio)
  on public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile fields" on public.profiles;
create policy "Users can update their own profile fields"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested text;
  assigned text;
  verification text;
begin
  requested := coalesce(new.raw_user_meta_data ->> 'requested_role', 'citizen');
  if requested not in ('citizen', 'volunteer', 'organization', 'institution') then
    requested := 'citizen';
  end if;

  -- Metadata is user-controlled; requested roles never grant application roles.
  assigned := 'citizen';
  verification := case when requested in ('volunteer', 'organization', 'institution') then 'pending' else 'not_required' end;

  insert into public.profiles (id, full_name, role, requested_role, verification_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    assigned,
    requested,
    verification
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, full_name, role, requested_role, verification_status)
select
  users.id,
  coalesce(users.raw_user_meta_data ->> 'full_name', ''),
  'citizen',
  case
    when users.raw_user_meta_data ->> 'requested_role' in ('citizen', 'volunteer', 'organization', 'institution')
      then users.raw_user_meta_data ->> 'requested_role'
    else 'citizen'
  end,
  case
    when users.raw_user_meta_data ->> 'requested_role' in ('volunteer', 'organization', 'institution') then 'pending'
    else 'not_required'
  end
from auth.users as users
on conflict (id) do nothing;
