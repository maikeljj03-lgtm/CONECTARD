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


-- ----------------------------------------------------------------------------
-- 20261112000000_roles_permissions.sql
-- ----------------------------------------------------------------------------
-- RF-03: roles diferenciados (ciudadano, voluntario, organización, institución, administrador).
-- La base de datos es quien hace cumplir los permisos; la app solo muestra u oculta opciones.
-- Ejecutar después de 20261111020000_reports_anonymous.sql.

-- 1. Registro de la última revisión de rol (no editable por el usuario: no tiene permiso de UPDATE).
alter table public.profiles add column if not exists role_review_notes text;
alter table public.profiles add column if not exists role_reviewed_at timestamptz;
alter table public.profiles add column if not exists role_reviewed_by uuid references public.profiles (id) on delete set null;

alter table public.profiles drop constraint if exists profiles_role_review_notes_length;
alter table public.profiles add constraint profiles_role_review_notes_length
  check (role_review_notes is null or char_length(role_review_notes) <= 500);

-- 2. Consultas de rol para usar en políticas y funciones.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function public.has_any_role(roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select role = any (roles) from public.profiles where id = (select auth.uid())),
    false
  );
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.has_any_role(text[]) from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.has_any_role(text[]) to authenticated;

-- 3. Un ciudadano solicita ser voluntario (queda pendiente de revisión).
create or replace function public.request_volunteer_role()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.profiles;
begin
  if (select auth.uid()) is null then
    raise exception 'Inicia sesión para continuar.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.verification_requests
    where user_id = (select auth.uid()) and status = 'pending'
  ) then
    raise exception 'Ya tienes una solicitud de organización en revisión.' using errcode = '22023';
  end if;

  update public.profiles
  set requested_role = 'volunteer',
      verification_status = 'pending',
      role_review_notes = null
  where id = (select auth.uid()) and role = 'citizen'
  returning * into result;

  if result.id is null then
    raise exception 'Solo una cuenta de ciudadano puede solicitar ser voluntario.' using errcode = '22023';
  end if;
  return result;
end;
$$;

revoke all on function public.request_volunteer_role() from public;
grant execute on function public.request_volunteer_role() to authenticated;

-- 4. El administrador aprueba o rechaza una solicitud de voluntariado.
create or replace function public.review_volunteer_request(target_user uuid, approve boolean, notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewed uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede revisar solicitudes.' using errcode = '42501';
  end if;
  if not approve and nullif(trim(coalesce(notes, '')), '') is null then
    raise exception 'Escribe el motivo del rechazo.' using errcode = '22023';
  end if;
  if notes is not null and char_length(notes) > 500 then
    raise exception 'La nota no puede superar 500 caracteres.' using errcode = '22023';
  end if;

  update public.profiles
  set role = case when approve then 'volunteer' else role end,
      verification_status = case when approve then 'approved' else 'rejected' end,
      role_review_notes = nullif(trim(notes), ''),
      role_reviewed_at = now(),
      role_reviewed_by = (select auth.uid())
  where id = target_user
    and requested_role = 'volunteer'
    and verification_status = 'pending'
    and role = 'citizen'
  returning id into reviewed;

  if reviewed is null then
    raise exception 'La solicitud no existe o ya fue revisada.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.review_volunteer_request(uuid, boolean, text) from public;
grant execute on function public.review_volunteer_request(uuid, boolean, text) to authenticated;

-- 5. El administrador cambia el rol de cualquier cuenta (menos la suya, para no quedarse sin acceso).
create or replace function public.admin_set_user_role(target_user uuid, new_role text, notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cambiar roles.' using errcode = '42501';
  end if;
  if target_user = (select auth.uid()) then
    raise exception 'No puedes cambiar tu propio rol.' using errcode = '22023';
  end if;
  if new_role not in ('citizen', 'volunteer', 'organization', 'institution', 'administrator') then
    raise exception 'Rol no válido.' using errcode = '22023';
  end if;
  if notes is not null and char_length(notes) > 500 then
    raise exception 'La nota no puede superar 500 caracteres.' using errcode = '22023';
  end if;

  update public.profiles
  set role = new_role,
      verification_status = case when new_role = 'citizen' then 'not_required' else 'approved' end,
      role_review_notes = nullif(trim(notes), ''),
      role_reviewed_at = now(),
      role_reviewed_by = (select auth.uid())
  where id = target_user
  returning id into changed;

  if changed is null then
    raise exception 'La cuenta no existe.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_set_user_role(uuid, text, text) from public;
grant execute on function public.admin_set_user_role(uuid, text, text) to authenticated;

-- 6. Listado de cuentas para el administrador (incluye el correo, que vive en auth.users).
create or replace function public.admin_list_users(search text default null, role_filter text default null, max_rows integer default 100)
returns table (
  id uuid,
  full_name text,
  email text,
  avatar_url text,
  role text,
  requested_role text,
  verification_status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver las cuentas.' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name, u.email::text, p.avatar_url, p.role, p.requested_role, p.verification_status, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where (nullif(trim(search), '') is null
         or p.full_name ilike '%' || trim(search) || '%'
         or u.email ilike '%' || trim(search) || '%')
    and (role_filter is null or p.role = role_filter)
  order by p.created_at desc
  limit least(greatest(coalesce(max_rows, 100), 1), 500);
end;
$$;

revoke all on function public.admin_list_users(text, text, integer) from public;
grant execute on function public.admin_list_users(text, text, integer) to authenticated;

-- 7. Instituciones y administradores cambian el estado de un reporte (RF-16).
-- No devuelve la fila para no revelar el autor de un reporte anónimo.
-- Pendiente (módulo 2): limitar cada institución a los reportes de su jurisdicción y guardar historial.
create or replace function public.update_report_status(report_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed uuid;
begin
  if not public.has_any_role(array['institution', 'administrator']) then
    raise exception 'Solo una institución o un administrador puede cambiar el estado.' using errcode = '42501';
  end if;
  if new_status not in ('reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado') then
    raise exception 'Estado no válido.' using errcode = '22023';
  end if;

  update public.reports set status = new_status where id = report_id returning id into changed;
  if changed is null then
    raise exception 'El reporte no existe.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.update_report_status(uuid, text) from public;
grant execute on function public.update_report_status(uuid, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 20261113000000_report_media.sql
-- ----------------------------------------------------------------------------
-- RF-10, RF-11, RF-12: fotos y videos cortos en los reportes.
-- La app comprime las fotos antes de subirlas (RF-12) y les quita los metadatos (incluida la
-- ubicación GPS de la cámara). Aquí se guardan los archivos y se controla quién puede subirlos.
-- Ejecutar después de 20261112000000_roles_permissions.sql.

-- 1. Bucket público: los reportes son públicos, sus fotos también.
-- Los archivos se guardan como <id del reporte>/<archivo>, NUNCA con el id del usuario,
-- para que la dirección de una foto no revele quién hizo un reporte anónimo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-media', 'report-media', true, 20971520,
        array['image/jpeg', 'image/webp', 'image/png', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Report media is publicly readable" on storage.objects;
create policy "Report media is publicly readable"
  on storage.objects for select
  using (bucket_id = 'report-media');

-- Solo el autor del reporte puede subir archivos a la carpeta de ese reporte.
drop policy if exists "Authors upload media to their reports" on storage.objects;
create policy "Authors upload media to their reports"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-media'
    and exists (
      select 1 from public.reports r
      where r.id::text = (storage.foldername(name))[1]
        and r.author_id = (select auth.uid())
    )
  );

drop policy if exists "Authors delete media from their reports" on storage.objects;
create policy "Authors delete media from their reports"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'report-media'
    and exists (
      select 1 from public.reports r
      where r.id::text = (storage.foldername(name))[1]
        and r.author_id = (select auth.uid())
    )
  );

-- 2. Archivos de cada reporte (máximo 5).
create table if not exists public.report_media (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  path text not null unique check (char_length(path) <= 300),
  kind text not null check (kind in ('image', 'video')),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/webp', 'image/png', 'video/mp4', 'video/webm', 'video/quicktime')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 20971520),
  width integer check (width is null or width between 1 and 10000),
  height integer check (height is null or height between 1 and 10000),
  duration_seconds numeric(5, 1) check (duration_seconds is null or duration_seconds between 0 and 60),
  position smallint not null default 0 check (position between 0 and 4),
  created_at timestamptz not null default now()
);

create index if not exists report_media_report_idx on public.report_media (report_id, position);

alter table public.report_media enable row level security;
revoke all on public.report_media from anon, authenticated;
grant select on public.report_media to anon, authenticated;
grant insert (report_id, path, kind, mime_type, size_bytes, width, height, duration_seconds, position)
  on public.report_media to authenticated;
grant delete on public.report_media to authenticated;

-- Todos pueden ver los archivos (no contienen datos del autor).
drop policy if exists "Report media rows are public" on public.report_media;
create policy "Report media rows are public"
  on public.report_media for select
  using (true);

-- Solo el autor añade archivos a su reporte, y la ruta debe estar en la carpeta de ese reporte.
drop policy if exists "Authors add media to their reports" on public.report_media;
create policy "Authors add media to their reports"
  on public.report_media for insert to authenticated
  with check (
    path like report_id::text || '/%'
    and path not like '%..%'
    and exists (select 1 from public.reports r where r.id = report_id and r.author_id = (select auth.uid()))
  );

drop policy if exists "Authors delete media from their reports" on public.report_media;
create policy "Authors delete media from their reports"
  on public.report_media for delete to authenticated
  using (exists (select 1 from public.reports r where r.id = report_id and r.author_id = (select auth.uid())));

-- Límite de 5 archivos por reporte.
create or replace function public.enforce_report_media_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.report_media where report_id = new.report_id) >= 5 then
    raise exception 'Un reporte puede tener como máximo 5 fotos o videos.' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_report_media_limit() from public;

drop trigger if exists report_media_limit on public.report_media;
create trigger report_media_limit
  before insert on public.report_media
  for each row execute function public.enforce_report_media_limit();

-- 3. La vista pública incluye la foto de portada (la primera imagen) para el mapa y el listado.
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
  (
    select m.path from public.report_media m
    where m.report_id = r.id and m.kind = 'image'
    order by m.position, m.created_at
    limit 1
  ) as cover_path,
  (select count(*) from public.report_media m where m.report_id = r.id)::integer as media_count,
  r.created_at
from public.reports r
join public.profiles p on p.id = r.author_id;

revoke all on public.public_reports from anon, authenticated;
grant select on public.public_reports to anon, authenticated;
