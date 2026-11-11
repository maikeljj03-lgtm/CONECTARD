-- ============================================================================
-- ConectaRD · Configuración completa de la base de datos (Supabase)
-- Pega TODO este archivo en Supabase → SQL Editor → New query → Run.
-- Es seguro ejecutarlo varias veces: cada parte usa IF NOT EXISTS / DROP IF EXISTS.
-- ARCHIVO GENERADO por scripts/build-supabase-setup.mjs a partir de supabase/migrations.
-- No lo edites a mano: cambia la migración y ejecuta "npm.cmd run supabase:setup".
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 20261102000000_create_profiles.sql
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 20261102010000_prevent_self_assigned_roles.sql
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 20261111000000_profile_editing.sql
-- ----------------------------------------------------------------------------
-- RF-05: edición de perfil (nombre, foto, provincia, municipio, sector y biografía).
-- Ejecutar después de 20261102000000_create_profiles.sql.

-- 1. Límites de los campos editables por el usuario.
alter table public.profiles drop constraint if exists profiles_full_name_length;
alter table public.profiles add constraint profiles_full_name_length
  check (char_length(full_name) <= 80);

alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles add constraint profiles_bio_length
  check (bio is null or char_length(bio) <= 280);

alter table public.profiles drop constraint if exists profiles_location_length;
alter table public.profiles add constraint profiles_location_length
  check (
    (province is null or char_length(province) <= 60)
    and (municipality is null or char_length(municipality) <= 80)
    and (sector is null or char_length(sector) <= 80)
  );

-- La foto solo puede apuntar a una URL https (la del bucket de avatares).
alter table public.profiles drop constraint if exists profiles_avatar_url_https;
alter table public.profiles add constraint profiles_avatar_url_https
  check (avatar_url is null or avatar_url ~ '^https://');

-- 2. updated_at se mantiene solo.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 3. Bucket público para fotos de perfil. Cada usuario escribe solo en su carpeta: <uid>/archivo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatars are publicly readable" on storage.objects;
create policy "Avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Users upload their own avatar" on storage.objects;
create policy "Users upload their own avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users update their own avatar" on storage.objects;
create policy "Users update their own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users delete their own avatar" on storage.objects;
create policy "Users delete their own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);


-- ----------------------------------------------------------------------------
-- 20261111010000_organization_verification.sql
-- ----------------------------------------------------------------------------
-- RF-06: verificación de organizaciones e instituciones con documentación oficial.
-- Las cuentas no obtienen permisos especiales hasta que un administrador aprueba la solicitud.
-- Ejecutar después de 20261111000000_profile_editing.sql.

-- 1. ¿El usuario actual es administrador? (security definer para no depender de las políticas de profiles)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'administrator'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Los administradores pueden leer todos los perfiles (para revisar solicitudes).
drop policy if exists "Administrators can read all profiles" on public.profiles;
create policy "Administrators can read all profiles"
  on public.profiles for select to authenticated
  using ((select public.is_admin()));

-- 2. Solicitudes de verificación.
create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  requested_role text not null check (requested_role in ('organization', 'institution')),
  organization_name text not null check (char_length(organization_name) between 2 and 120),
  organization_type text not null check (organization_type in (
    'ong', 'fundacion', 'asociacion_comunitaria', 'junta_de_vecinos', 'centro_educativo',
    'ayuntamiento', 'junta_distrital', 'ministerio_o_direccion', 'otra'
  )),
  rnc text check (rnc is null or rnc ~ '^[0-9]{9}$' or rnc ~ '^[0-9]{11}$'),
  contact_name text not null check (char_length(contact_name) between 2 and 80),
  contact_phone text not null check (contact_phone ~ '^[0-9+() -]{7,20}$'),
  coverage_area text not null check (char_length(coverage_area) between 2 and 160),
  document_paths text[] not null check (cardinality(document_paths) between 1 and 5),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_notes text check (review_notes is null or char_length(review_notes) <= 500),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Solo una solicitud pendiente por usuario.
create unique index if not exists verification_requests_one_pending
  on public.verification_requests (user_id) where status = 'pending';

alter table public.verification_requests enable row level security;
revoke all on public.verification_requests from anon, authenticated;
grant select on public.verification_requests to authenticated;
grant insert (requested_role, organization_name, organization_type, rnc, contact_name, contact_phone, coverage_area, document_paths)
  on public.verification_requests to authenticated;

drop policy if exists "Users read their own requests; admins read all" on public.verification_requests;
create policy "Users read their own requests; admins read all"
  on public.verification_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Users create their own pending request" on public.verification_requests;
create policy "Users create their own pending request"
  on public.verification_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and reviewed_by is null);

-- 3. Al crear la solicitud: los documentos deben estar en la carpeta del usuario,
--    y el perfil pasa a "pendiente" (el usuario no puede editar esas columnas directamente).
create or replace function public.handle_verification_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc text;
begin
  foreach doc in array new.document_paths loop
    if doc is null or doc not like new.user_id::text || '/%' or doc like '%..%' then
      raise exception 'Documento no válido: %', doc using errcode = '22023';
    end if;
  end loop;

  update public.profiles
  set requested_role = new.requested_role,
      verification_status = 'pending'
  where id = new.user_id
    and role not in ('organization', 'institution', 'administrator');

  return new;
end;
$$;

revoke all on function public.handle_verification_request() from public;

drop trigger if exists on_verification_request_created on public.verification_requests;
create trigger on_verification_request_created
  before insert on public.verification_requests
  for each row execute function public.handle_verification_request();

-- 4. Revisión por un administrador. Aprobar concede el rol; rechazar lo deja como ciudadano.
create or replace function public.review_verification_request(request_id uuid, approve boolean, notes text default null)
returns public.verification_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.verification_requests;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede revisar solicitudes.' using errcode = '42501';
  end if;
  if notes is not null and char_length(notes) > 500 then
    raise exception 'La nota no puede superar 500 caracteres.' using errcode = '22023';
  end if;

  update public.verification_requests
  set status = case when approve then 'approved' else 'rejected' end,
      review_notes = nullif(trim(notes), ''),
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = request_id and status = 'pending'
  returning * into request;

  if request.id is null then
    raise exception 'La solicitud no existe o ya fue revisada.' using errcode = 'P0002';
  end if;

  update public.profiles
  set role = case when approve then request.requested_role else role end,
      verification_status = case when approve then 'approved' else 'rejected' end
  where id = request.user_id;

  return request;
end;
$$;

revoke all on function public.review_verification_request(uuid, boolean, text) from public;
grant execute on function public.review_verification_request(uuid, boolean, text) to authenticated;

-- 5. Bucket privado para documentos. Cada usuario sube a <uid>/...; solo él y los administradores los leen.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verification-documents', 'verification-documents', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload their verification documents" on storage.objects;
create policy "Users upload their verification documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'verification-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Owners and admins read verification documents" on storage.objects;
create policy "Owners and admins read verification documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'verification-documents'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );


-- ----------------------------------------------------------------------------
-- 20261111020000_reports_anonymous.sql
-- ----------------------------------------------------------------------------
-- RF-07: reportes con opción de publicación anónima.
-- Base mínima de la tabla de reportes (el módulo 2 la ampliará con fotos, estados e historial).
-- El anonimato se garantiza en la base de datos: la tabla no es legible por el público y la
-- vista public_reports nunca expone el autor de un reporte anónimo.
-- Ejecutar después de 20261111010000_organization_verification.sql.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 5 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  category text not null check (category in (
    'basura', 'baches', 'alumbrado', 'agua', 'areas_verdes', 'seguridad', 'educacion', 'otros'
  )),
  latitude double precision not null check (latitude between 17.3 and 20.2),
  longitude double precision not null check (longitude between -72.1 and -68.2),
  address text check (address is null or char_length(address) <= 200),
  province text check (province is null or char_length(province) <= 60),
  municipality text check (municipality is null or char_length(municipality) <= 80),
  sector text check (sector is null or char_length(sector) <= 80),
  status text not null default 'reportado'
    check (status in ('reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado')),
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reports_created_at_idx on public.reports (created_at desc);
create index if not exists reports_author_idx on public.reports (author_id);

drop trigger if exists reports_set_updated_at on public.reports;
create trigger reports_set_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;
grant insert (title, description, category, latitude, longitude, address, province, municipality, sector, is_anonymous)
  on public.reports to authenticated;

-- La tabla solo la leen el autor y los administradores (incluye author_id).
drop policy if exists "Authors and admins read reports" on public.reports;
create policy "Authors and admins read reports"
  on public.reports for select to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Users create their own reports" on public.reports;
create policy "Users create their own reports"
  on public.reports for insert to authenticated
  with check (author_id = (select auth.uid()) and status = 'reportado');

-- Vista pública: todos ven los reportes, pero un reporte anónimo no revela quién lo hizo.
-- Se ejecuta con los permisos de su dueño (no security_invoker) para poder leer la tabla
-- sin exponer author_id; por eso solo selecciona columnas seguras.
drop view if exists public.public_reports;
create view public.public_reports
with (security_barrier = true)
as
select
  r.id,
  r.title,
  r.description,
  r.category,
  r.latitude,
  r.longitude,
  r.address,
  r.province,
  r.municipality,
  r.sector,
  r.status,
  r.is_anonymous,
  case when r.is_anonymous then null else nullif(p.full_name, '') end as author_name,
  case when r.is_anonymous then null else p.avatar_url end as author_avatar_url,
  r.created_at
from public.reports r
join public.profiles p on p.id = r.author_id;

revoke all on public.public_reports from anon, authenticated;
grant select on public.public_reports to anon, authenticated;
