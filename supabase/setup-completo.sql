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


-- ----------------------------------------------------------------------------
-- 20261117000000_hardening.sql
-- ----------------------------------------------------------------------------
-- Depuración completa de la base de datos (pruebas de todos los flujos con cada rol).
-- Corrige:
--   1. CRÍTICO: ninguna subida de archivos funcionaba (fotos de perfil, documentos, fotos de
--      reportes). La política de fotos de insumos leía resource_requests.requester_id, columna
--      que authenticated no puede leer; Postgres evalúa TODAS las políticas de INSERT de
--      storage.objects juntas, así que una sola política rota bloqueaba todas las subidas.
--   2. ONG e instituciones no podían pedir insumos, ligar reportes a jornadas ni subir la
--      evidencia al almacenamiento: las políticas buscaban el reporte en public.reports, que
--      solo leen el autor y el administrador.
--   3. Donaciones y usos de insumos fallaban siempre (misma causa que el punto 1).
--   4. El autor de un reporte anónimo quedaba expuesto si se sumaba como voluntario (o pedía
--      insumos, o cambiaba su estado) en su propio reporte.
--   5. Cualquiera, sin sesión, podía enviar avisos falsos al mapa en vivo: Supabase concede
--      EXECUTE a anon y authenticated por separado, y "revoke ... from public" no lo quita.
--   Además: los documentos de verificación sin usar se pueden borrar, nadie puede listar las
--   carpetas de fotos de perfil de los demás y se añade un índice para el freno al spam.
-- Regla: toda comprobación que necesite ver filas que el usuario no puede leer va dentro de
-- una función SECURITY DEFINER, nunca directamente en la política.
-- Ejecutar después de 20261116000000_community.sql.

-- =====================================================================
-- 1. Funciones auxiliares seguras para las políticas
-- =====================================================================

-- Estado de un reporte (null si no existe), visible para cualquier política.
create or replace function public.report_status_of(target uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.status from public.reports r where r.id = target;
$$;

-- ¿Puede la persona actual registrar movimientos en esta solicitud de insumos?
-- (quien la pidió o un administrador; con open_only, solo si sigue abierta)
create or replace function public.can_manage_resource_request(target uuid, open_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.resource_requests q
    where q.id = target
      and (q.requester_id = (select auth.uid()) or public.is_admin())
      and (not open_only or q.status <> 'cancelada')
  );
$$;

-- Reporte al que pertenece una solicitud de insumos (para validar la carpeta de la foto del uso).
create or replace function public.resource_request_report(target uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select q.report_id from public.resource_requests q where q.id = target;
$$;

-- Carpeta report-media/<reporte>/insumos/: la usa quien pidió insumos en ese reporte (o un administrador).
create or replace function public.can_upload_resource_photo(folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.resource_requests q
    where q.report_id::text = folder
      and (q.requester_id = (select auth.uid()) or public.is_admin())
  );
$$;

-- Carpeta report-media/<reporte>/evidencia/: la institución de la jurisdicción o una ONG participante.
create or replace function public.can_upload_evidence(folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reports r
    where r.id::text = folder and public.can_work_on_report(r.id)
  );
$$;

revoke all on function public.report_status_of(uuid) from public, anon;
revoke all on function public.can_manage_resource_request(uuid, boolean) from public, anon;
revoke all on function public.resource_request_report(uuid) from public, anon;
revoke all on function public.can_upload_resource_photo(text) from public, anon;
revoke all on function public.can_upload_evidence(text) from public, anon;
grant execute on function public.report_status_of(uuid) to authenticated;
grant execute on function public.can_manage_resource_request(uuid, boolean) to authenticated;
grant execute on function public.resource_request_report(uuid) to authenticated;
grant execute on function public.can_upload_resource_photo(text) to authenticated;
grant execute on function public.can_upload_evidence(text) to authenticated;

-- =====================================================================
-- 2. Políticas corregidas
-- =====================================================================

-- Almacenamiento: evidencia (antes leía public.reports directamente).
drop policy if exists "Institutions upload evidence" on storage.objects;
create policy "Institutions upload evidence"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-media'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] = 'evidencia'
    and public.can_upload_evidence((storage.foldername(name))[1])
  );

-- Almacenamiento: foto del uso de insumos (antes leía resource_requests.requester_id y rompía TODAS las subidas).
drop policy if exists "Requesters upload usage photos" on storage.objects;
create policy "Requesters upload usage photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-media'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] = 'insumos'
    and public.can_upload_resource_photo((storage.foldername(name))[1])
  );

-- Jornadas: ligar reportes (antes leía public.reports directamente).
drop policy if exists "Organizers link reports" on public.event_reports;
create policy "Organizers link reports"
  on public.event_reports for insert to authenticated
  with check (
    exists (
      select 1 from public.community_events e
      where e.id = event_id and (e.organizer_id = (select auth.uid()) or (select public.is_admin()))
    )
    and public.report_status_of(report_id) <> 'rechazado'
  );

-- Insumos: pedir (antes leía public.reports directamente).
drop policy if exists "Organizations and institutions request resources" on public.resource_requests;
create policy "Organizations and institutions request resources"
  on public.resource_requests for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and public.has_any_role(array['organization', 'institution', 'administrator'])
    and public.report_status_of(report_id) not in ('resuelto', 'rechazado')
  );

-- Donaciones y usos (antes leían resource_requests.requester_id).
drop policy if exists "Requesters register donations" on public.resource_donations;
create policy "Requesters register donations"
  on public.resource_donations for insert to authenticated
  with check (
    registered_by = (select auth.uid())
    and received_on <= current_date
    and public.can_manage_resource_request(request_id, true)
  );

drop policy if exists "Requesters register usage" on public.resource_usages;
create policy "Requesters register usage"
  on public.resource_usages for insert to authenticated
  with check (
    registered_by = (select auth.uid())
    and used_on <= current_date
    and (photo_path is null or photo_path like public.resource_request_report(request_id)::text || '/insumos/%')
    and public.can_manage_resource_request(request_id, false)
  );

-- Documentos de verificación: si el envío falla, el usuario borra los que subió y no usó.
-- Los documentos ya enviados en una solicitud no se pueden borrar (son la evidencia que revisa el administrador).
drop policy if exists "Users delete unused verification documents" on storage.objects;
create policy "Users delete unused verification documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.verification_requests v
      where v.user_id = (select auth.uid()) and name = any (v.document_paths)
    )
  );

-- Fotos de perfil: el bucket es público (las URL funcionan sin esta política), pero listar el
-- contenido revelaba los id de todos los usuarios. Cada quien solo lista su propia carpeta.
drop policy if exists "Avatars are publicly readable" on storage.objects;
drop policy if exists "Users list their own avatars" on storage.objects;
create policy "Users list their own avatars"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- La foto de perfil solo puede apuntar al propio espacio del bucket avatars
-- (NOT VALID: no se revisan filas antiguas, sí todos los cambios nuevos).
alter table public.profiles drop constraint if exists profiles_avatar_url_own_bucket;
alter table public.profiles add constraint profiles_avatar_url_own_bucket
  check (avatar_url is null or position(('/storage/v1/object/public/avatars/' || id::text || '/') in avatar_url) > 0)
  not valid;

-- =====================================================================
-- 3. Vistas: el autor de un reporte anónimo nunca se revela
-- =====================================================================

drop view if exists public.public_report_volunteers;
create view public.public_report_volunteers
with (security_barrier = true)
as
select
  v.report_id,
  case when r.is_anonymous and v.user_id = r.author_id then null else nullif(p.full_name, '') end as name,
  case when r.is_anonymous and v.user_id = r.author_id then null else p.avatar_url end as avatar_url,
  case when r.is_anonymous and v.user_id = r.author_id then null else p.role end as role,
  v.user_id = r.author_id as is_report_author,
  v.user_id = (select auth.uid()) as is_mine,
  v.created_at
from public.report_volunteers v
join public.reports r on r.id = v.report_id
join public.profiles p on p.id = v.user_id;

revoke all on public.public_report_volunteers from anon, authenticated;
grant select on public.public_report_volunteers to anon, authenticated;

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
  case when r.is_anonymous and q.requester_id = r.author_id then null else nullif(p.full_name, '') end as requester_name,
  case when r.is_anonymous and q.requester_id = r.author_id then null else p.role end as requester_role,
  coalesce((select sum(d.quantity) from public.resource_donations d where d.request_id = q.id), 0) as received,
  coalesce((select sum(u.quantity) from public.resource_usages u where u.request_id = q.id), 0) as used,
  q.requester_id = (select auth.uid()) as is_mine,
  q.created_at
from public.resource_requests q
join public.reports r on r.id = q.report_id
join public.profiles p on p.id = q.requester_id;

revoke all on public.public_resource_requests from anon, authenticated;
grant select on public.public_resource_requests to anon, authenticated;

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
    -- Si quien cambió el estado es el autor de un reporte anónimo, no se muestra su nombre.
    when r.is_anonymous and h.changed_by = r.author_id then null
    when h.changed_by_role = 'institution' then coalesce(nullif(p.full_name, ''), 'Institución responsable')
    when h.changed_by_role = 'administrator' then 'Moderación de ConectaRD'
    when h.changed_by_role = 'organization' then coalesce(nullif(p.full_name, ''), 'Organización participante')
  end as actor_name,
  h.created_at
from public.report_status_history h
join public.reports r on r.id = h.report_id
left join public.profiles p on p.id = h.changed_by;

revoke all on public.public_report_history from anon, authenticated;
grant select on public.public_report_history to anon, authenticated;

-- =====================================================================
-- 4. Permisos de ejecución: Supabase concede EXECUTE a anon y authenticated por separado
-- =====================================================================

-- Funciones internas: nadie las llama desde la app (avisos en vivo y disparadores).
revoke execute on function public.notify_report_change(uuid, text) from public, anon, authenticated;
revoke execute on function public.broadcast_report_change() from public, anon, authenticated;
revoke execute on function public.broadcast_report_media_change() from public, anon, authenticated;
revoke execute on function public.log_report_status() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_verification_request() from public, anon, authenticated;
revoke execute on function public.lock_institution_jurisdiction() from public, anon, authenticated;
revoke execute on function public.enforce_report_media_limit() from public, anon, authenticated;
revoke execute on function public.enforce_report_evidence_limit() from public, anon, authenticated;
revoke execute on function public.enforce_resource_usage_limit() from public, anon, authenticated;

-- Funciones que exigen sesión: sin sesión (anon) no se pueden llamar.
revoke execute on function public.add_report_comment(uuid, text, uuid) from anon;
revoke execute on function public.edit_report_comment(uuid, text) from anon;
revoke execute on function public.delete_report_comment(uuid) from anon;
revoke execute on function public.toggle_report_support(uuid) from anon;
revoke execute on function public.toggle_report_volunteer(uuid) from anon;
revoke execute on function public.toggle_event_registration(uuid) from anon;
revoke execute on function public.check_in_event(uuid, text) from anon;
revoke execute on function public.set_event_attendance(uuid, uuid, boolean) from anon;
revoke execute on function public.event_checkin_code(uuid, boolean) from anon;
revoke execute on function public.event_roster(uuid) from anon;
revoke execute on function public.set_report_status(uuid, text, text) from anon;
revoke execute on function public.update_own_report(uuid, text, text, text, text, text, boolean) from anon;
revoke execute on function public.delete_own_report(uuid) from anon;
revoke execute on function public.request_volunteer_role() from anon;
revoke execute on function public.review_volunteer_request(uuid, boolean, text) from anon;
revoke execute on function public.review_verification_request(uuid, boolean, text) from anon;
revoke execute on function public.admin_set_user_role(uuid, text, text) from anon;
revoke execute on function public.admin_list_users(text, text, integer) from anon;

-- =====================================================================
-- 5. Rendimiento
-- =====================================================================

-- Freno al spam de comentarios: cuenta los del último minuto por autor.
create index if not exists report_comments_author_idx on public.report_comments (author_id, created_at desc);


-- ----------------------------------------------------------------------------
-- 20261118000000_engagement.sql
-- ----------------------------------------------------------------------------
-- Módulo 5: notificaciones, gamificación y feedback.
--   RF-32: denunciar contenido (reportes, comentarios, jornadas) y bandeja de moderación.
--   RF-33: filtro automático de lenguaje ofensivo (lo aplica la base de datos: no se puede saltar).
--   RF-34: notificaciones al navegador (la app escucha la tabla notifications en tiempo real).
--   RF-35: datos del resumen semanal por correo (función para el envío programado).
--   RF-36: centro de notificaciones dentro de la app.
--   RF-37: puntos, niveles y medallas por participación (con protección contra trampas).
--   RF-38: ranking mensual, anual o histórico, por provincia, de personas y de organizaciones.
-- Reglas de la depuración (20261117): las políticas nunca leen tablas que el usuario no puede leer
-- (eso va en funciones SECURITY DEFINER) y EXECUTE se revoca explícitamente a anon/authenticated.
-- Ejecutar después de 20261117000000_hardening.sql.

-- =====================================================================
-- 0. Preferencias del usuario
-- =====================================================================
alter table public.profiles add column if not exists show_in_ranking boolean not null default true;
alter table public.profiles add column if not exists weekly_digest boolean not null default true;
grant update (show_in_ranking, weekly_digest) on public.profiles to authenticated;

-- =====================================================================
-- 1. Filtro de lenguaje ofensivo (RF-33)
-- =====================================================================
create table if not exists public.blocked_terms (
  term text primary key check (term = lower(term) and char_length(term) between 2 and 40)
);

alter table public.blocked_terms enable row level security;
revoke all on public.blocked_terms from anon, authenticated;

-- Texto normalizado para comparar: minúsculas, sin tildes (pero conservando la ñ), cambios típicos
-- para esquivar el filtro (4→a, 3→e, 1→i, 0→o, 5→s, 7→t, @→a, $→s) y letras repetidas 3+ veces
-- ("mieeeerda" → "mierda"). Las palabras de la lista se guardan ya normalizadas.
create or replace function public.normalize_for_filter(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    translate(lower(coalesce(input, '')), 'áéíóúüàèìòù4310 57@$', 'aeiouuaeiouaeio stas'),
    '([a-zñ])\1{2,}', '\1', 'g'
  );
$$;

-- Palabras vulgares e insultos claros (español y dominicanismos), ya normalizadas (sin tildes).
-- Se evitan palabras con usos normales en un reporte: "perra" (perro callejero), "cagar"
-- (excremento en la acera), "hp" (la marca), "cuero", "pato", "huevo", "gonorrea" (enfermedad)…
insert into public.blocked_terms (term) values
  ('mierda'), ('carajo'), ('coño'), ('puta'), ('puto'), ('putas'), ('putos'), ('hijo de puta'), ('hija de puta'),
  ('hdp'), ('maricon'), ('marico'), ('marica'), ('mamaguevo'), ('mamaguebo'), ('mmg'), ('cabron'), ('cabrona'),
  ('pendejo'), ('pendeja'), ('singar'), ('singao'), ('singa'), ('singada'), ('verga'), ('vergas'), ('culo'), ('culos'),
  ('cojones'), ('ñema'), ('toto'), ('malparido'), ('malparida'), ('chinga'), ('chingar'), ('chingada'), ('pinga'),
  ('comemierda'), ('come mierda'), ('lambon'), ('cuernuo')
on conflict do nothing;

-- Devuelve la primera palabra ofensiva encontrada (o null). Compara por palabra completa.
create or replace function public.find_offensive_term(input text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.term
  from public.blocked_terms t
  where public.normalize_for_filter(input) ~ ('(^|[^a-zñ])' || t.term || '($|[^a-zñ])')
  limit 1;
$$;

-- Disparador genérico: revisa las columnas indicadas en los argumentos del disparador.
create or replace function public.reject_offensive_language()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  col text;
begin
  foreach col in array tg_argv loop
    if public.find_offensive_term(to_jsonb(new) ->> col) is not null then
      raise exception 'Tu texto contiene lenguaje ofensivo. Revísalo antes de publicar.' using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists reports_language_filter on public.reports;
create trigger reports_language_filter
  before insert or update of title, description, address, sector on public.reports
  for each row execute function public.reject_offensive_language('title', 'description', 'address', 'sector');

drop trigger if exists report_comments_language_filter on public.report_comments;
create trigger report_comments_language_filter
  before insert or update of body on public.report_comments
  for each row execute function public.reject_offensive_language('body');

drop trigger if exists community_events_language_filter on public.community_events;
create trigger community_events_language_filter
  before insert or update of title, description, location_name on public.community_events
  for each row execute function public.reject_offensive_language('title', 'description', 'location_name');

drop trigger if exists resource_requests_language_filter on public.resource_requests;
create trigger resource_requests_language_filter
  before insert or update of item, description on public.resource_requests
  for each row execute function public.reject_offensive_language('item', 'description');

drop trigger if exists resource_donations_language_filter on public.resource_donations;
create trigger resource_donations_language_filter
  before insert on public.resource_donations
  for each row execute function public.reject_offensive_language('donor_name', 'note');

drop trigger if exists resource_usages_language_filter on public.resource_usages;
create trigger resource_usages_language_filter
  before insert on public.resource_usages
  for each row execute function public.reject_offensive_language('description');

-- Perfil: solo al editar (el registro no debe fallar por el nombre que viene de Google).
drop trigger if exists profiles_language_filter on public.profiles;
create trigger profiles_language_filter
  before update of full_name, bio on public.profiles
  for each row execute function public.reject_offensive_language('full_name', 'bio');

-- =====================================================================
-- 2. Centro de notificaciones (RF-36) y avisos al navegador (RF-34)
-- =====================================================================
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'estado', 'comentario', 'respuesta', 'voluntario', 'jornada', 'jornada_cancelada',
    'verificacion', 'rol', 'medalla', 'denuncia', 'moderacion'
  )),
  title text not null check (char_length(title) between 1 and 160),
  body text check (body is null or char_length(body) <= 500),
  -- Solo rutas internas de la app.
  link text check (link is null or link ~ '^/[A-Za-z0-9/_?=&%-]*$'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists "Users read their notifications" on public.notifications;
create policy "Users read their notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users mark their notifications" on public.notifications;
create policy "Users mark their notifications"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users delete their notifications" on public.notifications;
create policy "Users delete their notifications"
  on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- Tiempo real: la app recibe sus notificaciones al instante (Realtime respeta RLS: cada quien solo las suyas).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- Crea una notificación (uso interno de los disparadores).
create or replace function public.notify_user(target uuid, notice_kind text, notice_title text, notice_body text, notice_link text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target is null then
    return;
  end if;
  insert into public.notifications (user_id, kind, title, body, link)
  values (target, notice_kind, left(notice_title, 160), left(nullif(trim(notice_body), ''), 500), notice_link);
end;
$$;

-- Nombre que se puede mostrar de una persona en el contexto de un reporte (nunca el del autor anónimo).
create or replace function public.display_name_in_report(target_report uuid, person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when r.is_anonymous and r.author_id = person then 'El autor del reporte'
    else coalesce(nullif(p.full_name, ''), 'Alguien')
  end
  from public.reports r, public.profiles p
  where r.id = target_report and p.id = person;
$$;

create or replace function public.status_label(status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case status
    when 'reportado' then 'Reportado'
    when 'en_revision' then 'En revisión'
    when 'en_proceso' then 'En proceso'
    when 'resuelto' then 'Resuelto'
    when 'rechazado' then 'Rechazado'
    else status
  end;
$$;

-- a) Cambio de estado: al autor y a quienes siguen el reporte (apoyaron o se sumaron).
create or replace function public.notify_report_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports;
  label text := public.status_label(new.to_status);
  follower uuid;
  quoted text;
begin
  if new.from_status is null then
    return null;
  end if;
  select * into r from public.reports where id = new.report_id;
  if r.id is null then
    return null;
  end if;
  quoted := '“' || left(r.title, 80) || '”' || coalesce('. ' || new.note, '');

  if r.author_id is distinct from new.changed_by then
    perform public.notify_user(
      r.author_id, 'estado',
      case when new.to_status = 'rechazado' then 'Tu reporte fue rechazado'
           when new.to_status = 'resuelto' then '¡Tu reporte fue resuelto!'
           else 'Tu reporte ahora está: ' || label end,
      quoted, '/reporte/' || r.id
    );
  end if;

  for follower in
    select s.user_id from public.report_supports s where s.report_id = r.id
    union
    select v.user_id from public.report_volunteers v where v.report_id = r.id
  loop
    if follower <> r.author_id and follower is distinct from new.changed_by then
      perform public.notify_user(follower, 'estado', 'Un reporte que sigues ahora está: ' || label, quoted, '/reporte/' || r.id);
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists report_status_history_notify on public.report_status_history;
create trigger report_status_history_notify
  after insert on public.report_status_history
  for each row execute function public.notify_report_status();

-- b) Comentarios: al autor del reporte y, si es respuesta, a quien escribió el comentario original.
create or replace function public.notify_new_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports;
  parent_author uuid;
  who text;
begin
  select * into r from public.reports where id = new.report_id;
  who := public.display_name_in_report(new.report_id, new.author_id);

  if r.author_id <> new.author_id then
    perform public.notify_user(r.author_id, 'comentario', who || ' comentó en tu reporte', left(new.body, 160), '/reporte/' || r.id);
  end if;

  if new.parent_id is not null then
    select c.author_id into parent_author from public.report_comments c where c.id = new.parent_id;
    if parent_author is not null and parent_author <> new.author_id and parent_author <> r.author_id then
      perform public.notify_user(parent_author, 'respuesta', who || ' respondió tu comentario', left(new.body, 160), '/reporte/' || r.id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists report_comments_notify on public.report_comments;
create trigger report_comments_notify
  after insert on public.report_comments
  for each row execute function public.notify_new_comment();

-- c) Alguien se suma como voluntario al reporte.
create or replace function public.notify_new_volunteer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports;
begin
  select * into r from public.reports where id = new.report_id;
  if r.author_id <> new.user_id then
    perform public.notify_user(
      r.author_id, 'voluntario',
      public.display_name_in_report(new.report_id, new.user_id) || ' se sumó para resolver tu reporte',
      '“' || left(r.title, 80) || '”', '/reporte/' || r.id
    );
  end if;
  return null;
end;
$$;

drop trigger if exists report_volunteers_notify on public.report_volunteers;
create trigger report_volunteers_notify
  after insert on public.report_volunteers
  for each row execute function public.notify_new_volunteer();

-- d) Una jornada atenderá tu reporte.
create or replace function public.notify_event_linked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports;
  ev public.community_events;
begin
  select * into r from public.reports where id = new.report_id;
  select * into ev from public.community_events where id = new.event_id;
  if r.author_id <> ev.organizer_id then
    perform public.notify_user(
      r.author_id, 'jornada', 'Organizaron una jornada para tu reporte',
      '“' || left(ev.title, 80) || '”, ' || to_char(ev.starts_at at time zone 'America/Santo_Domingo', 'DD/MM/YYYY HH12:MI AM'),
      '/jornadas/' || ev.id
    );
  end if;
  return null;
end;
$$;

drop trigger if exists event_reports_notify on public.event_reports;
create trigger event_reports_notify
  after insert on public.event_reports
  for each row execute function public.notify_event_linked();

-- e) Jornada cancelada: a las personas inscritas.
create or replace function public.notify_event_cancelled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attendee uuid;
begin
  if new.status = 'cancelado' and old.status <> 'cancelado' then
    for attendee in select a.user_id from public.event_attendees a where a.event_id = new.id loop
      perform public.notify_user(attendee, 'jornada_cancelada', 'Se canceló una jornada a la que te inscribiste', '“' || left(new.title, 80) || '”', '/jornadas/' || new.id);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists community_events_notify on public.community_events;
create trigger community_events_notify
  after update of status on public.community_events
  for each row execute function public.notify_event_cancelled();

-- f) Revisión de la verificación de ONG / institución.
create or replace function public.notify_verification_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> old.status and new.status in ('approved', 'rejected') then
    perform public.notify_user(
      new.user_id, 'verificacion',
      case when new.status = 'approved' then '¡Tu organización fue verificada!' else 'Tu solicitud de verificación fue rechazada' end,
      coalesce(new.review_notes, case when new.status = 'approved' then 'Ya puedes organizar jornadas y pedir insumos.' end),
      '/perfil'
    );
  end if;
  return null;
end;
$$;

drop trigger if exists verification_requests_notify on public.verification_requests;
create trigger verification_requests_notify
  after update of status on public.verification_requests
  for each row execute function public.notify_verification_review();

-- g) Cambio de rol o rechazo del voluntariado.
create or replace function public.notify_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role <> old.role
     and not (new.role in ('organization', 'institution') and new.verification_status = 'approved' and old.verification_status = 'pending') then
    perform public.notify_user(
      new.id, 'rol',
      'Tu cuenta ahora es: ' || case new.role
        when 'citizen' then 'Ciudadano' when 'volunteer' then 'Voluntario' when 'organization' then 'Organización / ONG'
        when 'institution' then 'Institución pública' when 'administrator' then 'Administrador' else new.role end,
      new.role_review_notes, '/perfil'
    );
  elsif new.verification_status = 'rejected' and old.verification_status <> 'rejected' and new.requested_role = 'volunteer' then
    perform public.notify_user(new.id, 'rol', 'Tu solicitud de voluntariado fue rechazada', new.role_review_notes, '/perfil');
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_notify_role on public.profiles;
create trigger profiles_notify_role
  after update of role, verification_status on public.profiles
  for each row execute function public.notify_role_change();

-- Marcar todas como leídas (un solo viaje a la base de datos).
create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.notifications set read_at = now()
  where user_id = (select auth.uid()) and read_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- =====================================================================
-- 3. Puntos, niveles y medallas (RF-37)
-- =====================================================================
-- Cada acción da puntos una sola vez por cosa (único por usuario + acción + referencia):
-- apoyar y quitar el apoyo una y otra vez no suma; un reporte rechazado o eliminado resta sus puntos.
create table if not exists public.point_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  action text not null check (action in (
    'reporte', 'reporte_resuelto', 'apoyo', 'comentario', 'voluntariado', 'asistencia', 'jornada_organizada', 'solucion'
  )),
  points integer not null check (points > 0 and points <= 100),
  ref_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, action, ref_id)
);

create index if not exists point_events_user_idx on public.point_events (user_id, created_at);
create index if not exists point_events_created_idx on public.point_events (created_at);
create index if not exists point_events_ref_idx on public.point_events (ref_id);

alter table public.point_events enable row level security;
revoke all on public.point_events from anon, authenticated;

create table if not exists public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge text not null check (badge in (
    'primer_reporte', 'reportero', 'problema_resuelto', 'barrio_mejor', 'solidario', 'voz_comunidad',
    'manos_a_la_obra', 'voluntario_constante', 'organizador', 'solucionador'
  )),
  earned_at timestamptz not null default now(),
  primary key (user_id, badge)
);

alter table public.user_badges enable row level security;
revoke all on public.user_badges from anon, authenticated;

-- Medallas: se ganan al llegar a cierta cantidad de acciones y no se pierden.
create or replace function public.award_badges(person uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  counts jsonb;
  earned text;
  badge_label text;
begin
  select coalesce(jsonb_object_agg(action, n), '{}'::jsonb) into counts
  from (select action, count(*) n from public.point_events where user_id = person group by action) c;

  for earned in
    insert into public.user_badges (user_id, badge)
    select person, b.badge
    from (values
      ('primer_reporte', 'reporte', 1), ('reportero', 'reporte', 10),
      ('problema_resuelto', 'reporte_resuelto', 1), ('barrio_mejor', 'reporte_resuelto', 5),
      ('solidario', 'apoyo', 25), ('voz_comunidad', 'comentario', 10),
      ('manos_a_la_obra', 'asistencia', 1), ('voluntario_constante', 'asistencia', 5),
      ('organizador', 'jornada_organizada', 1), ('solucionador', 'solucion', 5)
    ) as b (badge, action, needed)
    where coalesce((counts ->> b.action)::int, 0) >= b.needed
    on conflict do nothing
    returning badge
  loop
    badge_label := case earned
      when 'primer_reporte' then 'Primer reporte' when 'reportero' then 'Reportero comunitario'
      when 'problema_resuelto' then 'Problema resuelto' when 'barrio_mejor' then 'Mi barrio mejora'
      when 'solidario' then 'Vecino solidario' when 'voz_comunidad' then 'Voz de la comunidad'
      when 'manos_a_la_obra' then 'Manos a la obra' when 'voluntario_constante' then 'Voluntario constante'
      when 'organizador' then 'Organizador de jornadas' when 'solucionador' then 'Solucionador'
    end;
    perform public.notify_user(person, 'medalla', '¡Ganaste la medalla “' || badge_label || '”!', 'Gracias por mejorar tu comunidad.', '/perfil');
  end loop;
end;
$$;

create or replace function public.award_points(person uuid, act text, pts integer, ref uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if person is null or ref is null then
    return;
  end if;
  insert into public.point_events (user_id, action, points, ref_id) values (person, act, pts, ref)
  on conflict (user_id, action, ref_id) do nothing;
  if found then
    perform public.award_badges(person);
  end if;
end;
$$;

-- Quita puntos (person null = a cualquier usuario por esa acción y referencia).
create or replace function public.revoke_points(person uuid, act text, ref uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.point_events
  where action = act and ref_id = ref and (person is null or user_id = person);
$$;

-- Reportes: +10 al crear; se pierden si se rechaza (y vuelven si se restaura); +20 al autor
-- cuando se resuelve y +15 a la institución u ONG que lo resolvió.
create or replace function public.points_on_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    perform public.award_points(new.author_id, 'reporte', 10, new.id);
    return null;
  end if;
  if tg_op = 'DELETE' then
    delete from public.point_events where ref_id = old.id;
    return null;
  end if;
  if new.status = old.status then
    return null;
  end if;
  if new.status = 'rechazado' then
    perform public.revoke_points(new.author_id, 'reporte', new.id);
  elsif old.status = 'rechazado' then
    perform public.award_points(new.author_id, 'reporte', 10, new.id);
  end if;
  if new.status = 'resuelto' then
    perform public.award_points(new.author_id, 'reporte_resuelto', 20, new.id);
    if actor is not null and actor <> new.author_id
       and exists (select 1 from public.profiles p where p.id = actor and p.role in ('institution', 'organization')) then
      perform public.award_points(actor, 'solucion', 15, new.id);
    end if;
  elsif old.status = 'resuelto' then
    perform public.revoke_points(new.author_id, 'reporte_resuelto', new.id);
    perform public.revoke_points(null, 'solucion', new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists reports_points on public.reports;
create trigger reports_points
  after insert or delete or update of status on public.reports
  for each row execute function public.points_on_report();

-- Apoyos: +1 (se quita al retirar el apoyo).
create or replace function public.points_on_support()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.award_points(new.user_id, 'apoyo', 1, new.report_id);
  else
    perform public.revoke_points(old.user_id, 'apoyo', old.report_id);
  end if;
  return null;
end;
$$;

drop trigger if exists report_supports_points on public.report_supports;
create trigger report_supports_points
  after insert or delete on public.report_supports
  for each row execute function public.points_on_support();

-- Comentarios: +2, una sola vez por reporte (comentar mucho no da más puntos).
create or replace function public.points_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.award_points(new.author_id, 'comentario', 2, new.report_id);
  return null;
end;
$$;

drop trigger if exists report_comments_points on public.report_comments;
create trigger report_comments_points
  after insert on public.report_comments
  for each row execute function public.points_on_comment();

-- Sumarse como voluntario: +5 (se quita al retirarse).
create or replace function public.points_on_volunteer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.award_points(new.user_id, 'voluntariado', 5, new.report_id);
  else
    perform public.revoke_points(old.user_id, 'voluntariado', old.report_id);
  end if;
  return null;
end;
$$;

drop trigger if exists report_volunteers_points on public.report_volunteers;
create trigger report_volunteers_points
  after insert or delete on public.report_volunteers
  for each row execute function public.points_on_volunteer();

-- Asistencia confirmada a una jornada: +25 al voluntario y +15 a quien la organizó (una vez).
create or replace function public.points_on_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer uuid;
begin
  if old.checked_in_at is null and new.checked_in_at is not null then
    perform public.award_points(new.user_id, 'asistencia', 25, new.event_id);
    select e.organizer_id into organizer from public.community_events e where e.id = new.event_id;
    perform public.award_points(organizer, 'jornada_organizada', 15, new.event_id);
  elsif old.checked_in_at is not null and new.checked_in_at is null then
    perform public.revoke_points(new.user_id, 'asistencia', new.event_id);
  end if;
  return null;
end;
$$;

drop trigger if exists event_attendees_points on public.event_attendees;
create trigger event_attendees_points
  after update of checked_in_at on public.event_attendees
  for each row execute function public.points_on_attendance();

-- Puntos que ya existían antes de esta migración (reportes, apoyos, comentarios, voluntariado y asistencias).
insert into public.point_events (user_id, action, points, ref_id, created_at)
select r.author_id, 'reporte', 10, r.id, r.created_at from public.reports r where r.status <> 'rechazado'
on conflict do nothing;
insert into public.point_events (user_id, action, points, ref_id, created_at)
select r.author_id, 'reporte_resuelto', 20, r.id, r.updated_at from public.reports r where r.status = 'resuelto'
on conflict do nothing;
insert into public.point_events (user_id, action, points, ref_id, created_at)
select s.user_id, 'apoyo', 1, s.report_id, s.created_at from public.report_supports s
on conflict do nothing;
insert into public.point_events (user_id, action, points, ref_id, created_at)
select distinct on (c.author_id, c.report_id) c.author_id, 'comentario', 2, c.report_id, c.created_at
from public.report_comments c order by c.author_id, c.report_id, c.created_at
on conflict do nothing;
insert into public.point_events (user_id, action, points, ref_id, created_at)
select v.user_id, 'voluntariado', 5, v.report_id, v.created_at from public.report_volunteers v
on conflict do nothing;
insert into public.point_events (user_id, action, points, ref_id, created_at)
select a.user_id, 'asistencia', 25, a.event_id, a.checked_in_at from public.event_attendees a where a.checked_in_at is not null
on conflict do nothing;

-- Niveles según los puntos totales.
create or replace function public.level_info(total integer)
returns table (level integer, name text, floor_points integer, next_points integer)
language sql
immutable
set search_path = ''
as $$
  select l.level, l.name, l.floor_points, l.next_points
  from (values
    (1, 'Vecino', 0, 50),
    (2, 'Colaborador', 50, 150),
    (3, 'Activista', 150, 400),
    (4, 'Líder comunitario', 400, 1000),
    (5, 'Héroe del barrio', 1000, null::integer)
  ) as l (level, name, floor_points, next_points)
  where coalesce(total, 0) >= l.floor_points
  order by l.level desc
  limit 1;
$$;

-- Mi progreso: puntos, nivel, puntos del mes, acciones y medallas.
create or replace function public.my_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  total integer;
  month_points integer;
  info record;
begin
  if me is null then
    raise exception 'Inicia sesión para ver tu progreso.' using errcode = '42501';
  end if;
  select coalesce(sum(points), 0) into total from public.point_events where user_id = me;
  select coalesce(sum(points), 0) into month_points from public.point_events
  where user_id = me and created_at >= date_trunc('month', now());
  select * into info from public.level_info(total);
  return jsonb_build_object(
    'points', total,
    'month_points', month_points,
    'level', info.level,
    'level_name', info.name,
    'level_floor', info.floor_points,
    'next_level_points', info.next_points,
    'actions', coalesce((select jsonb_object_agg(action, n) from (select action, count(*) n from public.point_events where user_id = me group by action) a), '{}'::jsonb),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('badge', badge, 'earned_at', earned_at) order by earned_at) from public.user_badges where user_id = me), '[]'::jsonb)
  );
end;
$$;

-- =====================================================================
-- 4. Ranking comunitario (RF-38)
-- =====================================================================
create or replace function public.leaderboard(
  period text default 'mes',
  audience text default 'personas',
  only_province text default null,
  max_rows integer default 50
)
returns table (
  rank_position integer,
  name text,
  avatar_url text,
  role text,
  province text,
  points integer,
  level_name text,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  since timestamptz := case period
    when 'mes' then date_trunc('month', now())
    when 'anio' then date_trunc('year', now())
    else '-infinity'::timestamptz
  end;
begin
  if period not in ('mes', 'anio', 'todo') or audience not in ('personas', 'organizaciones') then
    raise exception 'Filtro de ranking no válido.' using errcode = '22023';
  end if;
  return query
  with totals as (
    select pe.user_id, sum(pe.points)::integer as total
    from public.point_events pe
    where pe.created_at >= since
    group by pe.user_id
  ),
  lifetime as (
    select pe.user_id, sum(pe.points)::integer as total from public.point_events pe group by pe.user_id
  )
  select
    (rank() over (order by t.total desc))::integer,
    coalesce(nullif(p.full_name, ''), 'Vecino'),
    p.avatar_url,
    p.role,
    p.province,
    t.total,
    (select li.name from public.level_info(l.total) li),
    p.id = (select auth.uid())
  from totals t
  join public.profiles p on p.id = t.user_id
  join lifetime l on l.user_id = t.user_id
  where p.show_in_ranking
    and p.role <> 'administrator'
    and (case when audience = 'personas' then p.role in ('citizen', 'volunteer') else p.role in ('organization', 'institution') end)
    and (only_province is null or p.province = only_province)
  order by t.total desc, p.full_name
  limit least(greatest(coalesce(max_rows, 50), 1), 100);
end;
$$;

-- =====================================================================
-- 5. Denuncias de contenido (RF-32)
-- =====================================================================
create table if not exists public.content_flags (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('report', 'comment', 'event')),
  target_id uuid not null,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('spam', 'ofensivo', 'falso', 'datos_personales', 'otro')),
  details text check (details is null or char_length(details) <= 500),
  status text not null default 'pendiente' check (status in ('pendiente', 'atendida', 'descartada')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (target_type, target_id, reporter_id)
);

create index if not exists content_flags_target_idx on public.content_flags (target_type, target_id, status);
create index if not exists content_flags_reporter_idx on public.content_flags (reporter_id, created_at);

alter table public.content_flags enable row level security;
revoke all on public.content_flags from anon, authenticated;

drop trigger if exists content_flags_language_filter on public.content_flags;
create trigger content_flags_language_filter
  before insert on public.content_flags
  for each row execute function public.reject_offensive_language('details');

-- Dueño del contenido denunciado (null si no existe).
create or replace function public.flag_target_owner(kind text, target uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case kind
    when 'report' then (select r.author_id from public.reports r where r.id = target)
    when 'comment' then (select c.author_id from public.report_comments c where c.id = target and c.deleted_at is null)
    when 'event' then (select e.organizer_id from public.community_events e where e.id = target)
  end;
$$;

-- Reporte relacionado (para enlazar desde la bandeja de moderación).
create or replace function public.flag_target_report(kind text, target uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case kind
    when 'report' then target
    when 'comment' then (select c.report_id from public.report_comments c where c.id = target)
  end;
$$;

create or replace function public.flag_content(kind text, target uuid, flag_reason text, flag_details text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  owner uuid;
  admin_id uuid;
  is_first boolean;
begin
  if me is null then
    raise exception 'Inicia sesión para denunciar contenido.' using errcode = '42501';
  end if;
  if kind not in ('report', 'comment', 'event') then
    raise exception 'Tipo de contenido no válido.' using errcode = '22023';
  end if;
  owner := public.flag_target_owner(kind, target);
  if owner is null then
    raise exception 'El contenido no existe o ya fue retirado.' using errcode = 'P0002';
  end if;
  if owner = me then
    raise exception 'No puedes denunciar tu propio contenido.' using errcode = '22023';
  end if;
  if exists (select 1 from public.content_flags f where f.target_type = kind and f.target_id = target and f.reporter_id = me) then
    raise exception 'Ya denunciaste este contenido. La moderación lo revisará.' using errcode = '22023';
  end if;
  if (select count(*) from public.content_flags f where f.reporter_id = me and f.created_at > now() - interval '1 day') >= 20 then
    raise exception 'Llegaste al límite de denuncias por hoy. Inténtalo mañana.' using errcode = '22023';
  end if;

  is_first := not exists (select 1 from public.content_flags f where f.target_type = kind and f.target_id = target and f.status = 'pendiente');
  insert into public.content_flags (target_type, target_id, reporter_id, reason, details)
  values (kind, target, me, flag_reason, nullif(trim(flag_details), ''));

  -- Aviso a los administradores solo con la primera denuncia pendiente (sin inundarlos).
  if is_first then
    for admin_id in select p.id from public.profiles p where p.role = 'administrator' loop
      perform public.notify_user(admin_id, 'denuncia', 'Nueva denuncia de contenido',
        case kind when 'report' then 'Un reporte' when 'comment' then 'Un comentario' else 'Una jornada' end || ' fue denunciado por: ' || flag_reason,
        '/admin/denuncias');
    end loop;
  end if;
end;
$$;

-- Bandeja de moderación: denuncias agrupadas por contenido.
create or replace function public.admin_flag_queue(only_status text default 'pendiente')
returns table (
  target_type text,
  target_id uuid,
  report_id uuid,
  flags integer,
  reasons text[],
  details text[],
  preview text,
  first_at timestamptz,
  last_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede revisar denuncias.' using errcode = '42501';
  end if;
  return query
  select
    f.target_type,
    f.target_id,
    public.flag_target_report(f.target_type, f.target_id),
    count(*)::integer,
    array_agg(distinct f.reason),
    array_remove(array_agg(f.details), null),
    case f.target_type
      when 'report' then (select r.title || ' — ' || left(r.description, 200) from public.reports r where r.id = f.target_id)
      when 'comment' then (select left(c.body, 240) from public.report_comments c where c.id = f.target_id)
      when 'event' then (select e.title from public.community_events e where e.id = f.target_id)
    end,
    min(f.created_at),
    max(f.created_at)
  from public.content_flags f
  where f.status = only_status
  group by f.target_type, f.target_id
  order by count(*) desc, max(f.created_at) desc
  limit 200;
end;
$$;

-- Resolver: "atender" retira el contenido (reporte → rechazado, comentario → eliminado,
-- jornada → cancelada) y avisa a su dueño; "descartar" lo deja como estaba.
create or replace function public.resolve_flags(kind text, target uuid, accept boolean, note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := public.flag_target_owner(kind, target);
  changed integer;
  clean_note text := nullif(trim(coalesce(note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede resolver denuncias.' using errcode = '42501';
  end if;
  if accept and clean_note is null then
    raise exception 'Escribe el motivo: se le mostrará a quien publicó el contenido.' using errcode = '22023';
  end if;

  update public.content_flags f
  set status = case when accept then 'atendida' else 'descartada' end,
      resolution_note = clean_note,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where f.target_type = kind and f.target_id = target and f.status = 'pendiente';
  get diagnostics changed = row_count;
  if changed = 0 then
    raise exception 'No hay denuncias pendientes para ese contenido.' using errcode = 'P0002';
  end if;

  if accept then
    if kind = 'report' then
      perform set_config('conectard.status_note', clean_note, true);
      update public.reports r set status = 'rechazado' where r.id = target and r.status <> 'rechazado';
    elsif kind = 'comment' then
      update public.report_comments c set deleted_at = now(), deleted_by = (select auth.uid())
      where c.id = target and c.deleted_at is null;
      perform public.notify_user(owner, 'moderacion', 'Retiramos uno de tus comentarios', clean_note,
        '/reporte/' || public.flag_target_report(kind, target));
    elsif kind = 'event' then
      update public.community_events e set status = 'cancelado' where e.id = target and e.status <> 'cancelado';
      perform public.notify_user(owner, 'moderacion', 'Cancelamos una de tus jornadas por moderación', clean_note, '/jornadas/' || target);
    end if;
  end if;
  return changed;
end;
$$;

-- Comentarios: con 3 denuncias pendientes de personas distintas se ocultan hasta que se revisen.
drop view if exists public.public_report_comments;
create view public.public_report_comments
with (security_barrier = true)
as
select
  c.id,
  c.report_id,
  c.parent_id,
  case when c.deleted_at is null and not hidden.flagged then c.body end as body,
  c.deleted_at is not null as is_deleted,
  hidden.flagged as is_hidden,
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
join public.profiles p on p.id = c.author_id
cross join lateral (
  select (
    select count(distinct f.reporter_id) from public.content_flags f
    where f.target_type = 'comment' and f.target_id = c.id and f.status = 'pendiente'
  ) >= 3 as flagged
) hidden;

revoke all on public.public_report_comments from anon, authenticated;
grant select on public.public_report_comments to anon, authenticated;

-- =====================================================================
-- 6. Resumen semanal por correo (RF-35)
-- =====================================================================
-- Datos de cada persona que aceptó el resumen. Solo la usa la función programada del servidor
-- (service_role), nunca la app: incluye correos.
create or replace function public.weekly_digest_rows()
returns table (
  user_id uuid,
  email text,
  full_name text,
  province text,
  new_reports integer,
  resolved_reports integer,
  my_updates integer,
  upcoming_events integer,
  points_week integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    u.email::text,
    p.full_name,
    p.province,
    (select count(*) from public.reports r where r.created_at >= now() - interval '7 days'
       and (p.province is null or r.province = p.province) and r.status <> 'rechazado')::integer,
    (select count(*) from public.report_status_history h join public.reports r on r.id = h.report_id
       where h.to_status = 'resuelto' and h.created_at >= now() - interval '7 days'
       and (p.province is null or r.province = p.province))::integer,
    (select count(*) from public.report_status_history h join public.reports r on r.id = h.report_id
       where r.author_id = p.id and h.from_status is not null and h.created_at >= now() - interval '7 days')::integer,
    (select count(*) from public.community_events e where e.status = 'programado'
       and e.starts_at between now() and now() + interval '14 days'
       and (p.province is null or e.province = p.province))::integer,
    (select coalesce(sum(pe.points), 0) from public.point_events pe
       where pe.user_id = p.id and pe.created_at >= now() - interval '7 days')::integer
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.weekly_digest and u.email is not null and u.email_confirmed_at is not null;
$$;

-- =====================================================================
-- 7. Permisos de ejecución (Supabase concede EXECUTE a anon y authenticated por separado)
-- =====================================================================
-- Internas: solo las usan los disparadores u otras funciones.
revoke execute on function public.normalize_for_filter(text) from public, anon, authenticated;
revoke execute on function public.reject_offensive_language() from public, anon, authenticated;
revoke execute on function public.notify_user(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.display_name_in_report(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.notify_report_status() from public, anon, authenticated;
revoke execute on function public.notify_new_comment() from public, anon, authenticated;
revoke execute on function public.notify_new_volunteer() from public, anon, authenticated;
revoke execute on function public.notify_event_linked() from public, anon, authenticated;
revoke execute on function public.notify_event_cancelled() from public, anon, authenticated;
revoke execute on function public.notify_verification_review() from public, anon, authenticated;
revoke execute on function public.notify_role_change() from public, anon, authenticated;
revoke execute on function public.award_badges(uuid) from public, anon, authenticated;
revoke execute on function public.award_points(uuid, text, integer, uuid) from public, anon, authenticated;
revoke execute on function public.revoke_points(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.points_on_report() from public, anon, authenticated;
revoke execute on function public.points_on_support() from public, anon, authenticated;
revoke execute on function public.points_on_comment() from public, anon, authenticated;
revoke execute on function public.points_on_volunteer() from public, anon, authenticated;
revoke execute on function public.points_on_attendance() from public, anon, authenticated;
revoke execute on function public.flag_target_owner(text, uuid) from public, anon, authenticated;
revoke execute on function public.flag_target_report(text, uuid) from public, anon, authenticated;
revoke execute on function public.weekly_digest_rows() from public, anon, authenticated;
grant execute on function public.weekly_digest_rows() to service_role;

-- Para la app.
revoke execute on function public.find_offensive_term(text) from public, anon;
grant execute on function public.find_offensive_term(text) to authenticated;
revoke execute on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;
revoke execute on function public.my_progress() from public, anon;
grant execute on function public.my_progress() to authenticated;
revoke execute on function public.flag_content(text, uuid, text, text) from public, anon;
grant execute on function public.flag_content(text, uuid, text, text) to authenticated;
revoke execute on function public.admin_flag_queue(text) from public, anon;
grant execute on function public.admin_flag_queue(text) to authenticated;
revoke execute on function public.resolve_flags(text, uuid, boolean, text) from public, anon;
grant execute on function public.resolve_flags(text, uuid, boolean, text) to authenticated;
-- El ranking y los niveles son públicos.
grant execute on function public.leaderboard(text, text, text, integer) to anon, authenticated;
grant execute on function public.level_info(integer) to anon, authenticated;
grant execute on function public.status_label(text) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 20261119000000_admin_console.sql
-- ----------------------------------------------------------------------------
-- Consola de administración avanzada.
--   RF-39: panel centralizado con moderación, BLOQUEO y gestión de usuarios.
--   RF-40: métricas de impacto (series diarias, estados, categorías, provincias, voluntarios activos).
--   RF-41: datos para exportar (la app genera el CSV).
--   RF-43: tiempo de respuesta (SLA) por institución.
--   RF-52: registro de auditoría inalterable de las acciones de administradores.
-- Ejecutar después de 20261118000000_engagement.sql.

-- =====================================================================
-- 1. Bloqueo de cuentas (RF-39)
-- =====================================================================
alter table public.profiles add column if not exists is_blocked boolean not null default false;
alter table public.profiles add column if not exists blocked_reason text;
alter table public.profiles add column if not exists blocked_at timestamptz;
alter table public.profiles add column if not exists blocked_by uuid references public.profiles (id) on delete set null;

alter table public.profiles drop constraint if exists profiles_blocked_reason_length;
alter table public.profiles add constraint profiles_blocked_reason_length
  check (blocked_reason is null or char_length(blocked_reason) <= 500);

-- ¿La persona que hace la operación está bloqueada?
create or replace function public.current_user_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_blocked from public.profiles p where p.id = (select auth.uid())), false);
$$;

-- Una cuenta bloqueada puede entrar a leer (si su sesión sigue activa), pero no escribe nada:
-- este disparador se pone en todas las tablas donde la gente publica o participa.
create or replace function public.reject_blocked_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_blocked() then
    raise exception 'Tu cuenta está bloqueada por la moderación de ConectaRD. Si crees que es un error, escríbenos.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'reports', 'report_media', 'report_comments', 'report_supports', 'report_volunteers', 'report_evidence',
    'community_events', 'event_reports', 'event_attendees', 'resource_requests', 'resource_donations',
    'resource_usages', 'content_flags', 'verification_requests', 'profiles'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_reject_blocked', t);
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.reject_blocked_writes()',
      t || '_reject_blocked', t
    );
  end loop;
end;
$$;

-- Bloquear o desbloquear (solo administradores; nunca a sí mismo ni a otro administrador).
-- Además de impedir publicar, intenta cerrar el acceso en Supabase Auth (banned_until).
create or replace function public.admin_set_user_block(target_user uuid, block boolean, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_reason text := nullif(trim(coalesce(reason, '')), '');
  target_role text;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede bloquear cuentas.' using errcode = '42501';
  end if;
  if target_user = (select auth.uid()) then
    raise exception 'No puedes bloquear tu propia cuenta.' using errcode = '22023';
  end if;
  select p.role into target_role from public.profiles p where p.id = target_user;
  if target_role is null then
    raise exception 'La cuenta no existe.' using errcode = 'P0002';
  end if;
  if block and target_role = 'administrator' then
    raise exception 'No puedes bloquear a otro administrador. Quítale el rol primero.' using errcode = '22023';
  end if;
  if block and clean_reason is null then
    raise exception 'Escribe el motivo del bloqueo: se le mostrará a la persona.' using errcode = '22023';
  end if;
  if clean_reason is not null and char_length(clean_reason) > 500 then
    raise exception 'El motivo no puede superar 500 caracteres.' using errcode = '22023';
  end if;

  update public.profiles p
  set is_blocked = block,
      blocked_reason = case when block then clean_reason end,
      blocked_at = case when block then now() end,
      blocked_by = case when block then (select auth.uid()) end
  where p.id = target_user;

  -- Cerrar (o reabrir) el inicio de sesión. Si el proyecto no lo permite, el bloqueo de escritura igual aplica.
  begin
    update auth.users set banned_until = case when block then 'infinity'::timestamptz end where id = target_user;
  exception when others then
    null;
  end;
end;
$$;

-- =====================================================================
-- 2. Registro de auditoría inalterable (RF-52)
-- =====================================================================
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  action text not null check (action in (
    'cambiar_rol', 'bloquear', 'desbloquear', 'revisar_verificacion', 'revisar_voluntario',
    'estado_reporte', 'eliminar_comentario', 'resolver_denuncias', 'cancelar_jornada'
  )),
  target_type text not null check (target_type in ('usuario', 'reporte', 'comentario', 'verificacion', 'jornada', 'denuncia')),
  target_id uuid,
  target_label text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_id);

-- Nadie (ni un administrador) puede insertar, editar ni borrar desde la app: solo los disparadores.
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;

create or replace function public.log_admin_action(act text, kind text, target uuid, label text, extra jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    return;
  end if;
  insert into public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, details)
  values (
    (select auth.uid()),
    (select nullif(p.full_name, '') from public.profiles p where p.id = (select auth.uid())),
    act, kind, target, left(label, 200), coalesce(extra, '{}'::jsonb)
  );
end;
$$;

-- Cambios en cuentas hechos por un administrador: rol, bloqueo y revisión de voluntariado.
create or replace function public.audit_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or new.id = (select auth.uid()) then
    return null;
  end if;
  if new.role <> old.role then
    perform public.log_admin_action('cambiar_rol', 'usuario', new.id, new.full_name,
      jsonb_build_object('de', old.role, 'a', new.role, 'nota', new.role_review_notes));
  elsif new.requested_role = 'volunteer' and old.verification_status = 'pending' and new.verification_status = 'rejected' then
    perform public.log_admin_action('revisar_voluntario', 'usuario', new.id, new.full_name,
      jsonb_build_object('resultado', 'rechazado', 'nota', new.role_review_notes));
  end if;
  if new.is_blocked <> old.is_blocked then
    perform public.log_admin_action(case when new.is_blocked then 'bloquear' else 'desbloquear' end, 'usuario', new.id, new.full_name,
      jsonb_build_object('motivo', new.blocked_reason));
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after update of role, verification_status, is_blocked on public.profiles
  for each row execute function public.audit_profile_changes();

create or replace function public.audit_verification_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> old.status then
    perform public.log_admin_action('revisar_verificacion', 'verificacion', new.id, new.organization_name,
      jsonb_build_object('resultado', new.status, 'rol', new.requested_role, 'nota', new.review_notes, 'usuario', new.user_id));
  end if;
  return null;
end;
$$;

drop trigger if exists verification_requests_audit on public.verification_requests;
create trigger verification_requests_audit
  after update of status on public.verification_requests
  for each row execute function public.audit_verification_review();

create or replace function public.audit_report_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.changed_by_role = 'administrator' and new.from_status is not null then
    perform public.log_admin_action('estado_reporte', 'reporte', new.report_id,
      (select r.title from public.reports r where r.id = new.report_id),
      jsonb_build_object('de', new.from_status, 'a', new.to_status, 'nota', new.note));
  end if;
  return null;
end;
$$;

drop trigger if exists report_status_history_audit on public.report_status_history;
create trigger report_status_history_audit
  after insert on public.report_status_history
  for each row execute function public.audit_report_status();

create or replace function public.audit_comment_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null and new.author_id <> (select auth.uid()) then
    perform public.log_admin_action('eliminar_comentario', 'comentario', new.id, left(new.body, 120),
      jsonb_build_object('reporte', new.report_id));
  end if;
  return null;
end;
$$;

drop trigger if exists report_comments_audit on public.report_comments;
create trigger report_comments_audit
  after update of deleted_at on public.report_comments
  for each row execute function public.audit_comment_removal();

create or replace function public.audit_event_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelado' and old.status <> 'cancelado' and new.organizer_id <> (select auth.uid()) then
    perform public.log_admin_action('cancelar_jornada', 'jornada', new.id, new.title, '{}'::jsonb);
  end if;
  return null;
end;
$$;

drop trigger if exists community_events_audit on public.community_events;
create trigger community_events_audit
  after update of status on public.community_events
  for each row execute function public.audit_event_cancel();

-- Resolución de denuncias: un registro por contenido (no uno por denuncia).
create or replace function public.resolve_flags(kind text, target uuid, accept boolean, note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := public.flag_target_owner(kind, target);
  changed integer;
  clean_note text := nullif(trim(coalesce(note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede resolver denuncias.' using errcode = '42501';
  end if;
  if accept and clean_note is null then
    raise exception 'Escribe el motivo: se le mostrará a quien publicó el contenido.' using errcode = '22023';
  end if;

  update public.content_flags f
  set status = case when accept then 'atendida' else 'descartada' end,
      resolution_note = clean_note,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where f.target_type = kind and f.target_id = target and f.status = 'pendiente';
  get diagnostics changed = row_count;
  if changed = 0 then
    raise exception 'No hay denuncias pendientes para ese contenido.' using errcode = 'P0002';
  end if;

  perform public.log_admin_action('resolver_denuncias', 'denuncia', target,
    case kind when 'report' then 'Reporte' when 'comment' then 'Comentario' else 'Jornada' end,
    jsonb_build_object('tipo', kind, 'resultado', case when accept then 'retirado' else 'descartado' end, 'denuncias', changed, 'nota', clean_note));

  if accept then
    if kind = 'report' then
      perform set_config('conectard.status_note', clean_note, true);
      update public.reports r set status = 'rechazado' where r.id = target and r.status <> 'rechazado';
    elsif kind = 'comment' then
      update public.report_comments c set deleted_at = now(), deleted_by = (select auth.uid())
      where c.id = target and c.deleted_at is null;
      perform public.notify_user(owner, 'moderacion', 'Retiramos uno de tus comentarios', clean_note,
        '/reporte/' || public.flag_target_report(kind, target));
    elsif kind = 'event' then
      update public.community_events e set status = 'cancelado' where e.id = target and e.status <> 'cancelado';
      perform public.notify_user(owner, 'moderacion', 'Cancelamos una de tus jornadas por moderación', clean_note, '/jornadas/' || target);
    end if;
  end if;
  return changed;
end;
$$;

create or replace function public.admin_audit_entries(only_action text default null, target uuid default null, max_rows integer default 100, skip integer default 0)
returns table (
  id bigint,
  actor_name text,
  action text,
  target_type text,
  target_id uuid,
  target_label text,
  details jsonb,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver la auditoría.' using errcode = '42501';
  end if;
  return query
  select a.id, coalesce(a.actor_name, 'Administrador'), a.action, a.target_type, a.target_id, a.target_label, a.details, a.created_at,
         count(*) over ()
  from public.admin_audit_log a
  where (only_action is null or a.action = only_action)
    and (target is null or a.target_id = target)
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(max_rows, 100), 1), 500)
  offset greatest(coalesce(skip, 0), 0);
end;
$$;

-- =====================================================================
-- 3. Usuarios: lista paginada con filtros y ficha (RF-39)
-- =====================================================================
create or replace function public.admin_users_page(
  search text default null,
  role_filter text default null,
  state_filter text default null,
  sort_by text default 'recientes',
  max_rows integer default 25,
  skip integer default 0
)
returns table (
  id uuid,
  full_name text,
  email text,
  avatar_url text,
  role text,
  requested_role text,
  verification_status text,
  province text,
  is_blocked boolean,
  reports_count integer,
  points integer,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  term text := nullif(trim(coalesce(search, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver las cuentas.' using errcode = '42501';
  end if;
  if state_filter is not null and state_filter not in ('activos', 'bloqueados', 'pendientes') then
    raise exception 'Filtro no válido.' using errcode = '22023';
  end if;
  return query
  with base as (
    select
      p.id, p.full_name, u.email::text as email, p.avatar_url, p.role, p.requested_role, p.verification_status,
      p.province, p.is_blocked,
      (select count(*) from public.reports r where r.author_id = p.id)::integer as reports_count,
      (select coalesce(sum(pe.points), 0) from public.point_events pe where pe.user_id = p.id)::integer as points,
      p.created_at, u.last_sign_in_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where (term is null or p.full_name ilike '%' || term || '%' or u.email ilike '%' || term || '%')
      and (role_filter is null or p.role = role_filter)
      and (state_filter is null
        or (state_filter = 'bloqueados' and p.is_blocked)
        or (state_filter = 'activos' and not p.is_blocked)
        or (state_filter = 'pendientes' and p.verification_status = 'pending'))
  )
  select b.*, count(*) over ()
  from base b
  order by
    case when sort_by = 'nombre' then lower(b.full_name) end asc,
    case when sort_by = 'puntos' then b.points end desc,
    case when sort_by = 'reportes' then b.reports_count end desc,
    case when sort_by = 'actividad' then b.last_sign_in_at end desc nulls last,
    b.created_at desc
  limit least(greatest(coalesce(max_rows, 25), 1), 200)
  offset greatest(coalesce(skip, 0), 0);
end;
$$;

create or replace function public.admin_user_detail(target_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver esta ficha.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'email', u.email,
    'avatar_url', p.avatar_url,
    'role', p.role,
    'requested_role', p.requested_role,
    'verification_status', p.verification_status,
    'province', p.province,
    'municipality', p.municipality,
    'sector', p.sector,
    'bio', p.bio,
    'is_blocked', p.is_blocked,
    'blocked_reason', p.blocked_reason,
    'blocked_at', p.blocked_at,
    'created_at', p.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'email_confirmed', u.email_confirmed_at is not null,
    'stats', jsonb_build_object(
      'reports', (select count(*) from public.reports r where r.author_id = p.id),
      'resolved', (select count(*) from public.reports r where r.author_id = p.id and r.status = 'resuelto'),
      'rejected', (select count(*) from public.reports r where r.author_id = p.id and r.status = 'rechazado'),
      'comments', (select count(*) from public.report_comments c where c.author_id = p.id and c.deleted_at is null),
      'supports', (select count(*) from public.report_supports s where s.user_id = p.id),
      'events_attended', (select count(*) from public.event_attendees a where a.user_id = p.id and a.checked_in_at is not null),
      'points', (select coalesce(sum(pe.points), 0) from public.point_events pe where pe.user_id = p.id),
      'flags_received', (
        select count(*) from public.content_flags f
        where (f.target_type = 'report' and f.target_id in (select r.id from public.reports r where r.author_id = p.id))
           or (f.target_type = 'comment' and f.target_id in (select c.id from public.report_comments c where c.author_id = p.id))
      ),
      'flags_made', (select count(*) from public.content_flags f where f.reporter_id = p.id)
    ),
    'recent_reports', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status, 'is_anonymous', r.is_anonymous, 'created_at', r.created_at) order by r.created_at desc)
      from (select * from public.reports r where r.author_id = p.id order by r.created_at desc limit 6) r
    ), '[]'::jsonb)
  ) into result
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = target_user;
  if result is null then
    raise exception 'La cuenta no existe.' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- =====================================================================
-- 4. Reportes para el administrador (incluye al autor real de los anónimos)
-- =====================================================================
create or replace function public.admin_reports_page(
  search text default null,
  status_filter text default null,
  category_filter text default null,
  province_filter text default null,
  flagged_only boolean default false,
  max_rows integer default 25,
  skip integer default 0
)
returns table (
  id uuid,
  title text,
  category text,
  status text,
  province text,
  municipality text,
  sector text,
  is_anonymous boolean,
  author_id uuid,
  author_name text,
  author_email text,
  support_count integer,
  comment_count integer,
  pending_flags integer,
  created_at timestamptz,
  status_updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  term text := nullif(trim(coalesce(search, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver esta lista.' using errcode = '42501';
  end if;
  return query
  with base as (
    select
      r.id, r.title, r.category, r.status, r.province, r.municipality, r.sector, r.is_anonymous,
      r.author_id, nullif(p.full_name, '') as author_name, u.email::text as author_email,
      (select count(*) from public.report_supports s where s.report_id = r.id)::integer as support_count,
      (select count(*) from public.report_comments c where c.report_id = r.id and c.deleted_at is null)::integer as comment_count,
      (select count(*) from public.content_flags f where f.target_type = 'report' and f.target_id = r.id and f.status = 'pendiente')::integer as pending_flags,
      r.created_at,
      coalesce((select max(h.created_at) from public.report_status_history h where h.report_id = r.id), r.created_at) as status_updated_at
    from public.reports r
    join public.profiles p on p.id = r.author_id
    join auth.users u on u.id = r.author_id
    where (term is null or r.title ilike '%' || term || '%' or r.description ilike '%' || term || '%'
           or r.sector ilike '%' || term || '%' or p.full_name ilike '%' || term || '%' or u.email ilike '%' || term || '%')
      and (status_filter is null or r.status = status_filter)
      and (category_filter is null or r.category = category_filter)
      and (province_filter is null or r.province = province_filter)
  )
  select b.*, count(*) over ()
  from base b
  where not flagged_only or b.pending_flags > 0
  order by b.pending_flags desc, b.created_at desc
  limit least(greatest(coalesce(max_rows, 25), 1), 5000)
  offset greatest(coalesce(skip, 0), 0);
end;
$$;

-- =====================================================================
-- 5. Resumen de la consola: métricas, series y tiempos de respuesta (RF-40, RF-43)
-- =====================================================================
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver el resumen.' using errcode = '42501';
  end if;

  with
  days as (
    select generate_series((now() at time zone 'America/Santo_Domingo')::date - 29, (now() at time zone 'America/Santo_Domingo')::date, interval '1 day')::date as d
  ),
  resolution as (
    select r.id, r.province,
      extract(epoch from ((select min(h.created_at) from public.report_status_history h where h.report_id = r.id and h.to_status = 'resuelto') - r.created_at)) / 3600 as hours
    from public.reports r where r.status = 'resuelto'
  ),
  institution_changes as (
    select h.changed_by, h.report_id, min(h.created_at) as first_at,
      min(h.created_at) filter (where h.to_status = 'resuelto') as resolved_at
    from public.report_status_history h
    where h.changed_by_role = 'institution' and h.changed_by is not null
    group by h.changed_by, h.report_id
  )
  select jsonb_build_object(
    'users', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'new_7d', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
      'new_30d', (select count(*) from public.profiles where created_at >= now() - interval '30 days'),
      'blocked', (select count(*) from public.profiles where is_blocked),
      'by_role', (select coalesce(jsonb_object_agg(role, n), '{}'::jsonb) from (select role, count(*) n from public.profiles group by role) x),
      'active_volunteers_30d', (
        select count(distinct x.user_id) from (
          select v.user_id from public.report_volunteers v where v.created_at >= now() - interval '30 days'
          union all
          select a.user_id from public.event_attendees a where a.checked_in_at >= now() - interval '30 days'
        ) x
      )
    ),
    'reports', jsonb_build_object(
      'total', (select count(*) from public.reports),
      'new_7d', (select count(*) from public.reports where created_at >= now() - interval '7 days'),
      'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.reports group by status) x),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'n', n) order by n desc), '[]'::jsonb) from (select category, count(*) n from public.reports group by category) x),
      'top_provinces', (select coalesce(jsonb_agg(jsonb_build_object('province', province, 'n', n, 'resolved', resolved) order by n desc), '[]'::jsonb)
        from (select coalesce(province, 'Sin provincia') province, count(*) n, count(*) filter (where status = 'resuelto') resolved
              from public.reports group by 1 order by 2 desc limit 8) x),
      'daily', (select jsonb_agg(jsonb_build_object(
          'day', days.d,
          'created', (select count(*) from public.reports r where (r.created_at at time zone 'America/Santo_Domingo')::date = days.d),
          'resolved', (select count(*) from public.report_status_history h where h.to_status = 'resuelto' and (h.created_at at time zone 'America/Santo_Domingo')::date = days.d)
        ) order by days.d) from days),
      'avg_resolution_hours', (select round(avg(hours)::numeric, 1) from resolution where hours is not null),
      'median_resolution_hours', (select round((percentile_cont(0.5) within group (order by hours))::numeric, 1) from resolution where hours is not null),
      'anonymous_share', (select round(100.0 * count(*) filter (where is_anonymous) / greatest(count(*), 1)) from public.reports)
    ),
    'queues', jsonb_build_object(
      'verifications', (select count(*) from public.verification_requests where status = 'pending'),
      'volunteers', (select count(*) from public.profiles where requested_role = 'volunteer' and verification_status = 'pending' and role = 'citizen'),
      'flags', (select count(distinct (target_type, target_id)) from public.content_flags where status = 'pendiente'),
      'stale_reports', (select count(*) from public.reports r where r.status = 'reportado' and r.created_at < now() - interval '7 days')
    ),
    'community', jsonb_build_object(
      'comments_7d', (select count(*) from public.report_comments where created_at >= now() - interval '7 days' and deleted_at is null),
      'supports_7d', (select count(*) from public.report_supports where created_at >= now() - interval '7 days'),
      'events_upcoming', (select count(*) from public.community_events where status = 'programado' and ends_at >= now()),
      'attendances_30d', (select count(*) from public.event_attendees where checked_in_at >= now() - interval '30 days')
    ),
    'sla', (select coalesce(jsonb_agg(row_to_json(x) order by x.reports desc), '[]'::jsonb) from (
      select
        coalesce(nullif(p.full_name, ''), 'Institución') as institution,
        p.province,
        count(*)::integer as reports,
        count(ic.resolved_at)::integer as resolved,
        round(avg(extract(epoch from (ic.first_at - r.created_at)) / 3600)::numeric, 1) as first_response_hours,
        round(avg(extract(epoch from (ic.resolved_at - r.created_at)) / 3600)::numeric, 1) as resolution_hours
      from institution_changes ic
      join public.reports r on r.id = ic.report_id
      join public.profiles p on p.id = ic.changed_by
      group by p.id, p.full_name, p.province
      order by count(*) desc
      limit 10
    ) x),
    'recent_audit', (select coalesce(jsonb_agg(row_to_json(a) order by a.created_at desc), '[]'::jsonb) from (
      select coalesce(actor_name, 'Administrador') actor_name, action, target_type, target_label, details, created_at
      from public.admin_audit_log order by created_at desc limit 8
    ) a)
  ) into result;
  return result;
end;
$$;

-- =====================================================================
-- 6. Permisos de ejecución
-- =====================================================================
revoke execute on function public.reject_blocked_writes() from public, anon, authenticated;
revoke execute on function public.log_admin_action(text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.audit_profile_changes() from public, anon, authenticated;
revoke execute on function public.audit_verification_review() from public, anon, authenticated;
revoke execute on function public.audit_report_status() from public, anon, authenticated;
revoke execute on function public.audit_comment_removal() from public, anon, authenticated;
revoke execute on function public.audit_event_cancel() from public, anon, authenticated;

revoke execute on function public.current_user_blocked() from public, anon;
grant execute on function public.current_user_blocked() to authenticated;
revoke execute on function public.resolve_flags(text, uuid, boolean, text) from public, anon;
grant execute on function public.resolve_flags(text, uuid, boolean, text) to authenticated;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_set_user_block(uuid, boolean, text)',
    'public.admin_audit_entries(text, uuid, integer, integer)',
    'public.admin_users_page(text, text, text, text, integer, integer)',
    'public.admin_user_detail(uuid)',
    'public.admin_reports_page(text, text, text, text, boolean, integer, integer)',
    'public.admin_dashboard()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;


-- ----------------------------------------------------------------------------
-- 20261120000000_assignment_ai.sql
-- ----------------------------------------------------------------------------
-- Módulo 6 · RF-42: cada reporte se asigna solo a la institución responsable según su ubicación y categoría.
-- Módulo 7 · RF-45: reportes repetidos cerca (aviso al crear, marca para la moderación y unión de duplicados).
--            RF-46: fotos repetidas de otros reportes o sin datos de cámara (posibles descargas de internet).
--            RF-44 y RF-47: límite diario de uso de la inteligencia artificial (clasificar fotos y asistente).
--
-- Reglas:
--   · Una institución atiende una provincia y, si se indica, un municipio y unas categorías.
--     Gana la más específica: municipio + categoría > municipio > provincia + categoría > provincia.
--     Si empatan, se reparte al que tiene menos reportes abiertos.
--   · Solo la institución asignada gestiona el reporte (cambia estados y sube evidencia).
--   · El administrador puede reasignar a mano o devolverlo a la asignación automática.
--   · Si cambia el alcance de una institución (o se bloquea), sus reportes abiertos se reasignan.
-- Ejecutar después de 20261119000000_admin_console.sql.

-- =====================================================================
-- 0. Ayudantes
-- =====================================================================
-- Clave de comparación de lugares: sin tildes, en minúsculas y sin espacios de más.
create or replace function public.place_key(value text)
returns text
language sql
stable
set search_path = ''
as $$
  select lower(trim(regexp_replace(extensions.unaccent(coalesce(value, '')), '\s+', ' ', 'g')));
$$;

-- Distancia en metros entre dos puntos (fórmula del haversine; no hace falta PostGIS).
create or replace function public.geo_distance_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  )));
$$;

-- Palabras con significado de un texto (sin tildes, sin palabras vacías, de 3 letras o más).
create or replace function public.text_tokens(value text)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct w), '{}'::text[])
  from regexp_split_to_table(lower(extensions.unaccent(coalesce(value, ''))), '[^a-z0-9]+') as w
  where char_length(w) >= 3
    and w not in (
      'que', 'los', 'las', 'del', 'una', 'uno', 'unos', 'unas', 'con', 'por', 'para', 'esta', 'este', 'esto',
      'estan', 'hay', 'muy', 'mas', 'pero', 'como', 'desde', 'hace', 'todo', 'toda', 'todos', 'todas', 'sin',
      'sobre', 'entre', 'cuando', 'donde', 'nos', 'les', 'sus', 'ese', 'esa', 'eso', 'son', 'fue', 'era',
      'tiene', 'tienen', 'ya', 'aqui', 'alli', 'ahi', 'mucho', 'mucha', 'tambien', 'favor', 'por', 'dias'
    );
$$;

-- Parecido entre dos reportes, de 0 a 1: lo que comparten sus títulos o, si no, todo el texto.
create or replace function public.report_text_similarity(title_a text, body_a text, title_b text, body_b text)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  ta text[] := public.text_tokens(title_a);
  tb text[] := public.text_tokens(title_b);
  fa text[] := public.text_tokens(concat_ws(' ', title_a, body_a));
  fb text[] := public.text_tokens(concat_ws(' ', title_b, body_b));
  shared_titles integer;
  shared_full integer;
  union_full integer;
  title_score numeric := 0;
  full_score numeric := 0;
begin
  if cardinality(ta) > 0 and cardinality(tb) > 0 then
    select count(*) into shared_titles from (select unnest(ta) intersect select unnest(tb)) x;
    title_score := shared_titles::numeric / least(cardinality(ta), cardinality(tb));
    -- Un título de una sola palabra compartida ("Basura") no basta para decir que es el mismo problema.
    if least(cardinality(ta), cardinality(tb)) < 2 then
      title_score := title_score * 0.5;
    end if;
  end if;
  if cardinality(fa) > 0 and cardinality(fb) > 0 then
    select count(*) into shared_full from (select unnest(fa) intersect select unnest(fb)) x;
    select count(*) into union_full from (select unnest(fa) union select unnest(fb)) x;
    full_score := shared_full::numeric / greatest(union_full, 1);
  end if;
  return round(greatest(title_score, full_score), 3);
end;
$$;

revoke execute on function public.place_key(text) from public, anon, authenticated;
revoke execute on function public.geo_distance_m(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.text_tokens(text) from public, anon, authenticated;
revoke execute on function public.report_text_similarity(text, text, text, text) from public, anon, authenticated;

-- =====================================================================
-- 1. Alcance de cada institución y asignación de reportes (RF-42)
-- =====================================================================
-- Categorías que atiende la institución (null = todas). Solo la cambia un administrador.
alter table public.profiles add column if not exists service_categories text[];
alter table public.profiles drop constraint if exists profiles_service_categories_valid;
alter table public.profiles add constraint profiles_service_categories_valid check (
  service_categories is null
  or (
    cardinality(service_categories) between 1 and 8
    and service_categories <@ array['basura', 'baches', 'alumbrado', 'agua', 'areas_verdes', 'seguridad', 'educacion', 'otros']::text[]
  )
);

alter table public.reports add column if not exists assigned_institution_id uuid references public.profiles (id) on delete set null;
alter table public.reports add column if not exists assignment_mode text not null default 'auto';
alter table public.reports add column if not exists assigned_at timestamptz;
alter table public.reports drop constraint if exists reports_assignment_mode_valid;
alter table public.reports add constraint reports_assignment_mode_valid check (assignment_mode in ('auto', 'manual'));

create index if not exists reports_assigned_institution_idx on public.reports (assigned_institution_id, status)
  where assigned_institution_id is not null;

-- Qué tan específica es una institución para un reporte (null si no lo cubre).
-- Municipio = 100, categorías = 50 + (8 - cuántas atiende): más especializada, más puntos.
create or replace function public.institution_rank(institution uuid, report_province text, report_municipality text, report_category text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select
    (case when public.place_key(p.municipality) <> '' then 100 else 0 end)
    + (case when p.service_categories is not null then 50 + 8 - cardinality(p.service_categories) else 0 end)
  from public.profiles p
  where p.id = institution
    and p.role = 'institution'
    and not p.is_blocked
    and public.place_key(p.province) <> ''
    and public.place_key(p.province) = public.place_key(report_province)
    and (public.place_key(p.municipality) = '' or public.place_key(p.municipality) = public.place_key(report_municipality))
    and (p.service_categories is null or report_category = any (p.service_categories));
$$;

-- Institución que corresponde a un lugar y una categoría: la más específica y, si empatan,
-- la que tiene menos reportes abiertos (null si ninguna lo cubre).
create or replace function public.pick_institution(report_province text, report_municipality text, report_category text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from (
    select p.id, p.created_at, public.institution_rank(p.id, report_province, report_municipality, report_category) as rank
    from public.profiles p
    where p.role = 'institution' and not p.is_blocked
  ) c
  where c.rank is not null
  order by
    c.rank desc,
    (
      select count(*) from public.reports r
      where r.assigned_institution_id = c.id and r.status in ('reportado', 'en_revision', 'en_proceso')
    ),
    c.created_at,
    c.id
  limit 1;
$$;

-- Al revisar una asignación existente: se conserva si la institución sigue cubriendo el reporte
-- y ninguna otra es más específica (así los reportes no saltan de una a otra sin motivo).
create or replace function public.resolve_institution(current_institution uuid, report_province text, report_municipality text, report_category text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  best uuid := public.pick_institution(report_province, report_municipality, report_category);
begin
  if current_institution is not null and best is not null
     and public.institution_rank(current_institution, report_province, report_municipality, report_category)
         >= public.institution_rank(best, report_province, report_municipality, report_category) then
    return current_institution;
  end if;
  return best;
end;
$$;

-- Al crear el reporte (o si el autor cambia su categoría) se elige la institución.
create or replace function public.assign_report_institution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.assigned_institution_id is null then
      new.assignment_mode := 'auto';
      new.assigned_institution_id := public.pick_institution(new.province, new.municipality, new.category);
    end if;
    new.assigned_at := case when new.assigned_institution_id is not null then now() end;
  elsif new.assignment_mode = 'auto'
        and (new.province is distinct from old.province
             or new.municipality is distinct from old.municipality
             or new.category is distinct from old.category) then
    new.assigned_institution_id := public.resolve_institution(old.assigned_institution_id, new.province, new.municipality, new.category);
  end if;
  if tg_op = 'UPDATE' and new.assigned_institution_id is distinct from old.assigned_institution_id then
    new.assigned_at := case when new.assigned_institution_id is not null then now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists reports_assign_institution on public.reports;
create trigger reports_assign_institution
  before insert or update of province, municipality, category, assigned_institution_id, assignment_mode on public.reports
  for each row execute function public.assign_report_institution();

-- Aviso a la institución cuando le llega un reporte (en las reasignaciones masivas se manda un resumen aparte).
create or replace function public.notify_report_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_institution_id is null
     or (tg_op = 'UPDATE' and new.assigned_institution_id is not distinct from old.assigned_institution_id)
     or coalesce(current_setting('conectard.bulk_assign', true), '') = 'on' then
    return null;
  end if;
  perform public.notify_user(
    new.assigned_institution_id, 'asignacion',
    'Nuevo reporte asignado: ' || left(new.title, 120),
    concat_ws(', ', nullif(new.sector, ''), nullif(new.municipality, ''), nullif(new.province, '')),
    '/reporte/' || new.id
  );
  return null;
end;
$$;

drop trigger if exists reports_notify_assignment on public.reports;
create trigger reports_notify_assignment
  after insert or update of assigned_institution_id on public.reports
  for each row execute function public.notify_report_assignment();

-- Vuelve a revisar la institución de los reportes abiertos automáticos de unas provincias.
-- Va uno por uno (del más antiguo al más nuevo) para que el reparto por carga vea cada cambio.
-- Devuelve cuántos cambiaron y manda un solo aviso por institución con lo que recibió.
create or replace function public.reassign_open_reports(provinces text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  keys text[];
  item record;
  chosen uuid;
  received jsonb := '{}'::jsonb;
  total integer := 0;
  institution_id text;
begin
  select coalesce(array_agg(distinct public.place_key(p)) filter (where public.place_key(p) <> ''), '{}'::text[])
    into keys from unnest(provinces) as p;
  if cardinality(keys) = 0 then
    return 0;
  end if;

  perform set_config('conectard.bulk_assign', 'on', true);
  for item in
    select r.id, r.province, r.municipality, r.category, r.assigned_institution_id
    from public.reports r
    where r.assignment_mode = 'auto'
      and r.status in ('reportado', 'en_revision', 'en_proceso')
      and public.place_key(r.province) = any (keys)
    order by r.created_at, r.id
  loop
    chosen := public.resolve_institution(item.assigned_institution_id, item.province, item.municipality, item.category);
    if chosen is distinct from item.assigned_institution_id then
      update public.reports set assigned_institution_id = chosen where id = item.id;
      total := total + 1;
      if chosen is not null then
        received := jsonb_set(received, array[chosen::text], to_jsonb(coalesce((received ->> chosen::text)::integer, 0) + 1));
      end if;
    end if;
  end loop;
  perform set_config('conectard.bulk_assign', 'off', true);

  for institution_id in select jsonb_object_keys(received) loop
    perform public.notify_user(
      institution_id::uuid, 'asignacion',
      case when (received ->> institution_id)::integer = 1 then 'Se te asignó 1 reporte'
           else 'Se te asignaron ' || (received ->> institution_id) || ' reportes' end,
      'La administración ajustó las zonas de atención. Revísalos en Gestión.',
      '/gestion'
    );
  end loop;
  return total;
end;
$$;

-- Si cambia el alcance de una institución (rol, provincia, municipio, categorías o bloqueo), se reasigna su zona.
create or replace function public.reassign_on_institution_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.role = 'institution' or new.role = 'institution')
     and (new.role is distinct from old.role
          or new.province is distinct from old.province
          or new.municipality is distinct from old.municipality
          or new.service_categories is distinct from old.service_categories
          or new.is_blocked is distinct from old.is_blocked) then
    perform public.reassign_open_reports(array[old.province, new.province]);
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_reassign_institution on public.profiles;
create trigger profiles_reassign_institution
  after update of role, province, municipality, service_categories, is_blocked on public.profiles
  for each row execute function public.reassign_on_institution_change();

-- Si se borra una institución, sus reportes abiertos pasan a otra (la FK los deja sin asignar).
create or replace function public.reassign_on_institution_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'institution' then
    perform public.reassign_open_reports(array[old.province]);
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_reassign_on_delete on public.profiles;
create trigger profiles_reassign_on_delete
  after delete on public.profiles
  for each row execute function public.reassign_on_institution_delete();

-- Solo la institución asignada gestiona el reporte (reemplaza la regla anterior por provincia).
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
      and r.assigned_institution_id = me.id
  );
$$;

-- Asignar a mano (o devolver a la asignación automática con institution = null). Solo administradores.
create or replace function public.admin_assign_report(target_report uuid, institution uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports;
  institution_name text;
  result uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede reasignar reportes.' using errcode = '42501';
  end if;
  select * into r from public.reports where id = target_report for update;
  if r.id is null then
    raise exception 'El reporte no existe.' using errcode = 'P0002';
  end if;

  if institution is null then
    update public.reports
    set assignment_mode = 'auto', assigned_institution_id = public.pick_institution(r.province, r.municipality, r.category)
    where id = target_report
    returning assigned_institution_id into result;
  else
    select nullif(p.full_name, '') into institution_name
    from public.profiles p where p.id = institution and p.role = 'institution' and not p.is_blocked;
    if not found then
      raise exception 'Elige una institución activa.' using errcode = '22023';
    end if;
    update public.reports
    set assignment_mode = 'manual', assigned_institution_id = institution
    where id = target_report
    returning assigned_institution_id into result;
  end if;

  perform public.log_admin_action('asignar_reporte', 'reporte', target_report, r.title, jsonb_build_object(
    'modo', case when institution is null then 'automática' else 'manual' end,
    'antes', (select nullif(p.full_name, '') from public.profiles p where p.id = r.assigned_institution_id),
    'ahora', (select nullif(p.full_name, '') from public.profiles p where p.id = result)
  ));
  return result;
end;
$$;

-- Fijar la zona y las categorías de una institución (la institución no puede cambiarlas sola).
create or replace function public.admin_set_institution_scope(target_user uuid, new_province text, new_municipality text, categories text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  clean_province text := nullif(trim(coalesce(new_province, '')), '');
  clean_municipality text := nullif(trim(coalesce(new_municipality, '')), '');
  clean_categories text[];
  before_count integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cambiar la zona de una institución.' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = target_user for update;
  if p.id is null or p.role <> 'institution' then
    raise exception 'Esa cuenta no es una institución.' using errcode = '22023';
  end if;
  if clean_province is null then
    raise exception 'Indica la provincia que atiende la institución.' using errcode = '22023';
  end if;
  if char_length(clean_province) > 60 or char_length(coalesce(clean_municipality, '')) > 80 then
    raise exception 'La provincia o el municipio son demasiado largos.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(categories, '{}'::text[])) as c
    where c not in ('basura', 'baches', 'alumbrado', 'agua', 'areas_verdes', 'seguridad', 'educacion', 'otros')
  ) then
    raise exception 'Hay una categoría que no existe.' using errcode = '22023';
  end if;
  select array_agg(distinct c order by c) into clean_categories
  from unnest(coalesce(categories, '{}'::text[])) as c;
  -- Todas las categorías marcadas equivale a "todas".
  if clean_categories is not null and cardinality(clean_categories) >= 8 then
    clean_categories := null;
  end if;

  select count(*) into before_count from public.reports r
  where r.assigned_institution_id = target_user and r.status in ('reportado', 'en_revision', 'en_proceso');

  update public.profiles
  set province = clean_province, municipality = clean_municipality, service_categories = clean_categories
  where id = target_user;

  perform public.log_admin_action('zona_institucion', 'usuario', target_user, p.full_name, jsonb_build_object(
    'provincia', clean_province,
    'municipio', coalesce(clean_municipality, 'Toda la provincia'),
    'categorias', coalesce(array_to_string(clean_categories, ', '), 'Todas')
  ));

  return (select count(*)::integer from public.reports r
          where r.assigned_institution_id = target_user and r.status in ('reportado', 'en_revision', 'en_proceso'));
end;
$$;

-- Lista de instituciones para la consola: zona, categorías y carga de trabajo.
create or replace function public.admin_institutions()
returns table (
  id uuid,
  full_name text,
  province text,
  municipality text,
  service_categories text[],
  is_blocked boolean,
  open_reports integer,
  resolved_reports integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver esta lista.' using errcode = '42501';
  end if;
  return query
  select p.id, nullif(p.full_name, ''), p.province, p.municipality, p.service_categories, p.is_blocked,
    (select count(*) from public.reports r where r.assigned_institution_id = p.id and r.status in ('reportado', 'en_revision', 'en_proceso'))::integer,
    (select count(*) from public.reports r where r.assigned_institution_id = p.id and r.status = 'resuelto')::integer
  from public.profiles p
  where p.role = 'institution'
  order by p.province nulls last, p.full_name;
end;
$$;

-- La auditoría acepta las acciones nuevas de la consola.
alter table public.admin_audit_log drop constraint if exists admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check check (action in (
  'cambiar_rol', 'bloquear', 'desbloquear', 'revisar_verificacion', 'revisar_voluntario',
  'estado_reporte', 'eliminar_comentario', 'resolver_denuncias', 'cancelar_jornada',
  'asignar_reporte', 'zona_institucion', 'unir_duplicado', 'descartar_duplicado'
));

-- Avisos de asignación: nuevo tipo de notificación.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'estado', 'comentario', 'respuesta', 'voluntario', 'jornada', 'jornada_cancelada',
  'verificacion', 'rol', 'medalla', 'denuncia', 'moderacion', 'asignacion'
));

-- =====================================================================
-- 2. Reportes repetidos (RF-45)
-- =====================================================================
alter table public.reports add column if not exists possible_duplicate_of uuid references public.reports (id) on delete set null;
alter table public.reports add column if not exists duplicate_review text;
alter table public.reports drop constraint if exists reports_duplicate_review_valid;
alter table public.reports add constraint reports_duplicate_review_valid check (duplicate_review is null or duplicate_review in ('descartado', 'unido'));
alter table public.reports drop constraint if exists reports_not_duplicate_of_itself;
alter table public.reports add constraint reports_not_duplicate_of_itself check (possible_duplicate_of is null or possible_duplicate_of <> id);

create index if not exists reports_category_geo_idx on public.reports (category, latitude, longitude);
create index if not exists reports_possible_duplicate_idx on public.reports (possible_duplicate_of) where possible_duplicate_of is not null;

-- Reportes abiertos de la misma categoría a menos de 150 m (últimos 90 días), del más parecido al menos.
create or replace function public.find_similar_reports(
  lat double precision,
  lon double precision,
  report_category text,
  report_title text,
  report_description text,
  exclude_report uuid default null,
  created_before timestamptz default null,
  max_rows integer default 5
)
returns table (id uuid, distance_m integer, similarity numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.distance_m, c.similarity
  from (
    select r.id,
      round(public.geo_distance_m(lat, lon, r.latitude, r.longitude))::integer as distance_m,
      public.report_text_similarity(report_title, report_description, r.title, r.description) as similarity,
      r.created_at
    from public.reports r
    where r.category = report_category
      and r.status in ('reportado', 'en_revision', 'en_proceso')
      and r.created_at > now() - interval '90 days'
      and (exclude_report is null or r.id <> exclude_report)
      and (created_before is null or r.created_at < created_before)
      -- Recorte rápido por coordenadas (unos 170 m) antes de calcular la distancia exacta.
      and r.latitude between lat - 0.0016 and lat + 0.0016
      and r.longitude between lon - 0.0017 and lon + 0.0017
  ) c
  where c.distance_m <= 150
  order by c.similarity desc, c.distance_m, c.created_at
  limit least(greatest(coalesce(max_rows, 5), 1), 10);
$$;

-- Lo que ve la persona al crear un reporte: "¿Es alguno de estos? Apóyalo en vez de repetirlo".
create or replace function public.nearby_similar_reports(
  lat double precision,
  lon double precision,
  report_category text,
  report_title text default null,
  report_description text default null
)
returns table (
  id uuid,
  title text,
  status text,
  category text,
  sector text,
  municipality text,
  distance_m integer,
  similarity numeric,
  support_count integer,
  cover_path text,
  supported_by_me boolean,
  is_mine boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null then
    raise exception 'Inicia sesión para continuar.' using errcode = '42501';
  end if;
  if lat is null or lon is null or report_category is null then
    return;
  end if;
  return query
  select r.id, r.title, r.status, r.category, r.sector, r.municipality, s.distance_m, s.similarity,
    (select count(*) from public.report_supports x where x.report_id = r.id)::integer,
    (select m.path from public.report_media m where m.report_id = r.id and m.kind = 'image' order by m.position, m.created_at limit 1),
    exists (select 1 from public.report_supports x where x.report_id = r.id and x.user_id = (select auth.uid())),
    r.author_id = (select auth.uid()),
    r.created_at
  from public.find_similar_reports(lat, lon, report_category, left(report_title, 120), left(report_description, 2000), null, null, 5) s
  join public.reports r on r.id = s.id
  order by s.similarity desc, s.distance_m;
end;
$$;

-- Marca para la moderación: al crear (o corregir) un reporte casi igual a otro abierto y cercano.
create or replace function public.mark_possible_duplicate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Si la moderación ya lo revisó, no se vuelve a marcar.
  if new.duplicate_review is not null then
    return new;
  end if;
  select s.id into new.possible_duplicate_of
  from public.find_similar_reports(
    new.latitude, new.longitude, new.category, new.title, new.description,
    new.id, case when tg_op = 'UPDATE' then new.created_at else null end, 10
  ) s
  where s.distance_m <= 30 or s.similarity >= 0.34
  order by s.similarity desc, s.distance_m
  limit 1;
  return new;
end;
$$;

drop trigger if exists reports_mark_possible_duplicate on public.reports;
create trigger reports_mark_possible_duplicate
  before insert or update of title, description, category, latitude, longitude on public.reports
  for each row execute function public.mark_possible_duplicate();

-- Un duplicado ya unido se atiende en el original: nadie lo reabre salvo un administrador,
-- y si lo restaura deja de contar como unido.
create or replace function public.guard_merged_duplicate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.duplicate_review = 'unido' and new.status is distinct from old.status and new.status <> 'rechazado' then
    if not public.is_admin() then
      raise exception 'Este reporte se unió a otro igual: se atiende en el reporte original.' using errcode = '42501';
    end if;
    new.duplicate_review := null;
    new.possible_duplicate_of := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reports_guard_merged_duplicate on public.reports;
create trigger reports_guard_merged_duplicate
  before update of status on public.reports
  for each row execute function public.guard_merged_duplicate();

-- La moderación decide: unir (el repetido se cierra y su apoyo pasa al original) o descartar la marca.
create or replace function public.admin_resolve_duplicate(target_report uuid, do_merge boolean, into_report uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dup public.reports;
  original public.reports;
  original_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede revisar duplicados.' using errcode = '42501';
  end if;
  select * into dup from public.reports where id = target_report for update;
  if dup.id is null then
    raise exception 'El reporte no existe.' using errcode = 'P0002';
  end if;

  if not coalesce(do_merge, false) then
    update public.reports set possible_duplicate_of = null, duplicate_review = 'descartado' where id = target_report;
    perform public.log_admin_action('descartar_duplicado', 'reporte', target_report, dup.title, '{}'::jsonb);
    return;
  end if;

  original_id := coalesce(into_report, dup.possible_duplicate_of);
  if original_id is null then
    raise exception 'Indica con qué reporte se une.' using errcode = '22023';
  end if;
  if original_id = target_report then
    raise exception 'Un reporte no se puede unir consigo mismo.' using errcode = '22023';
  end if;
  select * into original from public.reports where id = original_id for update;
  if original.id is null then
    raise exception 'El reporte original ya no existe.' using errcode = 'P0002';
  end if;
  if original.possible_duplicate_of = target_report and original.duplicate_review = 'unido' then
    raise exception 'El otro reporte ya se unió a este.' using errcode = '22023';
  end if;
  if dup.status in ('resuelto', 'rechazado') then
    raise exception 'Este reporte ya está cerrado.' using errcode = '22023';
  end if;
  if original.status in ('resuelto', 'rechazado') then
    raise exception 'El reporte original ya está cerrado; no se le pueden sumar apoyos.' using errcode = '22023';
  end if;

  -- Los apoyos y voluntarios del repetido pasan al original (sin duplicar a nadie ni al autor del original).
  with moved as (
    delete from public.report_supports s where s.report_id = target_report returning s.user_id
  )
  insert into public.report_supports (report_id, user_id)
  select original_id, m.user_id from moved m where m.user_id <> original.author_id
  on conflict do nothing;

  -- Quien hizo el repetido también apoya el original: así su voz cuenta.
  if dup.author_id <> original.author_id then
    insert into public.report_supports (report_id, user_id) values (original_id, dup.author_id) on conflict do nothing;
  end if;

  with moved as (
    delete from public.report_volunteers v where v.report_id = target_report returning v.user_id
  )
  insert into public.report_volunteers (report_id, user_id)
  select original_id, m.user_id from moved m where m.user_id <> original.author_id
  on conflict do nothing;

  update public.reports set possible_duplicate_of = original_id, duplicate_review = 'unido' where id = target_report;
  perform public.set_report_status(
    target_report, 'rechazado',
    'Ya existía un reporte igual: «' || left(original.title, 120) || '». Tu apoyo se sumó a ese reporte para darle más fuerza.'
  );
  perform public.log_admin_action('unir_duplicado', 'reporte', target_report, dup.title,
    jsonb_build_object('original', original.title, 'original_id', original_id));
end;
$$;

-- =====================================================================
-- 3. Fotos sospechosas (RF-46)
-- =====================================================================
-- Huella de la foto (dHash de 64 bits, en hexadecimal) y si traía datos de la cámara (EXIF).
-- Ambas se calculan en el teléfono antes de comprimir; la foto subida ya no lleva metadatos.
alter table public.report_media add column if not exists fingerprint text;
alter table public.report_media add column if not exists camera_data boolean;
alter table public.report_media drop constraint if exists report_media_fingerprint_valid;
alter table public.report_media add constraint report_media_fingerprint_valid check (fingerprint is null or fingerprint ~ '^[0-9a-f]{16}$');
grant insert (fingerprint, camera_data) on public.report_media to authenticated;

create table if not exists public.media_flags (
  id bigint generated always as identity primary key,
  media_id uuid not null references public.report_media (id) on delete cascade,
  report_id uuid not null references public.reports (id) on delete cascade,
  reason text not null check (reason in ('repetida', 'sin_camara')),
  matched_media_id uuid references public.report_media (id) on delete set null,
  matched_report_id uuid references public.reports (id) on delete set null,
  distance smallint check (distance is null or distance between 0 and 64),
  created_at timestamptz not null default now(),
  unique (media_id, reason)
);

create index if not exists media_flags_report_idx on public.media_flags (report_id);

alter table public.media_flags enable row level security;
revoke all on public.media_flags from anon, authenticated;
grant select on public.media_flags to authenticated;

drop policy if exists "Admins read media flags" on public.media_flags;
create policy "Admins read media flags"
  on public.media_flags for select to authenticated
  using ((select public.is_admin()));

-- Diferencia entre dos huellas: cuántos de los 64 bits cambian (0 = idénticas).
create or replace function public.fingerprint_distance(a text, b text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select bit_count(('x' || a)::bit(64) # ('x' || b)::bit(64))::integer;
$$;

-- Una huella casi toda en 0 o en 1 es una foto lisa (pared, cielo, negro): no sirve para comparar.
create or replace function public.fingerprint_is_informative(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value is not null and bit_count(('x' || value)::bit(64)) between 8 and 56;
$$;

create or replace function public.check_report_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid;
  match_id uuid;
  match_report uuid;
  match_distance integer;
begin
  if new.kind <> 'image' then
    return null;
  end if;
  select r.author_id into me from public.reports r where r.id = new.report_id;

  if public.fingerprint_is_informative(new.fingerprint) then
    select m.id, m.report_id, public.fingerprint_distance(m.fingerprint, new.fingerprint)
      into match_id, match_report, match_distance
    from public.report_media m
    join public.reports r on r.id = m.report_id
    where m.id <> new.id
      and m.kind = 'image'
      and public.fingerprint_is_informative(m.fingerprint)
      and r.author_id <> me
      and public.fingerprint_distance(m.fingerprint, new.fingerprint) <= 6
    order by public.fingerprint_distance(m.fingerprint, new.fingerprint), m.created_at
    limit 1;
    if match_id is not null then
      insert into public.media_flags (media_id, report_id, reason, matched_media_id, matched_report_id, distance)
      values (new.id, new.report_id, 'repetida', match_id, match_report, match_distance)
      on conflict (media_id, reason) do nothing;
    end if;
  end if;

  if new.camera_data = false then
    insert into public.media_flags (media_id, report_id, reason)
    values (new.id, new.report_id, 'sin_camara')
    on conflict (media_id, reason) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists report_media_check on public.report_media;
create trigger report_media_check
  after insert on public.report_media
  for each row execute function public.check_report_media();

-- =====================================================================
-- 4. Límite diario de la inteligencia artificial (RF-44, RF-47)
-- =====================================================================
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  feature text not null check (feature in ('foto', 'chat')),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_user_idx on public.ai_usage (user_id, feature, created_at desc);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- Lo llaman las funciones de IA con la sesión de la persona: registra un uso y devuelve cuántos le quedan hoy.
create or replace function public.consume_ai_quota(feature text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  daily_limit integer;
  used integer;
begin
  if me is null then
    raise exception 'Inicia sesión para usar el asistente.' using errcode = '42501';
  end if;
  if public.current_user_blocked() then
    raise exception 'Tu cuenta está bloqueada por la moderación de ConectaRD.' using errcode = '42501';
  end if;
  daily_limit := case feature when 'foto' then 30 when 'chat' then 40 else null end;
  if daily_limit is null then
    raise exception 'Función no válida.' using errcode = '22023';
  end if;
  -- Un candado por persona evita que dos pedidos simultáneos se salten el límite.
  perform pg_advisory_xact_lock(hashtextextended(me::text || ':' || feature, 0));
  select count(*) into used from public.ai_usage u
  where u.user_id = me and u.feature = consume_ai_quota.feature and u.created_at > now() - interval '24 hours';
  if used >= daily_limit then
    raise exception 'Llegaste al límite de hoy (% usos). Vuelve a intentarlo mañana.', daily_limit using errcode = 'P0001';
  end if;
  insert into public.ai_usage (user_id, feature) values (me, consume_ai_quota.feature);
  return daily_limit - used - 1;
end;
$$;

-- =====================================================================
-- 5. Vista pública: responsable del reporte y unión de duplicados
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
  lower(extensions.unaccent(concat_ws(' ', r.title, r.description, r.sector, r.municipality, r.address))) as search_key,
  -- RF-42: institución responsable (es una entidad pública: su nombre se muestra).
  nullif(i.full_name, '') as assigned_institution_name,
  coalesce(r.assigned_institution_id = (select auth.uid()), false) as assigned_to_me,
  -- RF-45: si la moderación lo unió a otro reporte, a cuál.
  case when r.duplicate_review = 'unido' then r.possible_duplicate_of end as merged_into
from public.reports r
join public.profiles p on p.id = r.author_id
left join public.profiles i on i.id = r.assigned_institution_id;

revoke all on public.public_reports from anon, authenticated;
grant select on public.public_reports to anon, authenticated;

-- =====================================================================
-- 6. Consola: lista de reportes con responsable, duplicados y fotos sospechosas
-- =====================================================================
drop function if exists public.admin_reports_page(text, text, text, text, boolean, integer, integer);
create or replace function public.admin_reports_page(
  search text default null,
  status_filter text default null,
  category_filter text default null,
  province_filter text default null,
  flagged_only boolean default false,
  max_rows integer default 25,
  skip integer default 0,
  assignment_filter text default null,
  duplicates_only boolean default false,
  suspicious_only boolean default false
)
returns table (
  id uuid,
  title text,
  category text,
  status text,
  province text,
  municipality text,
  sector text,
  is_anonymous boolean,
  author_id uuid,
  author_name text,
  author_email text,
  support_count integer,
  comment_count integer,
  pending_flags integer,
  created_at timestamptz,
  status_updated_at timestamptz,
  assigned_institution_id uuid,
  assigned_institution_name text,
  assignment_mode text,
  possible_duplicate_of uuid,
  duplicate_title text,
  duplicate_review text,
  suspicious_media integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  term text := nullif(trim(coalesce(search, '')), '');
  wanted_institution uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver esta lista.' using errcode = '42501';
  end if;
  -- assignment_filter: null (todos), 'sin_asignar' o el id de una institución.
  if assignment_filter is not null and assignment_filter <> 'sin_asignar' then
    begin
      wanted_institution := assignment_filter::uuid;
    exception when invalid_text_representation then
      raise exception 'Filtro de responsable no válido.' using errcode = '22023';
    end;
  end if;
  return query
  with base as (
    select
      r.id, r.title, r.category, r.status, r.province, r.municipality, r.sector, r.is_anonymous,
      r.author_id, nullif(p.full_name, '') as author_name, u.email::text as author_email,
      (select count(*) from public.report_supports s where s.report_id = r.id)::integer as support_count,
      (select count(*) from public.report_comments c where c.report_id = r.id and c.deleted_at is null)::integer as comment_count,
      (select count(*) from public.content_flags f where f.target_type = 'report' and f.target_id = r.id and f.status = 'pendiente')::integer as pending_flags,
      r.created_at,
      coalesce((select max(h.created_at) from public.report_status_history h where h.report_id = r.id), r.created_at) as status_updated_at,
      r.assigned_institution_id,
      nullif(i.full_name, '') as assigned_institution_name,
      r.assignment_mode,
      r.possible_duplicate_of,
      (select d.title from public.reports d where d.id = r.possible_duplicate_of) as duplicate_title,
      r.duplicate_review,
      (select count(distinct mf.media_id) from public.media_flags mf where mf.report_id = r.id)::integer as suspicious_media
    from public.reports r
    join public.profiles p on p.id = r.author_id
    join auth.users u on u.id = r.author_id
    left join public.profiles i on i.id = r.assigned_institution_id
    where (term is null or r.title ilike '%' || term || '%' or r.description ilike '%' || term || '%'
           or r.sector ilike '%' || term || '%' or p.full_name ilike '%' || term || '%' or u.email ilike '%' || term || '%')
      and (status_filter is null or r.status = status_filter)
      and (category_filter is null or r.category = category_filter)
      and (province_filter is null or r.province = province_filter)
      and (assignment_filter is null
           or (assignment_filter = 'sin_asignar' and r.assigned_institution_id is null)
           or r.assigned_institution_id = wanted_institution)
      and (not coalesce(duplicates_only, false) or (r.possible_duplicate_of is not null and r.duplicate_review is null))
  )
  select b.*, count(*) over ()
  from base b
  where (not coalesce(flagged_only, false) or b.pending_flags > 0)
    and (not coalesce(suspicious_only, false) or b.suspicious_media > 0)
  order by b.pending_flags desc, b.created_at desc
  limit least(greatest(coalesce(max_rows, 25), 1), 5000)
  offset greatest(coalesce(skip, 0), 0);
end;
$$;

-- =====================================================================
-- 6b. Resumen de la consola: colas de reportes sin asignar, duplicados y fotos sospechosas
-- =====================================================================
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver el resumen.' using errcode = '42501';
  end if;

  with
  days as (
    select generate_series((now() at time zone 'America/Santo_Domingo')::date - 29, (now() at time zone 'America/Santo_Domingo')::date, interval '1 day')::date as d
  ),
  resolution as (
    select r.id, r.province,
      extract(epoch from ((select min(h.created_at) from public.report_status_history h where h.report_id = r.id and h.to_status = 'resuelto') - r.created_at)) / 3600 as hours
    from public.reports r where r.status = 'resuelto'
  ),
  institution_changes as (
    select h.changed_by, h.report_id, min(h.created_at) as first_at,
      min(h.created_at) filter (where h.to_status = 'resuelto') as resolved_at
    from public.report_status_history h
    where h.changed_by_role = 'institution' and h.changed_by is not null
    group by h.changed_by, h.report_id
  )
  select jsonb_build_object(
    'users', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'new_7d', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
      'new_30d', (select count(*) from public.profiles where created_at >= now() - interval '30 days'),
      'blocked', (select count(*) from public.profiles where is_blocked),
      'by_role', (select coalesce(jsonb_object_agg(role, n), '{}'::jsonb) from (select role, count(*) n from public.profiles group by role) x),
      'active_volunteers_30d', (
        select count(distinct x.user_id) from (
          select v.user_id from public.report_volunteers v where v.created_at >= now() - interval '30 days'
          union all
          select a.user_id from public.event_attendees a where a.checked_in_at >= now() - interval '30 days'
        ) x
      )
    ),
    'reports', jsonb_build_object(
      'total', (select count(*) from public.reports),
      'new_7d', (select count(*) from public.reports where created_at >= now() - interval '7 days'),
      'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.reports group by status) x),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'n', n) order by n desc), '[]'::jsonb) from (select category, count(*) n from public.reports group by category) x),
      'top_provinces', (select coalesce(jsonb_agg(jsonb_build_object('province', province, 'n', n, 'resolved', resolved) order by n desc), '[]'::jsonb)
        from (select coalesce(province, 'Sin provincia') province, count(*) n, count(*) filter (where status = 'resuelto') resolved
              from public.reports group by 1 order by 2 desc limit 8) x),
      'daily', (select jsonb_agg(jsonb_build_object(
          'day', days.d,
          'created', (select count(*) from public.reports r where (r.created_at at time zone 'America/Santo_Domingo')::date = days.d),
          'resolved', (select count(*) from public.report_status_history h where h.to_status = 'resuelto' and (h.created_at at time zone 'America/Santo_Domingo')::date = days.d)
        ) order by days.d) from days),
      'avg_resolution_hours', (select round(avg(hours)::numeric, 1) from resolution where hours is not null),
      'median_resolution_hours', (select round((percentile_cont(0.5) within group (order by hours))::numeric, 1) from resolution where hours is not null),
      'anonymous_share', (select round(100.0 * count(*) filter (where is_anonymous) / greatest(count(*), 1)) from public.reports)
    ),
    'queues', jsonb_build_object(
      'verifications', (select count(*) from public.verification_requests where status = 'pending'),
      'volunteers', (select count(*) from public.profiles where requested_role = 'volunteer' and verification_status = 'pending' and role = 'citizen'),
      'flags', (select count(distinct (target_type, target_id)) from public.content_flags where status = 'pendiente'),
      'stale_reports', (select count(*) from public.reports r where r.status = 'reportado' and r.created_at < now() - interval '7 days'),
      'unassigned', (select count(*) from public.reports r where r.assigned_institution_id is null and r.status in ('reportado', 'en_revision', 'en_proceso')),
      'duplicates', (select count(*) from public.reports r where r.possible_duplicate_of is not null and r.duplicate_review is null and r.status in ('reportado', 'en_revision', 'en_proceso')),
      'suspicious_media', (select count(distinct mf.report_id) from public.media_flags mf join public.reports r on r.id = mf.report_id where r.status in ('reportado', 'en_revision', 'en_proceso'))
    ),
    'community', jsonb_build_object(
      'comments_7d', (select count(*) from public.report_comments where created_at >= now() - interval '7 days' and deleted_at is null),
      'supports_7d', (select count(*) from public.report_supports where created_at >= now() - interval '7 days'),
      'events_upcoming', (select count(*) from public.community_events where status = 'programado' and ends_at >= now()),
      'attendances_30d', (select count(*) from public.event_attendees where checked_in_at >= now() - interval '30 days')
    ),
    'sla', (select coalesce(jsonb_agg(row_to_json(x) order by x.reports desc), '[]'::jsonb) from (
      select
        coalesce(nullif(p.full_name, ''), 'Institución') as institution,
        p.province,
        count(*)::integer as reports,
        count(ic.resolved_at)::integer as resolved,
        round(avg(extract(epoch from (ic.first_at - r.created_at)) / 3600)::numeric, 1) as first_response_hours,
        round(avg(extract(epoch from (ic.resolved_at - r.created_at)) / 3600)::numeric, 1) as resolution_hours
      from institution_changes ic
      join public.reports r on r.id = ic.report_id
      join public.profiles p on p.id = ic.changed_by
      group by p.id, p.full_name, p.province
      order by count(*) desc
      limit 10
    ) x),
    'recent_audit', (select coalesce(jsonb_agg(row_to_json(a) order by a.created_at desc), '[]'::jsonb) from (
      select coalesce(actor_name, 'Administrador') actor_name, action, target_type, target_label, details, created_at
      from public.admin_audit_log order by created_at desc limit 8
    ) a)
  ) into result;
  return result;
end;
$$;

-- =====================================================================
-- 7. Reportes que ya existían: se asignan y se revisan una vez (sin avisos)
-- =====================================================================
do $$
begin
  perform set_config('conectard.bulk_assign', 'on', true);
  update public.reports r
  set assigned_institution_id = public.pick_institution(r.province, r.municipality, r.category)
  where r.assignment_mode = 'auto' and r.assigned_institution_id is null
    and public.pick_institution(r.province, r.municipality, r.category) is not null;
  perform set_config('conectard.bulk_assign', 'off', true);
end;
$$;

-- =====================================================================
-- 8. Permisos de ejecución
-- =====================================================================
revoke execute on function public.pick_institution(text, text, text) from public, anon, authenticated;
revoke execute on function public.institution_rank(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.resolve_institution(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.assign_report_institution() from public, anon, authenticated;
revoke execute on function public.notify_report_assignment() from public, anon, authenticated;
revoke execute on function public.reassign_open_reports(text[]) from public, anon, authenticated;
revoke execute on function public.reassign_on_institution_change() from public, anon, authenticated;
revoke execute on function public.reassign_on_institution_delete() from public, anon, authenticated;
revoke execute on function public.find_similar_reports(double precision, double precision, text, text, text, uuid, timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.mark_possible_duplicate() from public, anon, authenticated;
revoke execute on function public.guard_merged_duplicate() from public, anon, authenticated;
revoke execute on function public.check_report_media() from public, anon, authenticated;
revoke execute on function public.fingerprint_distance(text, text) from public, anon, authenticated;
revoke execute on function public.fingerprint_is_informative(text) from public, anon, authenticated;

revoke execute on function public.can_manage_report(uuid) from public, anon;
grant execute on function public.can_manage_report(uuid) to authenticated;
revoke execute on function public.nearby_similar_reports(double precision, double precision, text, text, text) from public, anon;
grant execute on function public.nearby_similar_reports(double precision, double precision, text, text, text) to authenticated;
revoke execute on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_assign_report(uuid, uuid)',
    'public.admin_set_institution_scope(uuid, text, text, text[])',
    'public.admin_institutions()',
    'public.admin_resolve_duplicate(uuid, boolean, uuid)',
    'public.admin_reports_page(text, text, text, text, boolean, integer, integer, text, boolean, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
