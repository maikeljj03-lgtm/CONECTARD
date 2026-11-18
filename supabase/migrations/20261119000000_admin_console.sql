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
