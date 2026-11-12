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


-- ----------------------------------------------------------------------------
-- 20261114000000_report_lifecycle.sql
-- ----------------------------------------------------------------------------
-- RF-15: el autor edita o elimina su reporte dentro del período permitido.
-- RF-16: ciclo de vida del reporte con historial (quién cambió qué y cuándo).
-- RF-17: evidencia de solución con fotos "Antes y Después".
--
-- Reglas (sección 4 de la propuesta):
--   · El autor edita o elimina su reporte solo durante las primeras 24 horas y mientras siga
--     en "Reportado" (si una institución ya lo está atendiendo, ya no se puede cambiar).
--   · Los estados los cambia la institución pública de la jurisdicción del reporte.
--   · El administrador modera: solo puede rechazar un reporte o restaurar uno rechazado.
--   · Marcar "Resuelto" exige al menos una foto de evidencia (el "Después").
--   · Cada cambio de estado queda en un historial que nadie puede editar ni borrar.
-- Ejecutar después de 20261113000000_report_media.sql.

-- 1. Período de edición (debe coincidir con REPORT_EDIT_WINDOW_HOURS en la app).
create or replace function public.report_edit_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '24 hours';
$$;

-- ¿Puede la persona actual editar o eliminar este reporte?
create or replace function public.report_is_editable(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reports r
    where r.id = target
      and r.author_id = (select auth.uid())
      and r.status = 'reportado'
      and r.created_at > now() - public.report_edit_window()
  );
$$;

-- ¿Es la persona actual la institución responsable de este reporte?
-- Jurisdicción = la provincia del perfil de la institución y, si lo indicó, su municipio.
create or replace function public.can_manage_report(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reports r
    join public.profiles me on me.id = (select auth.uid())
    where r.id = target
      and me.role = 'institution'
      and me.province is not null
      and r.province = me.province
      and (
        nullif(trim(me.municipality), '') is null
        or lower(trim(coalesce(r.municipality, ''))) = lower(trim(me.municipality))
      )
  );
$$;

revoke all on function public.report_is_editable(uuid) from public;
revoke all on function public.can_manage_report(uuid) from public;
grant execute on function public.report_is_editable(uuid) to authenticated;
grant execute on function public.can_manage_report(uuid) to authenticated;

-- Una institución no puede cambiarse sola de jurisdicción (se lo pide a la administración).
create or replace function public.lock_institution_jurisdiction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'institution'
     and (new.province is distinct from old.province or new.municipality is distinct from old.municipality)
     and not public.is_admin() then
    raise exception 'Una institución no puede cambiar su provincia o municipio: pídeselo a la administración.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.lock_institution_jurisdiction() from public;

drop trigger if exists profiles_lock_institution_jurisdiction on public.profiles;
create trigger profiles_lock_institution_jurisdiction
  before update on public.profiles
  for each row execute function public.lock_institution_jurisdiction();

-- 2. Historial de estados (RF-16). Base del SLA: estado anterior y nuevo, responsable y fecha.
create table if not exists public.report_status_history (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports (id) on delete cascade,
  from_status text check (from_status in ('reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado')),
  to_status text not null check (to_status in ('reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado')),
  note text check (note is null or char_length(note) <= 500),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_by_role text,
  created_at timestamptz not null default now()
);

create index if not exists report_status_history_report_idx on public.report_status_history (report_id, created_at);

-- Nadie lo escribe directamente: solo el disparador. Nadie lo edita ni lo borra.
alter table public.report_status_history enable row level security;
revoke all on public.report_status_history from anon, authenticated;

create or replace function public.log_report_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.report_status_history (report_id, from_status, to_status, changed_by, changed_by_role)
    values (new.id, null, new.status, new.author_id, 'author');
  elsif new.status is distinct from old.status then
    insert into public.report_status_history (report_id, from_status, to_status, note, changed_by, changed_by_role)
    values (
      new.id,
      old.status,
      new.status,
      nullif(current_setting('conectard.status_note', true), ''),
      (select auth.uid()),
      coalesce(public.current_user_role(), 'system')
    );
    perform set_config('conectard.status_note', '', true);
  end if;
  return new;
end;
$$;

revoke all on function public.log_report_status() from public;

drop trigger if exists reports_log_status on public.reports;
create trigger reports_log_status
  after insert or update of status on public.reports
  for each row execute function public.log_report_status();

-- Reportes que ya existían: se registra su creación (y su estado actual, si cambió).
insert into public.report_status_history (report_id, from_status, to_status, changed_by, changed_by_role, created_at)
select r.id, null, 'reportado', r.author_id, 'author', r.created_at
from public.reports r
where not exists (select 1 from public.report_status_history h where h.report_id = r.id);

insert into public.report_status_history (report_id, from_status, to_status, changed_by_role, created_at)
select r.id, 'reportado', r.status, 'system', r.updated_at
from public.reports r
where r.status <> 'reportado'
  and not exists (select 1 from public.report_status_history h where h.report_id = r.id and h.from_status is not null);

-- Vista pública del historial: nunca revela al autor (importante para los anónimos).
-- Muestra el nombre de la institución que hizo el cambio, o "Moderación de ConectaRD".
drop view if exists public.public_report_history;
create view public.public_report_history
with (security_barrier = true)
as
select
  h.id,
  h.report_id,
  h.from_status,
  h.to_status,
  h.note,
  case when h.changed_by_role in ('institution', 'administrator') then h.changed_by_role end as actor_role,
  case
    when h.changed_by_role = 'institution' then coalesce(nullif(p.full_name, ''), 'Institución responsable')
    when h.changed_by_role = 'administrator' then 'Moderación de ConectaRD'
  end as actor_name,
  h.created_at
from public.report_status_history h
left join public.profiles p on p.id = h.changed_by;

revoke all on public.public_report_history from anon, authenticated;
grant select on public.public_report_history to anon, authenticated;

-- 3. Cambiar el estado (RF-16). Reemplaza a update_report_status, que no dejaba historial.
drop function if exists public.update_report_status(uuid, text);

create or replace function public.set_report_status(report_id uuid, new_status text, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_role text := public.current_user_role();
  current_status text;
  clean_note text := nullif(trim(coalesce(note, '')), '');
begin
  if new_status not in ('reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado') then
    raise exception 'Estado no válido.' using errcode = '22023';
  end if;
  if clean_note is not null and char_length(clean_note) > 500 then
    raise exception 'La nota no puede superar 500 caracteres.' using errcode = '22023';
  end if;

  select r.status into current_status from public.reports r where r.id = set_report_status.report_id for update;
  if current_status is null then
    raise exception 'El reporte no existe.' using errcode = 'P0002';
  end if;
  if current_status = new_status then
    raise exception 'El reporte ya está en ese estado.' using errcode = '22023';
  end if;

  if my_role = 'administrator' then
    -- Moderación: rechazar, o devolver a "Reportado" uno rechazado por error.
    if not (new_status = 'rechazado' or (current_status = 'rechazado' and new_status = 'reportado')) then
      raise exception 'Como administrador solo puedes rechazar un reporte o restaurar uno rechazado. El avance lo marca la institución responsable.' using errcode = '42501';
    end if;
  elsif my_role = 'institution' then
    if not public.can_manage_report(set_report_status.report_id) then
      raise exception 'Este reporte no pertenece a tu jurisdicción.' using errcode = '42501';
    end if;
    if new_status = 'reportado' then
      raise exception 'Un reporte no puede volver a "Reportado".' using errcode = '22023';
    end if;
  else
    raise exception 'Solo la institución responsable o un administrador puede cambiar el estado.' using errcode = '42501';
  end if;

  if new_status = 'rechazado' and clean_note is null then
    raise exception 'Escribe el motivo del rechazo.' using errcode = '22023';
  end if;
  if new_status = 'resuelto' and not exists (
    select 1 from public.report_evidence e where e.report_id = set_report_status.report_id
  ) then
    raise exception 'Para marcarlo como resuelto sube al menos una foto de cómo quedó.' using errcode = '22023';
  end if;

  -- La nota la recoge el disparador que escribe el historial.
  perform set_config('conectard.status_note', coalesce(clean_note, ''), true);
  update public.reports r set status = new_status where r.id = set_report_status.report_id;
end;
$$;

-- 4. Editar y eliminar el reporte propio (RF-15).
create or replace function public.update_own_report(
  report_id uuid,
  new_title text,
  new_description text,
  new_category text,
  new_address text default null,
  new_sector text default null,
  new_is_anonymous boolean default null
)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.reports;
begin
  if not public.report_is_editable(update_own_report.report_id) then
    raise exception 'Ya no puedes editar este reporte: pasaron las 24 horas o ya lo está atendiendo una institución.' using errcode = '22023';
  end if;

  update public.reports r
  set title = trim(new_title),
      description = trim(new_description),
      category = new_category,
      address = nullif(trim(coalesce(new_address, '')), ''),
      sector = nullif(trim(coalesce(new_sector, '')), ''),
      is_anonymous = coalesce(new_is_anonymous, r.is_anonymous)
  where r.id = update_own_report.report_id
  returning * into result;

  return result;
end;
$$;

-- Los archivos del almacenamiento los borra la app antes (la base de datos no puede borrarlos).
create or replace function public.delete_own_report(report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.report_is_editable(delete_own_report.report_id) then
    raise exception 'Ya no puedes eliminar este reporte: pasaron las 24 horas o ya lo está atendiendo una institución.' using errcode = '22023';
  end if;
  delete from public.reports r where r.id = delete_own_report.report_id;
end;
$$;

revoke all on function public.update_own_report(uuid, text, text, text, text, text, boolean) from public;
revoke all on function public.delete_own_report(uuid) from public;
grant execute on function public.update_own_report(uuid, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.delete_own_report(uuid) to authenticated;

-- 5. Fotos del autor: solo en la carpeta raíz del reporte y solo durante el período de edición.
drop policy if exists "Authors upload media to their reports" on storage.objects;
create policy "Authors upload media to their reports"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-media'
    and array_length(storage.foldername(name), 1) = 1
    and exists (
      select 1 from public.reports r
      where r.id::text = (storage.foldername(name))[1]
        and r.author_id = (select auth.uid())
        and r.status = 'reportado'
        and r.created_at > now() - public.report_edit_window()
    )
  );

drop policy if exists "Authors delete media from their reports" on storage.objects;
create policy "Authors delete media from their reports"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'report-media'
    and array_length(storage.foldername(name), 1) = 1
    and exists (
      select 1 from public.reports r
      where r.id::text = (storage.foldername(name))[1]
        and r.author_id = (select auth.uid())
        and r.status = 'reportado'
        and r.created_at > now() - public.report_edit_window()
    )
  );

drop policy if exists "Authors add media to their reports" on public.report_media;
create policy "Authors add media to their reports"
  on public.report_media for insert to authenticated
  with check (
    path like report_id::text || '/%'
    and path not like report_id::text || '/%/%'
    and path not like '%..%'
    and public.report_is_editable(report_id)
  );

drop policy if exists "Authors delete media from their reports" on public.report_media;
create policy "Authors delete media from their reports"
  on public.report_media for delete to authenticated
  using (public.report_is_editable(report_id));

-- 6. Evidencia de solución (RF-17): fotos del "Después", en <reporte>/evidencia/.
create table if not exists public.report_evidence (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  path text not null unique check (char_length(path) <= 300),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/webp', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 20971520),
  width integer check (width is null or width between 1 and 10000),
  height integer check (height is null or height between 1 and 10000),
  uploaded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists report_evidence_report_idx on public.report_evidence (report_id, created_at);

alter table public.report_evidence enable row level security;
revoke all on public.report_evidence from anon, authenticated;
-- Todos ven la evidencia, pero no quién la subió.
grant select (id, report_id, path, mime_type, size_bytes, width, height, created_at) on public.report_evidence to anon, authenticated;
grant insert (report_id, path, mime_type, size_bytes, width, height) on public.report_evidence to authenticated;
grant delete on public.report_evidence to authenticated;

drop policy if exists "Report evidence is public" on public.report_evidence;
create policy "Report evidence is public"
  on public.report_evidence for select
  using (true);

drop policy if exists "Institutions add evidence in their jurisdiction" on public.report_evidence;
create policy "Institutions add evidence in their jurisdiction"
  on public.report_evidence for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and path like report_id::text || '/evidencia/%'
    and path not like '%..%'
    and public.can_manage_report(report_id)
  );

drop policy if exists "Uploaders and admins delete evidence" on public.report_evidence;
create policy "Uploaders and admins delete evidence"
  on public.report_evidence for delete to authenticated
  using (uploaded_by = (select auth.uid()) or (select public.is_admin()));

create or replace function public.enforce_report_evidence_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.report_evidence where report_id = new.report_id) >= 5 then
    raise exception 'Un reporte puede tener como máximo 5 fotos de evidencia.' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_report_evidence_limit() from public;

drop trigger if exists report_evidence_limit on public.report_evidence;
create trigger report_evidence_limit
  before insert on public.report_evidence
  for each row execute function public.enforce_report_evidence_limit();

drop policy if exists "Institutions upload evidence" on storage.objects;
create policy "Institutions upload evidence"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-media'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] = 'evidencia'
    and exists (
      select 1 from public.reports r
      where r.id::text = (storage.foldername(name))[1]
        and public.can_manage_report(r.id)
    )
  );

drop policy if exists "Uploaders delete their evidence" on storage.objects;
create policy "Uploaders delete their evidence"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'report-media'
    and (storage.foldername(name))[2] = 'evidencia'
    and owner_id = (select auth.uid())::text
  );

-- El administrador puede borrar cualquier archivo de reportes (moderación).
drop policy if exists "Admins delete report media" on storage.objects;
create policy "Admins delete report media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'report-media' and (select public.is_admin()));

-- 7. La vista pública añade la última actualización de estado y la evidencia.
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
  (select count(*) from public.report_evidence e where e.report_id = r.id)::integer as evidence_count,
  coalesce(
    (select max(h.created_at) from public.report_status_history h where h.report_id = r.id),
    r.created_at
  ) as status_updated_at,
  r.created_at
from public.reports r
join public.profiles p on p.id = r.author_id;

revoke all on public.public_reports from anon, authenticated;
grant select on public.public_reports to anon, authenticated;

-- set_report_status se concede al final: depende de report_evidence.
revoke all on function public.set_report_status(uuid, text, text) from public;
grant execute on function public.set_report_status(uuid, text, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 20261115000000_realtime_map.sql
-- ----------------------------------------------------------------------------
-- RF-18: mapa en tiempo real. RF-20: filtros (índices para que sean rápidos).
--
-- Tiempo real sin exponer datos privados: la tabla reports no es legible por el público
-- (incluye author_id), así que no se puede escuchar directamente. En su lugar, cada cambio
-- envía un aviso por un canal público de Supabase Realtime ("public-reports") con SOLO el id
-- del reporte y el tipo de cambio. La app vuelve a leer ese reporte desde la vista pública
-- public_reports, que ya oculta al autor de los anónimos.
-- Ejecutar después de 20261114000000_report_lifecycle.sql.

-- 1. Índices para los filtros del mapa (provincia, municipio, sector, estado, categoría, fecha).
create index if not exists reports_province_idx on public.reports (province);
create index if not exists reports_status_idx on public.reports (status);
create index if not exists reports_category_idx on public.reports (category);

-- 2. Aviso en vivo. Si Realtime no está disponible, el reporte se guarda igual (el aviso es opcional).
create or replace function public.notify_report_change(target uuid, change text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', target, 'change', change),
    'report_changed',
    'public-reports',
    false
  );
exception when others then
  -- Sin Realtime (o sin permisos) no se interrumpe la operación principal.
  null;
end;
$$;

revoke all on function public.notify_report_change(uuid, text) from public;

create or replace function public.broadcast_report_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.notify_report_change(old.id, 'deleted');
    return old;
  end if;
  perform public.notify_report_change(new.id, case when tg_op = 'INSERT' then 'created' else 'updated' end);
  return new;
end;
$$;

-- Fotos y evidencia: cambian la portada y el "Antes y Después" del reporte.
create or replace function public.broadcast_report_media_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_report_change(case when tg_op = 'DELETE' then old.report_id else new.report_id end, 'updated');
  return null;
end;
$$;

revoke all on function public.broadcast_report_change() from public;
revoke all on function public.broadcast_report_media_change() from public;

drop trigger if exists reports_broadcast_change on public.reports;
create trigger reports_broadcast_change
  after insert or update or delete on public.reports
  for each row execute function public.broadcast_report_change();

drop trigger if exists report_media_broadcast_change on public.report_media;
create trigger report_media_broadcast_change
  after insert or delete on public.report_media
  for each row execute function public.broadcast_report_media_change();

drop trigger if exists report_evidence_broadcast_change on public.report_evidence;
create trigger report_evidence_broadcast_change
  after insert or delete on public.report_evidence
  for each row execute function public.broadcast_report_media_change();

-- 3. Búsqueda sin distinguir tildes ni mayúsculas (RF-20, RF-22): "Higuey" encuentra "Higüey".
-- La vista pública añade columnas normalizadas para filtrar; la app no las descarga.
create extension if not exists unaccent with schema extensions;

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
  (select count(*) from public.report_evidence e where e.report_id = r.id)::integer as evidence_count,
  coalesce(
    (select max(h.created_at) from public.report_status_history h where h.report_id = r.id),
    r.created_at
  ) as status_updated_at,
  r.created_at,
  lower(extensions.unaccent(coalesce(r.municipality, ''))) as municipality_key,
  lower(extensions.unaccent(coalesce(r.sector, ''))) as sector_key,
  lower(extensions.unaccent(concat_ws(' ', r.title, r.description, r.sector, r.municipality, r.address))) as search_key
from public.reports r
join public.profiles p on p.id = r.author_id;

revoke all on public.public_reports from anon, authenticated;
grant select on public.public_reports to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 20261116000000_community.sql
-- ----------------------------------------------------------------------------
-- Módulo 4: interacción ciudadana, comunidad y redes.
--   RF-23/RF-24: apoyos "Me afecta" y orden por apoyos.
--   RF-25: comentarios con respuestas (un nivel).
--   RF-26: "Sumarme como voluntario" a un reporte (y las ONG participantes avanzan su estado).
--   RF-27/RF-28: jornadas comunitarias ligadas a reportes, con pase de lista por código QR.
--   RF-29/RF-30: solicitudes de insumos y registro público de donaciones y de su uso.
-- Privacidad: ninguna vista pública revela al autor de un reporte anónimo, ni la lista de
-- asistentes de una jornada (solo la ve quien la organiza).
-- Ejecutar después de 20261115000000_realtime_map.sql.

-- =====================================================================
-- 1. Apoyos "Me afecta" (RF-24)
-- =====================================================================
create table if not exists public.report_supports (
  report_id uuid not null references public.reports (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

create index if not exists report_supports_user_idx on public.report_supports (user_id);

alter table public.report_supports enable row level security;
revoke all on public.report_supports from anon, authenticated;

-- Se escribe solo con estas funciones (mensajes claros y reglas en un solo lugar).
create or replace function public.toggle_report_support(target_report uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  report_author uuid;
  report_status text;
begin
  if me is null then
    raise exception 'Inicia sesión para apoyar un reporte.' using errcode = '42501';
  end if;
  select r.author_id, r.status into report_author, report_status from public.reports r where r.id = target_report;
  if report_author is null then
    raise exception 'El reporte no existe.' using errcode = 'P0002';
  end if;

  delete from public.report_supports s where s.report_id = target_report and s.user_id = me;
  if found then
    return false;
  end if;

  if report_author = me then
    raise exception 'No puedes apoyar tu propio reporte.' using errcode = '22023';
  end if;
  if report_status in ('resuelto', 'rechazado') then
    raise exception 'Este reporte ya está cerrado.' using errcode = '22023';
  end if;
  insert into public.report_supports (report_id, user_id) values (target_report, me);
  return true;
end;
$$;

revoke all on function public.toggle_report_support(uuid) from public;
grant execute on function public.toggle_report_support(uuid) to authenticated;

-- =====================================================================
-- 2. Comentarios (RF-25)
-- =====================================================================
create table if not exists public.report_comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.report_comments (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null
);

create index if not exists report_comments_report_idx on public.report_comments (report_id, created_at);
create index if not exists report_comments_parent_idx on public.report_comments (parent_id);

alter table public.report_comments enable row level security;
revoke all on public.report_comments from anon, authenticated;

create or replace function public.add_report_comment(target_report uuid, comment_body text, reply_to uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  clean text := btrim(coalesce(comment_body, ''));
  report_status text;
  parent_report uuid;
  parent_parent uuid;
  new_id uuid;
begin
  if me is null then
    raise exception 'Inicia sesión para comentar.' using errcode = '42501';
  end if;
  if char_length(clean) < 1 or char_length(clean) > 1000 then
    raise exception 'El comentario debe tener entre 1 y 1000 caracteres.' using errcode = '22023';
  end if;
  select r.status into report_status from public.reports r where r.id = target_report;
  if report_status is null then
    raise exception 'El reporte no existe.' using errcode = 'P0002';
  end if;
  if report_status = 'rechazado' then
    raise exception 'No se puede comentar un reporte rechazado.' using errcode = '22023';
  end if;
  if reply_to is not null then
    select c.report_id, c.parent_id into parent_report, parent_parent
    from public.report_comments c where c.id = reply_to and c.deleted_at is null;
    if parent_report is distinct from target_report then
      raise exception 'El comentario al que respondes no existe.' using errcode = 'P0002';
    end if;
    -- Un solo nivel de respuestas: responder a una respuesta cuelga del comentario original.
    reply_to := coalesce(parent_parent, reply_to);
  end if;
  -- Freno al spam: como máximo 10 comentarios por minuto.
  if (select count(*) from public.report_comments c where c.author_id = me and c.created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Estás comentando muy rápido. Espera un momento.' using errcode = '22023';
  end if;

  insert into public.report_comments (report_id, author_id, parent_id, body)
  values (target_report, me, reply_to, clean)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.edit_report_comment(target_comment uuid, comment_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := btrim(coalesce(comment_body, ''));
begin
  if char_length(clean) < 1 or char_length(clean) > 1000 then
    raise exception 'El comentario debe tener entre 1 y 1000 caracteres.' using errcode = '22023';
  end if;
  update public.report_comments c
  set body = clean, edited_at = now()
  where c.id = target_comment and c.author_id = (select auth.uid()) and c.deleted_at is null;
  if not found then
    raise exception 'Solo puedes editar tus propios comentarios.' using errcode = '42501';
  end if;
end;
$$;

-- Borrado suave: si tenía respuestas, el hilo se mantiene con "Comentario eliminado".
create or replace function public.delete_report_comment(target_comment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.report_comments c
  set deleted_at = now(), deleted_by = (select auth.uid())
  where c.id = target_comment
    and c.deleted_at is null
    and (c.author_id = (select auth.uid()) or public.is_admin());
  if not found then
    raise exception 'No puedes eliminar este comentario.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.add_report_comment(uuid, text, uuid) from public;
revoke all on function public.edit_report_comment(uuid, text) from public;
revoke all on function public.delete_report_comment(uuid) from public;
grant execute on function public.add_report_comment(uuid, text, uuid) to authenticated;
grant execute on function public.edit_report_comment(uuid, text) to authenticated;
grant execute on function public.delete_report_comment(uuid) to authenticated;

-- Vista pública: si quien comenta es el autor de un reporte anónimo, no se muestra su nombre.
drop view if exists public.public_report_comments;
create view public.public_report_comments
with (security_barrier = true)
as
select
  c.id,
  c.report_id,
  c.parent_id,
  case when c.deleted_at is null then c.body end as body,
  c.deleted_at is not null as is_deleted,
  c.author_id = r.author_id as is_report_author,
  case
    when c.deleted_at is not null then null
    when r.is_anonymous and c.author_id = r.author_id then null
    else nullif(p.full_name, '')
  end as author_name,
  case
    when c.deleted_at is not null then null
    when r.is_anonymous and c.author_id = r.author_id then null
    else p.avatar_url
  end as author_avatar_url,
  case when r.is_anonymous and c.author_id = r.author_id then null else p.role end as author_role,
  c.author_id = (select auth.uid()) as is_mine,
  c.created_at,
  c.edited_at
from public.report_comments c
join public.reports r on r.id = c.report_id
join public.profiles p on p.id = c.author_id;

revoke all on public.public_report_comments from anon, authenticated;
grant select on public.public_report_comments to anon, authenticated;

-- =====================================================================
-- 3. "Sumarme como voluntario" a un reporte (RF-26)
-- =====================================================================
create table if not exists public.report_volunteers (
  report_id uuid not null references public.reports (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

create index if not exists report_volunteers_user_idx on public.report_volunteers (user_id);

alter table public.report_volunteers enable row level security;
revoke all on public.report_volunteers from anon, authenticated;

create or replace function public.toggle_report_volunteer(target_report uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  report_status text;
begin
  if me is null then
    raise exception 'Inicia sesión para sumarte.' using errcode = '42501';
  end if;
  select r.status into report_status from public.reports r where r.id = target_report;
  if report_status is null then
    raise exception 'El reporte no existe.' using errcode = 'P0002';
  end if;

  delete from public.report_volunteers v where v.report_id = target_report and v.user_id = me;
  if found then
    return false;
  end if;

  if not public.has_any_role(array['volunteer', 'organization', 'administrator']) then
    raise exception 'Para sumarte necesitas ser voluntario. Puedes solicitarlo desde tu perfil.' using errcode = '42501';
  end if;
  if report_status in ('resuelto', 'rechazado') then
    raise exception 'Este reporte ya está cerrado.' using errcode = '22023';
  end if;
  insert into public.report_volunteers (report_id, user_id) values (target_report, me);
  return true;
end;
$$;

revoke all on function public.toggle_report_volunteer(uuid) from public;
grant execute on function public.toggle_report_volunteer(uuid) to authenticated;

-- Quiénes se sumaron (nombre, foto y rol: son voluntarios y organizaciones que actúan en público).
drop view if exists public.public_report_volunteers;
create view public.public_report_volunteers
with (security_barrier = true)
as
select
  v.report_id,
  nullif(p.full_name, '') as name,
  p.avatar_url,
  p.role,
  v.user_id = (select auth.uid()) as is_mine,
  v.created_at
from public.report_volunteers v
join public.profiles p on p.id = v.user_id;

revoke all on public.public_report_volunteers from anon, authenticated;
grant select on public.public_report_volunteers to anon, authenticated;

-- ¿La organización actual participa en este reporte? (cambio de estado "limitado", sección 4).
create or replace function public.participates_in_report(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.report_volunteers v
    join public.profiles me on me.id = v.user_id
    where v.report_id = target and v.user_id = (select auth.uid()) and me.role = 'organization'
  );
$$;

-- Puede trabajar en el reporte (subir evidencia): la institución de la jurisdicción o una ONG participante.
create or replace function public.can_work_on_report(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_report(target) or public.participates_in_report(target);
$$;

revoke all on function public.participates_in_report(uuid) from public;
revoke all on function public.can_work_on_report(uuid) from public;
grant execute on function public.participates_in_report(uuid) to authenticated;
grant execute on function public.can_work_on_report(uuid) to authenticated;

-- Cambio de estado: se añade la ONG participante (solo "En proceso" o "Resuelto").
create or replace function public.set_report_status(report_id uuid, new_status text, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_role text := public.current_user_role();
  current_status text;
  clean_note text := nullif(trim(coalesce(note, '')), '');
begin
  if new_status not in ('reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado') then
    raise exception 'Estado no válido.' using errcode = '22023';
  end if;
  if clean_note is not null and char_length(clean_note) > 500 then
    raise exception 'La nota no puede superar 500 caracteres.' using errcode = '22023';
  end if;

  select r.status into current_status from public.reports r where r.id = set_report_status.report_id for update;
  if current_status is null then
    raise exception 'El reporte no existe.' using errcode = 'P0002';
  end if;
  if current_status = new_status then
    raise exception 'El reporte ya está en ese estado.' using errcode = '22023';
  end if;

  if my_role = 'administrator' then
    if not (new_status = 'rechazado' or (current_status = 'rechazado' and new_status = 'reportado')) then
      raise exception 'Como administrador solo puedes rechazar un reporte o restaurar uno rechazado. El avance lo marca la institución responsable.' using errcode = '42501';
    end if;
  elsif my_role = 'institution' then
    if not public.can_manage_report(set_report_status.report_id) then
      raise exception 'Este reporte no pertenece a tu jurisdicción.' using errcode = '42501';
    end if;
    if new_status = 'reportado' then
      raise exception 'Un reporte no puede volver a "Reportado".' using errcode = '22023';
    end if;
  elsif my_role = 'organization' then
    if not public.participates_in_report(set_report_status.report_id) then
      raise exception 'Solo puedes actualizar reportes en los que tu organización participa.' using errcode = '42501';
    end if;
    if new_status not in ('en_proceso', 'resuelto') or current_status in ('resuelto', 'rechazado') then
      raise exception 'Una organización solo puede marcar un reporte abierto como "En proceso" o "Resuelto".' using errcode = '42501';
    end if;
  else
    raise exception 'Solo la institución responsable, una organización participante o un administrador puede cambiar el estado.' using errcode = '42501';
  end if;

  if new_status = 'rechazado' and clean_note is null then
    raise exception 'Escribe el motivo del rechazo.' using errcode = '22023';
  end if;
  if new_status = 'resuelto' and not exists (
    select 1 from public.report_evidence e where e.report_id = set_report_status.report_id
  ) then
    raise exception 'Para marcarlo como resuelto sube al menos una foto de cómo quedó.' using errcode = '22023';
  end if;

  perform set_config('conectard.status_note', coalesce(clean_note, ''), true);
  update public.reports r set status = new_status where r.id = set_report_status.report_id;
end;
$$;

revoke all on function public.set_report_status(uuid, text, text) from public;
grant execute on function public.set_report_status(uuid, text, text) to authenticated;

-- La evidencia también la puede subir la ONG participante.
drop policy if exists "Institutions add evidence in their jurisdiction" on public.report_evidence;
create policy "Institutions add evidence in their jurisdiction"
  on public.report_evidence for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and path like report_id::text || '/evidencia/%'
    and path not like '%..%'
    and public.can_work_on_report(report_id)
  );

drop policy if exists "Institutions upload evidence" on storage.objects;
create policy "Institutions upload evidence"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-media'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] = 'evidencia'
    and exists (
      select 1 from public.reports r
      where r.id::text = (storage.foldername(name))[1]
        and public.can_work_on_report(r.id)
    )
  );

-- =====================================================================
-- 4. Jornadas comunitarias (RF-27) y pase de lista con QR (RF-28)
-- =====================================================================
create table if not exists public.community_events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 5 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location_name text not null check (char_length(location_name) between 3 and 200),
  province text check (province is null or char_length(province) <= 60),
  municipality text check (municipality is null or char_length(municipality) <= 80),
  latitude double precision check (latitude is null or latitude between 17.3 and 20.2),
  longitude double precision check (longitude is null or longitude between -72.1 and -68.2),
  capacity integer check (capacity is null or capacity between 1 and 5000),
  status text not null default 'programado' check (status in ('programado', 'cancelado', 'finalizado')),
  -- Código secreto del QR: nunca se expone en la vista pública.
  checkin_code text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_events_dates check (ends_at > starts_at and ends_at <= starts_at + interval '3 days'),
  constraint community_events_point check ((latitude is null) = (longitude is null))
);

create index if not exists community_events_starts_idx on public.community_events (starts_at);
create index if not exists community_events_organizer_idx on public.community_events (organizer_id);

drop trigger if exists community_events_set_updated_at on public.community_events;
create trigger community_events_set_updated_at
  before update on public.community_events
  for each row execute function public.set_updated_at();

alter table public.community_events enable row level security;
revoke all on public.community_events from anon, authenticated;
grant insert (title, description, starts_at, ends_at, location_name, province, municipality, latitude, longitude, capacity)
  on public.community_events to authenticated;
grant update (title, description, starts_at, ends_at, location_name, province, municipality, latitude, longitude, capacity, status)
  on public.community_events to authenticated;
-- Lectura directa solo del id (para devolverlo al crear); el resto se lee en public_events.
grant select (id, organizer_id) on public.community_events to authenticated;

drop policy if exists "Organizers read their events" on public.community_events;
create policy "Organizers read their events"
  on public.community_events for select to authenticated
  using (organizer_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Organizations and institutions create events" on public.community_events;
create policy "Organizations and institutions create events"
  on public.community_events for insert to authenticated
  with check (
    organizer_id = (select auth.uid())
    and public.has_any_role(array['organization', 'institution', 'administrator'])
    and starts_at > now() - interval '1 hour'
  );

drop policy if exists "Organizers update their events" on public.community_events;
create policy "Organizers update their events"
  on public.community_events for update to authenticated
  using (organizer_id = (select auth.uid()) or (select public.is_admin()))
  with check (organizer_id = (select auth.uid()) or (select public.is_admin()));

-- Reportes que atiende cada jornada.
create table if not exists public.event_reports (
  event_id uuid not null references public.community_events (id) on delete cascade,
  report_id uuid not null references public.reports (id) on delete cascade,
  primary key (event_id, report_id)
);

create index if not exists event_reports_report_idx on public.event_reports (report_id);

alter table public.event_reports enable row level security;
revoke all on public.event_reports from anon, authenticated;
grant select on public.event_reports to anon, authenticated;
grant insert, delete on public.event_reports to authenticated;

drop policy if exists "Event reports are public" on public.event_reports;
create policy "Event reports are public"
  on public.event_reports for select
  using (true);

drop policy if exists "Organizers link reports" on public.event_reports;
create policy "Organizers link reports"
  on public.event_reports for insert to authenticated
  with check (
    exists (
      select 1 from public.community_events e
      where e.id = event_id and (e.organizer_id = (select auth.uid()) or (select public.is_admin()))
    )
    and exists (select 1 from public.reports r where r.id = report_id and r.status <> 'rechazado')
  );

drop policy if exists "Organizers unlink reports" on public.event_reports;
create policy "Organizers unlink reports"
  on public.event_reports for delete to authenticated
  using (
    exists (
      select 1 from public.community_events e
      where e.id = event_id and (e.organizer_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

-- Inscripciones y asistencia.
create table if not exists public.event_attendees (
  event_id uuid not null references public.community_events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  registered_at timestamptz not null default now(),
  checked_in_at timestamptz,
  checked_in_by uuid references public.profiles (id) on delete set null,
  primary key (event_id, user_id)
);

create index if not exists event_attendees_user_idx on public.event_attendees (user_id);

alter table public.event_attendees enable row level security;
revoke all on public.event_attendees from anon, authenticated;

create or replace function public.toggle_event_registration(target_event uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  ev public.community_events;
  taken integer;
begin
  if me is null then
    raise exception 'Inicia sesión para inscribirte.' using errcode = '42501';
  end if;
  select * into ev from public.community_events e where e.id = target_event for update;
  if ev.id is null then
    raise exception 'La jornada no existe.' using errcode = 'P0002';
  end if;

  -- Cancelar la inscripción (si aún no asistió).
  delete from public.event_attendees a
  where a.event_id = target_event and a.user_id = me and a.checked_in_at is null;
  if found then
    return false;
  end if;
  if exists (select 1 from public.event_attendees a where a.event_id = target_event and a.user_id = me) then
    raise exception 'Ya confirmaste tu asistencia a esta jornada.' using errcode = '22023';
  end if;

  if not public.has_any_role(array['volunteer', 'organization', 'administrator']) then
    raise exception 'Para inscribirte necesitas ser voluntario. Puedes solicitarlo desde tu perfil.' using errcode = '42501';
  end if;
  if ev.status <> 'programado' or ev.ends_at < now() then
    raise exception 'Esta jornada ya no recibe inscripciones.' using errcode = '22023';
  end if;
  if ev.capacity is not null then
    select count(*) into taken from public.event_attendees a where a.event_id = target_event;
    if taken >= ev.capacity then
      raise exception 'La jornada ya está llena.' using errcode = '22023';
    end if;
  end if;
  insert into public.event_attendees (event_id, user_id) values (target_event, me);
  return true;
end;
$$;

-- El voluntario escanea el QR de la jornada: confirma SU asistencia.
-- Solo funciona con el código correcto y desde 1 hora antes del inicio hasta 2 horas después del fin.
create or replace function public.check_in_event(target_event uuid, code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  ev public.community_events;
begin
  if me is null then
    raise exception 'Inicia sesión para confirmar tu asistencia.' using errcode = '42501';
  end if;
  select * into ev from public.community_events e where e.id = target_event;
  if ev.id is null then
    raise exception 'La jornada no existe.' using errcode = 'P0002';
  end if;
  if code is null or code <> ev.checkin_code then
    raise exception 'El código QR no es válido o ya fue cambiado. Escanea el código que muestra quien organiza.' using errcode = '22023';
  end if;
  if ev.status = 'cancelado' then
    raise exception 'Esta jornada fue cancelada.' using errcode = '22023';
  end if;
  if now() < ev.starts_at - interval '1 hour' or now() > ev.ends_at + interval '2 hours' then
    raise exception 'El pase de lista solo está abierto durante la jornada.' using errcode = '22023';
  end if;

  update public.event_attendees a
  set checked_in_at = coalesce(a.checked_in_at, now()), checked_in_by = coalesce(a.checked_in_by, me)
  where a.event_id = target_event and a.user_id = me;
  if not found then
    raise exception 'No estás inscrito en esta jornada. Pide a quien organiza que te agregue.' using errcode = '22023';
  end if;
end;
$$;

-- Quien organiza marca la asistencia a mano (por si alguien no puede escanear).
create or replace function public.set_event_attendance(target_event uuid, attendee uuid, present boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.community_events e
    where e.id = target_event and (e.organizer_id = (select auth.uid()) or public.is_admin())
  ) then
    raise exception 'Solo quien organiza la jornada puede pasar lista.' using errcode = '42501';
  end if;
  update public.event_attendees a
  set checked_in_at = case when present then coalesce(a.checked_in_at, now()) end,
      checked_in_by = case when present then (select auth.uid()) end
  where a.event_id = target_event and a.user_id = attendee;
  if not found then
    raise exception 'Esa persona no está inscrita.' using errcode = 'P0002';
  end if;
end;
$$;

-- Código del QR (solo para quien organiza) y cambio del código si se filtró.
create or replace function public.event_checkin_code(target_event uuid, regenerate boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  result text;
begin
  if regenerate then
    update public.community_events e
    set checkin_code = replace(gen_random_uuid()::text, '-', '')
    where e.id = target_event and (e.organizer_id = (select auth.uid()) or public.is_admin())
    returning e.checkin_code into result;
  else
    select e.checkin_code into result from public.community_events e
    where e.id = target_event and (e.organizer_id = (select auth.uid()) or public.is_admin());
  end if;
  if result is null then
    raise exception 'Solo quien organiza la jornada puede ver su código.' using errcode = '42501';
  end if;
  return result;
end;
$$;

-- Lista de inscritos (solo para quien organiza).
create or replace function public.event_roster(target_event uuid)
returns table (user_id uuid, name text, avatar_url text, role text, registered_at timestamptz, checked_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not exists (
    select 1 from public.community_events e
    where e.id = target_event and (e.organizer_id = (select auth.uid()) or public.is_admin())
  ) then
    raise exception 'Solo quien organiza la jornada puede ver la lista.' using errcode = '42501';
  end if;
  return query
  select a.user_id, nullif(p.full_name, ''), p.avatar_url, p.role, a.registered_at, a.checked_in_at
  from public.event_attendees a
  join public.profiles p on p.id = a.user_id
  where a.event_id = target_event
  order by p.full_name;
end;
$$;

revoke all on function public.toggle_event_registration(uuid) from public;
revoke all on function public.check_in_event(uuid, text) from public;
revoke all on function public.set_event_attendance(uuid, uuid, boolean) from public;
revoke all on function public.event_checkin_code(uuid, boolean) from public;
revoke all on function public.event_roster(uuid) from public;
grant execute on function public.toggle_event_registration(uuid) to authenticated;
grant execute on function public.check_in_event(uuid, text) to authenticated;
grant execute on function public.set_event_attendance(uuid, uuid, boolean) to authenticated;
grant execute on function public.event_checkin_code(uuid, boolean) to authenticated;
grant execute on function public.event_roster(uuid) to authenticated;

-- Vista pública de jornadas: sin el código del QR ni la lista de asistentes (solo cifras).
drop view if exists public.public_events;
create view public.public_events
with (security_barrier = true)
as
select
  e.id,
  e.title,
  e.description,
  e.starts_at,
  e.ends_at,
  e.location_name,
  e.province,
  e.municipality,
  e.latitude,
  e.longitude,
  e.capacity,
  -- Una jornada programada cuya hora de fin ya pasó se muestra como finalizada.
  case when e.status = 'programado' and e.ends_at < now() then 'finalizado' else e.status end as status,
  nullif(p.full_name, '') as organizer_name,
  p.avatar_url as organizer_avatar_url,
  p.role as organizer_role,
  (select count(*) from public.event_attendees a where a.event_id = e.id)::integer as attendee_count,
  (select count(*) from public.event_attendees a where a.event_id = e.id and a.checked_in_at is not null)::integer as checked_in_count,
  (select count(*) from public.event_reports er where er.event_id = e.id)::integer as report_count,
  e.organizer_id = (select auth.uid()) as is_organizer,
  exists (select 1 from public.event_attendees a where a.event_id = e.id and a.user_id = (select auth.uid())) as is_registered,
  exists (
    select 1 from public.event_attendees a
    where a.event_id = e.id and a.user_id = (select auth.uid()) and a.checked_in_at is not null
  ) as has_checked_in,
  e.created_at
from public.community_events e
join public.profiles p on p.id = e.organizer_id;

revoke all on public.public_events from anon, authenticated;
grant select on public.public_events to anon, authenticated;

-- =====================================================================
-- 5. Insumos (RF-29) y transparencia de donaciones y su uso (RF-30)
-- =====================================================================
create table if not exists public.resource_requests (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  requester_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  item text not null check (char_length(item) between 2 and 120),
  quantity numeric(12, 2) not null check (quantity > 0 and quantity <= 1000000),
  unit text not null check (char_length(unit) between 1 and 30),
  description text check (description is null or char_length(description) <= 500),
  status text not null default 'abierta' check (status in ('abierta', 'cerrada', 'cancelada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resource_requests_report_idx on public.resource_requests (report_id);

drop trigger if exists resource_requests_set_updated_at on public.resource_requests;
create trigger resource_requests_set_updated_at
  before update on public.resource_requests
  for each row execute function public.set_updated_at();

create table if not exists public.resource_donations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.resource_requests (id) on delete cascade,
  donor_name text check (donor_name is null or char_length(donor_name) <= 120),
  quantity numeric(12, 2) not null check (quantity > 0 and quantity <= 1000000),
  note text check (note is null or char_length(note) <= 300),
  received_on date not null default current_date,
  registered_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.resource_usages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.resource_requests (id) on delete cascade,
  quantity numeric(12, 2) not null check (quantity > 0 and quantity <= 1000000),
  description text not null check (char_length(description) between 5 and 500),
  used_on date not null default current_date,
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  registered_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists resource_donations_request_idx on public.resource_donations (request_id);
create index if not exists resource_usages_request_idx on public.resource_usages (request_id);

alter table public.resource_requests enable row level security;
alter table public.resource_donations enable row level security;
alter table public.resource_usages enable row level security;
revoke all on public.resource_requests from anon, authenticated;
revoke all on public.resource_donations from anon, authenticated;
revoke all on public.resource_usages from anon, authenticated;

-- Todo es público (transparencia), salvo quién registró cada movimiento.
grant select (id, report_id, item, quantity, unit, description, status, created_at, updated_at) on public.resource_requests to anon, authenticated;
grant select (id, request_id, donor_name, quantity, note, received_on, created_at) on public.resource_donations to anon, authenticated;
grant select (id, request_id, quantity, description, used_on, photo_path, created_at) on public.resource_usages to anon, authenticated;
grant insert (report_id, item, quantity, unit, description) on public.resource_requests to authenticated;
grant update (description, status) on public.resource_requests to authenticated;
grant insert (request_id, donor_name, quantity, note, received_on) on public.resource_donations to authenticated;
grant insert (request_id, quantity, description, used_on, photo_path) on public.resource_usages to authenticated;

drop policy if exists "Resource requests are public" on public.resource_requests;
create policy "Resource requests are public" on public.resource_requests for select using (true);
drop policy if exists "Resource donations are public" on public.resource_donations;
create policy "Resource donations are public" on public.resource_donations for select using (true);
drop policy if exists "Resource usages are public" on public.resource_usages;
create policy "Resource usages are public" on public.resource_usages for select using (true);

drop policy if exists "Organizations and institutions request resources" on public.resource_requests;
create policy "Organizations and institutions request resources"
  on public.resource_requests for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and public.has_any_role(array['organization', 'institution', 'administrator'])
    and exists (select 1 from public.reports r where r.id = report_id and r.status not in ('resuelto', 'rechazado'))
  );

drop policy if exists "Requesters update their requests" on public.resource_requests;
create policy "Requesters update their requests"
  on public.resource_requests for update to authenticated
  using (requester_id = (select auth.uid()) or (select public.is_admin()))
  with check (requester_id = (select auth.uid()) or (select public.is_admin()));

-- Donaciones y uso: los registra quien hizo la solicitud (o un administrador).
drop policy if exists "Requesters register donations" on public.resource_donations;
create policy "Requesters register donations"
  on public.resource_donations for insert to authenticated
  with check (
    registered_by = (select auth.uid())
    and received_on <= current_date
    and exists (
      select 1 from public.resource_requests q
      where q.id = request_id and q.status <> 'cancelada'
        and (q.requester_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

drop policy if exists "Requesters register usage" on public.resource_usages;
create policy "Requesters register usage"
  on public.resource_usages for insert to authenticated
  with check (
    registered_by = (select auth.uid())
    and used_on <= current_date
    and (photo_path is null or photo_path like (select q.report_id::text from public.resource_requests q where q.id = request_id) || '/insumos/%')
    and exists (
      select 1 from public.resource_requests q
      where q.id = request_id
        and (q.requester_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

-- No se puede registrar más uso del que se recibió.
create or replace function public.enforce_resource_usage_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  received numeric;
  used numeric;
begin
  select coalesce(sum(d.quantity), 0) into received from public.resource_donations d where d.request_id = new.request_id;
  select coalesce(sum(u.quantity), 0) into used from public.resource_usages u where u.request_id = new.request_id;
  if used + new.quantity > received then
    raise exception 'No puedes registrar más uso (%) del que se ha recibido (%).', used + new.quantity, received using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_resource_usage_limit() from public;

drop trigger if exists resource_usage_limit on public.resource_usages;
create trigger resource_usage_limit
  before insert on public.resource_usages
  for each row execute function public.enforce_resource_usage_limit();

-- Foto del uso: report-media/<reporte>/insumos/<archivo>, la sube quien hizo una solicitud en ese reporte.
drop policy if exists "Requesters upload usage photos" on storage.objects;
create policy "Requesters upload usage photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-media'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] = 'insumos'
    and exists (
      select 1 from public.resource_requests q
      where q.report_id::text = (storage.foldername(name))[1]
        and (q.requester_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

-- Vista con totales y quién la pidió (organización o institución: actúan en público).
drop view if exists public.public_resource_requests;
create view public.public_resource_requests
with (security_barrier = true)
as
select
  q.id,
  q.report_id,
  q.item,
  q.quantity,
  q.unit,
  q.description,
  q.status,
  nullif(p.full_name, '') as requester_name,
  p.role as requester_role,
  coalesce((select sum(d.quantity) from public.resource_donations d where d.request_id = q.id), 0) as received,
  coalesce((select sum(u.quantity) from public.resource_usages u where u.request_id = q.id), 0) as used,
  q.requester_id = (select auth.uid()) as is_mine,
  q.created_at
from public.resource_requests q
join public.profiles p on p.id = q.requester_id;

revoke all on public.public_resource_requests from anon, authenticated;
grant select on public.public_resource_requests to anon, authenticated;

-- =====================================================================
-- 6. La vista pública de reportes suma apoyos, comentarios y voluntarios (RF-23)
-- =====================================================================
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
  (select count(*) from public.report_evidence e where e.report_id = r.id)::integer as evidence_count,
  coalesce(
    (select max(h.created_at) from public.report_status_history h where h.report_id = r.id),
    r.created_at
  ) as status_updated_at,
  (select count(*) from public.report_supports s where s.report_id = r.id)::integer as support_count,
  (select count(*) from public.report_comments c where c.report_id = r.id and c.deleted_at is null)::integer as comment_count,
  (select count(*) from public.report_volunteers v where v.report_id = r.id)::integer as volunteer_count,
  exists (select 1 from public.report_supports s where s.report_id = r.id and s.user_id = (select auth.uid())) as supported_by_me,
  exists (select 1 from public.report_volunteers v where v.report_id = r.id and v.user_id = (select auth.uid())) as joined_by_me,
  r.author_id = (select auth.uid()) as is_mine,
  r.created_at,
  lower(extensions.unaccent(coalesce(r.municipality, ''))) as municipality_key,
  lower(extensions.unaccent(coalesce(r.sector, ''))) as sector_key,
  lower(extensions.unaccent(concat_ws(' ', r.title, r.description, r.sector, r.municipality, r.address))) as search_key
from public.reports r
join public.profiles p on p.id = r.author_id;

revoke all on public.public_reports from anon, authenticated;
grant select on public.public_reports to anon, authenticated;

-- Avisos en vivo (RF-18) cuando cambian apoyos, comentarios o voluntarios.
drop trigger if exists report_supports_broadcast_change on public.report_supports;
create trigger report_supports_broadcast_change
  after insert or delete on public.report_supports
  for each row execute function public.broadcast_report_media_change();

drop trigger if exists report_comments_broadcast_change on public.report_comments;
create trigger report_comments_broadcast_change
  after insert or delete on public.report_comments
  for each row execute function public.broadcast_report_media_change();

drop trigger if exists report_volunteers_broadcast_change on public.report_volunteers;
create trigger report_volunteers_broadcast_change
  after insert or delete on public.report_volunteers
  for each row execute function public.broadcast_report_media_change();
