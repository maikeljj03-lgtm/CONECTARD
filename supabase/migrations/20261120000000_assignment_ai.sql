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
