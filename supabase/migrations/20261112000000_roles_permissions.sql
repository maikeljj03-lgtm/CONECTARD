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
