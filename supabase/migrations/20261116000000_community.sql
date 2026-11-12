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
