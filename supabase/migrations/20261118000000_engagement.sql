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
