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
