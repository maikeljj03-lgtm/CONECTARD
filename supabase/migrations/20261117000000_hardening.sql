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
