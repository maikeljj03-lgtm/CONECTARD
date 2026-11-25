-- Módulo 8: plataforma, seguridad y extras.
--   RF-51  Cifrado de datos sensibles (teléfonos de contacto y ubicaciones de las alertas) con una clave en Vault.
--   RF-53  Doble factor (2FA) opcional: si una cuenta de administración o de institución lo activa,
--          sus permisos especiales solo valen con la sesión verificada con el segundo factor (aal2).
--   RF-57  Estadísticas públicas para la API abierta (public_stats).
--   RF-58  Sensores IoT que crean reportes solos cuando una medición pasa su límite.
--   RF-59  Zonas catastrales (GeoJSON oficial importado por la administración): terreno público, privado o protegido.
--   RF-61  Alertas por radio de distancia: aviso cuando aparece un reporte cerca de un lugar elegido.
--   RF-62  Constancias de voluntariado verificables con un código.
--   RF-63  Encuesta de satisfacción al resolverse un reporte.
-- Ejecutar después de 20261120000000_assignment_ai.sql.

create extension if not exists pgcrypto with schema extensions;

-- =====================================================================
-- 1. RF-51: clave de cifrado en Vault y funciones para cifrar y descifrar
-- =====================================================================
do $$
begin
  begin
    create extension if not exists supabase_vault with schema vault;
  exception when others then
    null; -- En Supabase ya viene activado; en otros Postgres se usa el esquema vault existente.
  end;
  if exists (select 1 from pg_namespace where nspname = 'vault')
     and not exists (select 1 from vault.secrets where name = 'conectard_data_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'conectard_data_key',
      'Clave de ConectaRD para cifrar teléfonos y ubicaciones de alertas (RF-51). No la borres: sin ella esos datos no se pueden leer.'
    );
  end if;
end;
$$;

create or replace function public.data_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  key text;
begin
  select s.decrypted_secret into key from vault.decrypted_secrets s where s.name = 'conectard_data_key' limit 1;
  if key is null or char_length(key) < 32 then
    raise exception 'Falta la clave de cifrado de ConectaRD en Vault.' using errcode = '55000';
  end if;
  return key;
end;
$$;

create or replace function public.encrypt_value(value text)
returns bytea
language sql
volatile
security definer
set search_path = ''
as $$
  select case when value is null then null else extensions.pgp_sym_encrypt(value, public.data_key(), 'cipher-algo=aes256') end;
$$;

create or replace function public.decrypt_value(value bytea)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when value is null then null else extensions.pgp_sym_decrypt(value, public.data_key()) end;
$$;

-- Teléfono de contacto de las verificaciones: se guarda cifrado y en la tabla solo queda una máscara.
alter table public.verification_requests add column if not exists contact_phone_enc bytea;
alter table public.verification_requests drop constraint if exists verification_requests_contact_phone_check;
alter table public.verification_requests drop constraint if exists verification_requests_contact_phone_format;
alter table public.verification_requests add constraint verification_requests_contact_phone_format
  check (contact_phone ~ '^[0-9+() -]{7,20}$' or contact_phone ~ '^•+[0-9]{2,4}$');

create or replace function public.protect_contact_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  digits text;
begin
  if new.contact_phone is null or new.contact_phone ~ '^•+[0-9]{2,4}$' then
    -- Ya está protegido (o es la misma máscara): no se toca.
    if tg_op = 'UPDATE' then
      new.contact_phone_enc := old.contact_phone_enc;
    end if;
    return new;
  end if;
  if new.contact_phone !~ '^[0-9+() -]{7,20}$' then
    raise exception 'Escribe un teléfono válido.' using errcode = '23514';
  end if;
  digits := regexp_replace(new.contact_phone, '[^0-9]', '', 'g');
  new.contact_phone_enc := public.encrypt_value(trim(new.contact_phone));
  new.contact_phone := '••••••' || right(digits, 4);
  return new;
end;
$$;

drop trigger if exists verification_requests_protect_phone on public.verification_requests;
create trigger verification_requests_protect_phone
  before insert or update of contact_phone on public.verification_requests
  for each row execute function public.protect_contact_phone();

-- Las solicitudes que ya existían se cifran una vez.
update public.verification_requests set contact_phone = contact_phone where contact_phone_enc is null;

-- La auditoría acepta las acciones nuevas (incluido ver un dato cifrado).
alter table public.admin_audit_log drop constraint if exists admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check check (action in (
  'cambiar_rol', 'bloquear', 'desbloquear', 'revisar_verificacion', 'revisar_voluntario',
  'estado_reporte', 'eliminar_comentario', 'resolver_denuncias', 'cancelar_jornada',
  'asignar_reporte', 'zona_institucion', 'unir_duplicado', 'descartar_duplicado',
  'ver_telefono', 'registrar_sensor', 'cambiar_sensor', 'importar_catastro'
));
alter table public.admin_audit_log drop constraint if exists admin_audit_log_target_type_check;
alter table public.admin_audit_log add constraint admin_audit_log_target_type_check check (target_type in (
  'usuario', 'reporte', 'comentario', 'verificacion', 'jornada', 'denuncia', 'sensor', 'catastro'
));

-- Solo un administrador ve el teléfono completo, y queda registrado que lo vio.
create or replace function public.admin_contact_phone(request_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.verification_requests;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver el teléfono.' using errcode = '42501';
  end if;
  select * into r from public.verification_requests where id = request_id;
  if r.id is null then
    raise exception 'La solicitud no existe.' using errcode = 'P0002';
  end if;
  perform public.log_admin_action('ver_telefono', 'verificacion', r.id, r.organization_name, '{}'::jsonb);
  return coalesce(public.decrypt_value(r.contact_phone_enc), r.contact_phone);
end;
$$;

-- =====================================================================
-- 2. RF-53: doble factor (2FA) para cuentas con permisos especiales
-- =====================================================================
-- true si la cuenta no activó el doble factor, o si la sesión actual ya lo verificó (aal2).
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    );
$$;

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
  ) and public.mfa_satisfied();
$$;

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
  ) and public.mfa_satisfied();
$$;

-- =====================================================================
-- 3. Reportes: origen (ciudadano o sensor) y tipo de terreno
-- =====================================================================
alter table public.reports add column if not exists source text not null default 'ciudadano';
alter table public.reports drop constraint if exists reports_source_valid;
alter table public.reports add constraint reports_source_valid check (source in ('ciudadano', 'sensor'));
alter table public.reports add column if not exists land_status text not null default 'desconocido';
alter table public.reports drop constraint if exists reports_land_status_valid;
alter table public.reports add constraint reports_land_status_valid check (land_status in ('publico', 'privado', 'protegido', 'desconocido'));

-- =====================================================================
-- 4. RF-59: zonas catastrales
-- =====================================================================
create table if not exists public.cadastral_zones (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 160),
  kind text not null check (kind in ('publico', 'privado', 'protegido')),
  source text not null check (char_length(source) between 2 and 160),
  geometry jsonb not null,
  min_lat double precision not null,
  max_lat double precision not null,
  min_lon double precision not null,
  max_lon double precision not null,
  created_at timestamptz not null default now()
);

create index if not exists cadastral_zones_bbox_idx on public.cadastral_zones (min_lat, max_lat, min_lon, max_lon);

alter table public.cadastral_zones enable row level security;
revoke all on public.cadastral_zones from anon, authenticated;
grant select (id, name, kind, source, created_at) on public.cadastral_zones to authenticated;

drop policy if exists "Admins read cadastral zones" on public.cadastral_zones;
create policy "Admins read cadastral zones"
  on public.cadastral_zones for select to authenticated
  using ((select public.is_admin()));

-- ¿El punto está dentro de un anillo? (GeoJSON usa [longitud, latitud]; método del rayo).
create or replace function public.point_in_ring(lat double precision, lon double precision, ring jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer := jsonb_array_length(ring);
  i integer;
  j integer;
  xi double precision;
  yi double precision;
  xj double precision;
  yj double precision;
  inside boolean := false;
begin
  if n < 4 then
    return false;
  end if;
  j := n - 1;
  for i in 0 .. n - 1 loop
    xi := (ring -> i ->> 0)::double precision;
    yi := (ring -> i ->> 1)::double precision;
    xj := (ring -> j ->> 0)::double precision;
    yj := (ring -> j ->> 1)::double precision;
    if ((yi > lat) <> (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) then
      inside := not inside;
    end if;
    j := i;
  end loop;
  return inside;
end;
$$;

-- ¿El punto está dentro de un Polygon o MultiPolygon? (dentro del borde exterior y fuera de los huecos)
create or replace function public.point_in_geometry(lat double precision, lon double precision, geometry jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  polygons jsonb;
  polygon jsonb;
  hole integer;
  in_hole boolean;
begin
  polygons := case geometry ->> 'type'
    when 'Polygon' then jsonb_build_array(geometry -> 'coordinates')
    when 'MultiPolygon' then geometry -> 'coordinates'
    else '[]'::jsonb
  end;
  for polygon in select value from jsonb_array_elements(polygons) loop
    if public.point_in_ring(lat, lon, polygon -> 0) then
      in_hole := false;
      for hole in 1 .. jsonb_array_length(polygon) - 1 loop
        if public.point_in_ring(lat, lon, polygon -> hole) then
          in_hole := true;
          exit;
        end if;
      end loop;
      if not in_hole then
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$$;

-- Todos los puntos [lon, lat] de las coordenadas de un Polygon o MultiPolygon.
create or replace function public.geojson_points(coordinates jsonb)
returns setof jsonb
language sql
immutable
set search_path = ''
as $$
  with recursive walk(node) as (
    select coordinates
    union all
    select element
    from walk, jsonb_array_elements(walk.node) as element
    where jsonb_typeof(walk.node) = 'array' and jsonb_typeof(walk.node -> 0) = 'array'
  )
  select node from walk
  where jsonb_typeof(node) = 'array' and jsonb_array_length(node) >= 2
    and jsonb_typeof(node -> 0) = 'number' and jsonb_typeof(node -> 1) = 'number';
$$;

-- Tipo de terreno en un punto: la zona más pequeña que lo contiene (la más precisa) o "desconocido".
create or replace function public.land_status_at(lat double precision, lon double precision)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select z.kind from public.cadastral_zones z
    where lat between z.min_lat and z.max_lat
      and lon between z.min_lon and z.max_lon
      and public.point_in_geometry(lat, lon, z.geometry)
    order by (z.max_lat - z.min_lat) * (z.max_lon - z.min_lon), z.id
    limit 1
  ), 'desconocido');
$$;

create or replace function public.set_report_land_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.land_status := public.land_status_at(new.latitude, new.longitude);
  return new;
end;
$$;

drop trigger if exists reports_land_status on public.reports;
create trigger reports_land_status
  before insert or update of latitude, longitude on public.reports
  for each row execute function public.set_report_land_status();

-- Importa un FeatureCollection de GeoJSON (Polygon o MultiPolygon). Cada zona necesita en sus
-- propiedades un tipo ("tipo" o "kind": público, privado o protegido) y, si tiene, un nombre.
create or replace function public.admin_import_cadastral_zones(collection jsonb, source_name text, replace_existing boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  feature jsonb;
  geometry jsonb;
  raw_kind text;
  zone_kind text;
  zone_name text;
  coords record;
  imported integer := 0;
  skipped integer := 0;
  updated_reports integer;
  clean_source text := nullif(trim(coalesce(source_name, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede importar zonas catastrales.' using errcode = '42501';
  end if;
  if clean_source is null or char_length(clean_source) > 160 then
    raise exception 'Indica de dónde salen los datos (por ejemplo, "Catastro Nacional, 2026").' using errcode = '22023';
  end if;
  if collection ->> 'type' is distinct from 'FeatureCollection' or jsonb_typeof(collection -> 'features') <> 'array' then
    raise exception 'El archivo debe ser un FeatureCollection de GeoJSON.' using errcode = '22023';
  end if;
  if jsonb_array_length(collection -> 'features') = 0 or jsonb_array_length(collection -> 'features') > 5000 then
    raise exception 'El archivo debe tener entre 1 y 5000 zonas.' using errcode = '22023';
  end if;

  if coalesce(replace_existing, false) then
    -- "where true": Supabase rechaza DELETE sin WHERE desde la API (safeupdate).
    delete from public.cadastral_zones where true;
  end if;

  for feature in select value from jsonb_array_elements(collection -> 'features') loop
    geometry := feature -> 'geometry';
    raw_kind := lower(extensions.unaccent(coalesce(feature -> 'properties' ->> 'tipo', feature -> 'properties' ->> 'kind', '')));
    zone_kind := case
      when raw_kind in ('publico', 'public', 'dominio publico', 'estatal') then 'publico'
      when raw_kind in ('privado', 'private', 'particular') then 'privado'
      when raw_kind in ('protegido', 'protected', 'area protegida', 'reserva') then 'protegido'
    end;
    if zone_kind is null or geometry ->> 'type' not in ('Polygon', 'MultiPolygon')
       or jsonb_typeof(geometry -> 'coordinates') <> 'array'
       or length(geometry::text) > 400000 then
      skipped := skipped + 1;
      continue;
    end if;

    -- Caja que encierra la zona (para buscar rápido) y control de que esté en República Dominicana.
    begin
      select min((p ->> 1)::double precision) min_lat, max((p ->> 1)::double precision) max_lat,
             min((p ->> 0)::double precision) min_lon, max((p ->> 0)::double precision) max_lon,
             count(*) points
        into coords
      from public.geojson_points(geometry -> 'coordinates') as p;
    exception when others then
      skipped := skipped + 1;
      continue;
    end;
    if coords.points < 4 or coords.min_lat < 17 or coords.max_lat > 20.5 or coords.min_lon < -72.5 or coords.max_lon > -68 then
      skipped := skipped + 1;
      continue;
    end if;

    zone_name := left(coalesce(nullif(trim(feature -> 'properties' ->> 'nombre'), ''), nullif(trim(feature -> 'properties' ->> 'name'), ''), 'Zona sin nombre'), 160);
    insert into public.cadastral_zones (name, kind, source, geometry, min_lat, max_lat, min_lon, max_lon)
    values (zone_name, zone_kind, clean_source, geometry, coords.min_lat, coords.max_lat, coords.min_lon, coords.max_lon);
    imported := imported + 1;
  end loop;

  -- Se recalcula el tipo de terreno de todos los reportes.
  with fresh as (
    select r.id, public.land_status_at(r.latitude, r.longitude) as status from public.reports r
  ), changed as (
    update public.reports r set land_status = fresh.status
    from fresh where r.id = fresh.id and r.land_status is distinct from fresh.status
    returning 1
  )
  select count(*) into updated_reports from changed;

  perform public.log_admin_action('importar_catastro', 'catastro', null, clean_source,
    jsonb_build_object('zonas', imported, 'omitidas', skipped, 'reemplazo', coalesce(replace_existing, false)));
  return jsonb_build_object('imported', imported, 'skipped', skipped, 'reports_updated', updated_reports,
    'total', (select count(*) from public.cadastral_zones));
end;
$$;

-- Resumen de las zonas cargadas para la consola.
create or replace function public.admin_cadastral_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver el catastro.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'zones', (select count(*) from public.cadastral_zones),
    'by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from public.cadastral_zones group by kind) x),
    'sources', (select coalesce(jsonb_agg(distinct source), '[]'::jsonb) from public.cadastral_zones),
    'reports_by_land', (select coalesce(jsonb_object_agg(land_status, n), '{}'::jsonb) from (select land_status, count(*) n from public.reports group by land_status) x)
  );
end;
$$;

-- =====================================================================
-- 5. RF-58: sensores IoT
-- =====================================================================
create table if not exists public.iot_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 80),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('basura', 'baches', 'alumbrado', 'agua', 'areas_verdes', 'seguridad', 'educacion', 'otros')),
  metric text not null check (char_length(metric) between 2 and 60),
  unit text not null check (char_length(unit) between 1 and 20),
  threshold numeric not null,
  direction text not null check (direction in ('mayor', 'menor')),
  latitude double precision not null check (latitude between 17.3 and 20.2),
  longitude double precision not null check (longitude between -72.1 and -68.2),
  province text check (province is null or char_length(province) <= 60),
  municipality text check (municipality is null or char_length(municipality) <= 80),
  sector text check (sector is null or char_length(sector) <= 80),
  token_hash text not null unique,
  active boolean not null default true,
  last_value numeric,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.iot_readings (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.iot_devices (id) on delete cascade,
  value numeric not null,
  over_limit boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists iot_readings_device_idx on public.iot_readings (device_id, created_at desc);

alter table public.reports add column if not exists sensor_device_id uuid references public.iot_devices (id) on delete set null;

alter table public.iot_devices enable row level security;
alter table public.iot_readings enable row level security;
revoke all on public.iot_devices from anon, authenticated;
revoke all on public.iot_readings from anon, authenticated;

-- Registra un sensor. Devuelve la clave del sensor UNA sola vez (en la base solo queda su huella SHA-256).
create or replace function public.admin_register_iot_device(
  device_name text,
  owner uuid,
  report_category text,
  metric_name text,
  unit_name text,
  limit_value numeric,
  limit_direction text,
  lat double precision,
  lon double precision,
  device_province text default null,
  device_municipality text default null,
  device_sector text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text := 'crd_iot_' || encode(extensions.gen_random_bytes(24), 'hex');
  new_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede registrar sensores.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = owner and p.role in ('institution', 'administrator') and not p.is_blocked) then
    raise exception 'El sensor debe pertenecer a una institución activa.' using errcode = '22023';
  end if;
  insert into public.iot_devices (name, owner_id, category, metric, unit, threshold, direction, latitude, longitude, province, municipality, sector, token_hash)
  values (trim(device_name), owner, report_category, trim(metric_name), trim(unit_name), limit_value, limit_direction, lat, lon,
    nullif(trim(coalesce(device_province, '')), ''), nullif(trim(coalesce(device_municipality, '')), ''), nullif(trim(coalesce(device_sector, '')), ''),
    encode(extensions.digest(token, 'sha256'), 'hex'))
  returning id into new_id;
  perform public.log_admin_action('registrar_sensor', 'sensor', new_id, trim(device_name), jsonb_build_object('metrica', metric_name, 'limite', limit_value));
  return jsonb_build_object('id', new_id, 'token', token);
end;
$$;

create or replace function public.admin_set_iot_device_active(device uuid, is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.iot_devices;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cambiar sensores.' using errcode = '42501';
  end if;
  update public.iot_devices set active = coalesce(is_active, false) where id = device returning * into d;
  if d.id is null then
    raise exception 'El sensor no existe.' using errcode = 'P0002';
  end if;
  perform public.log_admin_action('cambiar_sensor', 'sensor', d.id, d.name, jsonb_build_object('activo', d.active));
end;
$$;

create or replace function public.admin_iot_devices()
returns table (
  id uuid, name text, owner_name text, category text, metric text, unit text, threshold numeric, direction text,
  latitude double precision, longitude double precision, sector text, municipality text, province text,
  active boolean, last_value numeric, last_seen_at timestamptz, readings_24h integer, open_report_id uuid, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver los sensores.' using errcode = '42501';
  end if;
  return query
  select d.id, d.name, nullif(p.full_name, ''), d.category, d.metric, d.unit, d.threshold, d.direction,
    d.latitude, d.longitude, d.sector, d.municipality, d.province, d.active, d.last_value, d.last_seen_at,
    (select count(*) from public.iot_readings x where x.device_id = d.id and x.created_at > now() - interval '24 hours')::integer,
    (select r.id from public.reports r where r.sensor_device_id = d.id and r.status in ('reportado', 'en_revision', 'en_proceso') order by r.created_at desc limit 1),
    d.created_at
  from public.iot_devices d
  join public.profiles p on p.id = d.owner_id
  order by d.created_at desc;
end;
$$;

-- Número legible: 3, 3.5 o 3.46 (sin ceros ni punto sobrantes).
create or replace function public.format_number(value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when value = trunc(value) then trunc(value)::text else rtrim(round(value, 2)::text, '0') end;
$$;

-- Lo llama el sensor (sin sesión) con su clave. Guarda la medición y, si pasa el límite y no hay
-- un reporte abierto de ese sensor, crea uno (se asigna solo a la institución de la zona).
create or replace function public.iot_submit_reading(device_token text, reading numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.iot_devices;
  over boolean;
  open_report uuid;
  new_report uuid;
begin
  if device_token is null or device_token !~ '^crd_iot_[0-9a-f]{48}$' then
    raise exception 'Clave de sensor no válida.' using errcode = '28000';
  end if;
  select * into d from public.iot_devices
  where token_hash = encode(extensions.digest(device_token, 'sha256'), 'hex')
  for update;
  if d.id is null or not d.active then
    raise exception 'Clave de sensor no válida o sensor desactivado.' using errcode = '28000';
  end if;
  if reading is null or abs(reading) >= 1000000000 then
    raise exception 'Medición no válida.' using errcode = '22023';
  end if;
  if d.last_seen_at is not null and d.last_seen_at > now() - interval '10 seconds' then
    raise exception 'Demasiadas mediciones seguidas: espera al menos 10 segundos.' using errcode = 'P0001';
  end if;

  over := case d.direction when 'mayor' then reading > d.threshold else reading < d.threshold end;
  insert into public.iot_readings (device_id, value, over_limit) values (d.id, reading, over);
  update public.iot_devices set last_value = reading, last_seen_at = now() where id = d.id;

  if not over then
    return jsonb_build_object('accepted', true, 'alert', false);
  end if;

  select r.id into open_report from public.reports r
  where r.sensor_device_id = d.id and r.status in ('reportado', 'en_revision', 'en_proceso')
  order by r.created_at desc limit 1;
  if open_report is not null then
    return jsonb_build_object('accepted', true, 'alert', true, 'report_id', open_report, 'new_report', false);
  end if;

  insert into public.reports (author_id, title, description, category, latitude, longitude, province, municipality, sector, source, sensor_device_id)
  values (
    d.owner_id,
    left('Sensor «' || d.name || '»: ' || d.metric || ' fuera del límite', 120),
    'El sensor «' || d.name || '» midió ' || public.format_number(reading) || ' ' || d.unit
      || ' (límite: ' || case d.direction when 'mayor' then 'hasta ' else 'desde ' end
      || public.format_number(d.threshold) || ' ' || d.unit || '). Reporte creado automáticamente por un sensor urbano.',
    d.category, d.latitude, d.longitude, d.province, d.municipality, d.sector, 'sensor', d.id
  )
  returning id into new_report;
  -- Un reporte de sensor no da puntos a la institución dueña (el ranking es de personas que participan).
  perform public.revoke_points(d.owner_id, 'reporte', new_report);
  return jsonb_build_object('accepted', true, 'alert', true, 'report_id', new_report, 'new_report', true);
end;
$$;

-- =====================================================================
-- 6. RF-61: alertas por radio de distancia (ubicación guardada cifrada)
-- =====================================================================
create table if not exists public.alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  latitude_enc bytea not null,
  longitude_enc bytea not null,
  -- Celda aproximada (unos 11 km) en claro, solo para buscar rápido sin descifrar todas.
  cell_lat numeric(4, 1) not null,
  cell_lon numeric(4, 1) not null,
  radius_m integer not null check (radius_m in (500, 1000, 2000, 5000, 10000)),
  categories text[] check (categories is null or (cardinality(categories) between 1 and 8
    and categories <@ array['basura', 'baches', 'alumbrado', 'agua', 'areas_verdes', 'seguridad', 'educacion', 'otros']::text[])),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists alert_subscriptions_cell_idx on public.alert_subscriptions (cell_lat, cell_lon) where active;
create index if not exists alert_subscriptions_user_idx on public.alert_subscriptions (user_id);

alter table public.alert_subscriptions enable row level security;
revoke all on public.alert_subscriptions from anon, authenticated;

create or replace function public.my_alert_subscriptions()
returns table (id uuid, label text, latitude double precision, longitude double precision, radius_m integer, categories text[], active boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.label, public.decrypt_value(a.latitude_enc)::double precision, public.decrypt_value(a.longitude_enc)::double precision,
    a.radius_m, a.categories, a.active, a.created_at
  from public.alert_subscriptions a
  where a.user_id = (select auth.uid())
  order by a.created_at;
$$;

create or replace function public.save_alert_subscription(
  subscription_id uuid,
  alert_label text,
  lat double precision,
  lon double precision,
  radius integer,
  alert_categories text[],
  is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  clean_label text := nullif(trim(coalesce(alert_label, '')), '');
  clean_categories text[];
  result uuid;
begin
  if me is null then
    raise exception 'Inicia sesión para crear alertas.' using errcode = '42501';
  end if;
  if public.current_user_blocked() then
    raise exception 'Tu cuenta está bloqueada por la moderación de ConectaRD.' using errcode = '42501';
  end if;
  if clean_label is null or char_length(clean_label) > 60 then
    raise exception 'Ponle un nombre corto a la alerta (por ejemplo, "Mi casa").' using errcode = '22023';
  end if;
  if lat is null or lon is null or lat not between 17.3 and 20.2 or lon not between -72.1 and -68.2 then
    raise exception 'Elige un punto dentro de República Dominicana.' using errcode = '22023';
  end if;
  if radius is null or radius not in (500, 1000, 2000, 5000, 10000) then
    raise exception 'Radio no válido.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(alert_categories, '{}'::text[])) c
             where c not in ('basura', 'baches', 'alumbrado', 'agua', 'areas_verdes', 'seguridad', 'educacion', 'otros')) then
    raise exception 'Hay una categoría que no existe.' using errcode = '22023';
  end if;
  select array_agg(distinct c order by c) into clean_categories from unnest(coalesce(alert_categories, '{}'::text[])) c;
  if clean_categories is not null and cardinality(clean_categories) >= 8 then
    clean_categories := null;
  end if;

  if subscription_id is null then
    if (select count(*) from public.alert_subscriptions a where a.user_id = me) >= 5 then
      raise exception 'Puedes tener hasta 5 alertas.' using errcode = 'P0001';
    end if;
    insert into public.alert_subscriptions (user_id, label, latitude_enc, longitude_enc, cell_lat, cell_lon, radius_m, categories, active)
    values (me, clean_label, public.encrypt_value(lat::text), public.encrypt_value(lon::text), round(lat::numeric, 1), round(lon::numeric, 1),
      radius, clean_categories, coalesce(is_active, true))
    returning id into result;
  else
    update public.alert_subscriptions a
    set label = clean_label, latitude_enc = public.encrypt_value(lat::text), longitude_enc = public.encrypt_value(lon::text),
      cell_lat = round(lat::numeric, 1), cell_lon = round(lon::numeric, 1), radius_m = radius,
      categories = clean_categories, active = coalesce(is_active, true)
    where a.id = subscription_id and a.user_id = me
    returning a.id into result;
    if result is null then
      raise exception 'La alerta no existe.' using errcode = 'P0002';
    end if;
  end if;
  return result;
end;
$$;

create or replace function public.delete_alert_subscription(subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.alert_subscriptions a where a.id = subscription_id and a.user_id = (select auth.uid());
  if not found then
    raise exception 'La alerta no existe.' using errcode = 'P0002';
  end if;
end;
$$;

-- Aviso a quien tenga una alerta que cubra el lugar del reporte nuevo (una sola vez por persona).
create or replace function public.notify_nearby_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  distance double precision;
  notified uuid[] := '{}';
  report_cell_lat numeric := round(new.latitude::numeric, 1);
  report_cell_lon numeric := round(new.longitude::numeric, 1);
begin
  for s in
    select a.* from public.alert_subscriptions a
    join public.profiles p on p.id = a.user_id
    where a.active
      and a.user_id <> new.author_id
      and not p.is_blocked
      and a.cell_lat between report_cell_lat - 0.2 and report_cell_lat + 0.2
      and a.cell_lon between report_cell_lon - 0.2 and report_cell_lon + 0.2
      and (a.categories is null or new.category = any (a.categories))
    order by a.radius_m
  loop
    continue when s.user_id = any (notified);
    distance := public.geo_distance_m(
      public.decrypt_value(s.latitude_enc)::double precision, public.decrypt_value(s.longitude_enc)::double precision,
      new.latitude, new.longitude
    );
    if distance <= s.radius_m then
      notified := notified || s.user_id;
      perform public.notify_user(
        s.user_id, 'alerta',
        'Nuevo reporte cerca de «' || s.label || '»',
        left(new.title, 120) || ' · a ' || case when distance < 1000 then round(distance)::text || ' m' else round((distance / 1000)::numeric, 1)::text || ' km' end,
        '/reporte/' || new.id
      );
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists reports_notify_nearby_alerts on public.reports;
create trigger reports_notify_nearby_alerts
  after insert on public.reports
  for each row execute function public.notify_nearby_alerts();

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'estado', 'comentario', 'respuesta', 'voluntario', 'jornada', 'jornada_cancelada',
  'verificacion', 'rol', 'medalla', 'denuncia', 'moderacion', 'asignacion', 'alerta'
));

-- =====================================================================
-- 7. RF-62: constancias de voluntariado
-- =====================================================================
create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^CRD-[0-9A-F]{5}-[0-9A-F]{5}$'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  full_name text not null,
  hours numeric(7, 1) not null check (hours >= 0),
  events integer not null check (events >= 0),
  reports_helped integer not null check (reports_helped >= 0),
  first_activity date,
  last_activity date,
  issued_at timestamptz not null default now()
);

create index if not exists certificates_user_idx on public.certificates (user_id, issued_at desc);

alter table public.certificates enable row level security;
revoke all on public.certificates from anon, authenticated;
grant select on public.certificates to authenticated;

drop policy if exists "Users read their certificates" on public.certificates;
create policy "Users read their certificates"
  on public.certificates for select to authenticated
  using (user_id = (select auth.uid()));

-- Emite una constancia con las horas de las jornadas a las que asistió (confirmadas por QR)
-- y los reportes a los que se sumó. Cada jornada cuenta como máximo 12 horas.
create or replace function public.issue_volunteer_certificate()
returns public.certificates
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  person text;
  total_hours numeric;
  total_events integer;
  total_reports integer;
  first_day date;
  last_day date;
  new_code text;
  result public.certificates;
begin
  if me is null then
    raise exception 'Inicia sesión para pedir tu constancia.' using errcode = '42501';
  end if;
  if public.current_user_blocked() then
    raise exception 'Tu cuenta está bloqueada por la moderación de ConectaRD.' using errcode = '42501';
  end if;
  select nullif(trim(p.full_name), '') into person from public.profiles p where p.id = me;
  if person is null then
    raise exception 'Completa tu nombre en el perfil: aparece en la constancia.' using errcode = '22023';
  end if;

  select
    coalesce(sum(least(greatest(extract(epoch from (e.ends_at - e.starts_at)) / 3600, 0), 12)), 0),
    count(*),
    min((e.starts_at at time zone 'America/Santo_Domingo')::date),
    max((e.starts_at at time zone 'America/Santo_Domingo')::date)
  into total_hours, total_events, first_day, last_day
  from public.event_attendees a
  join public.community_events e on e.id = a.event_id
  where a.user_id = me and a.checked_in_at is not null and e.status <> 'cancelado';

  select count(*) into total_reports from public.report_volunteers v where v.user_id = me;
  if total_events = 0 and total_reports = 0 then
    raise exception 'Todavía no tienes actividad de voluntariado: asiste a una jornada o súmate a un reporte.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.certificates c where c.user_id = me and c.issued_at > now() - interval '24 hours') >= 5 then
    raise exception 'Ya emitiste varias constancias hoy. Vuelve a intentarlo mañana.' using errcode = 'P0001';
  end if;

  loop
    new_code := 'CRD-' || upper(substr(encode(extensions.gen_random_bytes(5), 'hex'), 1, 5)) || '-' || upper(substr(encode(extensions.gen_random_bytes(5), 'hex'), 1, 5));
    exit when not exists (select 1 from public.certificates c where c.code = new_code);
  end loop;

  insert into public.certificates (code, user_id, full_name, hours, events, reports_helped, first_activity, last_activity)
  values (new_code, me, person, round(total_hours, 1), total_events, total_reports, first_day, last_day)
  returning * into result;
  return result;
end;
$$;

-- Cualquiera puede comprobar una constancia con su código (por ejemplo, la escuela que la recibe).
create or replace function public.verify_certificate(certificate_code text)
returns table (code text, full_name text, hours numeric, events integer, reports_helped integer, first_activity date, last_activity date, issued_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code, c.full_name, c.hours, c.events, c.reports_helped, c.first_activity, c.last_activity, c.issued_at
  from public.certificates c
  where c.code = upper(trim(certificate_code));
$$;

-- El filtro de lenguaje ofensivo (módulo 5) también reconoce los plurales ("mierdas", "pendejos").
create or replace function public.find_offensive_term(input text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.term
  from public.blocked_terms t
  where public.normalize_for_filter(input) ~ ('(^|[^a-zñ])' || t.term || '(e?s)?($|[^a-zñ])')
  limit 1;
$$;

-- =====================================================================
-- 8. RF-63: encuesta de satisfacción al resolverse un reporte
-- =====================================================================
create table if not exists public.report_surveys (
  report_id uuid primary key references public.reports (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  solved boolean not null,
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now()
);

alter table public.report_surveys enable row level security;
revoke all on public.report_surveys from anon, authenticated;
grant select on public.report_surveys to authenticated;

drop policy if exists "Authors and admins read surveys" on public.report_surveys;
create policy "Authors and admins read surveys"
  on public.report_surveys for select to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

drop trigger if exists report_surveys_language_filter on public.report_surveys;
create trigger report_surveys_language_filter
  before insert or update of comment on public.report_surveys
  for each row execute function public.reject_offensive_language('comment');

drop trigger if exists report_surveys_reject_blocked on public.report_surveys;
create trigger report_surveys_reject_blocked
  before insert or update or delete on public.report_surveys
  for each row execute function public.reject_blocked_writes();

create or replace function public.submit_report_survey(target_report uuid, survey_rating integer, was_solved boolean, survey_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports;
  clean_comment text := nullif(trim(coalesce(survey_comment, '')), '');
begin
  select * into r from public.reports where id = target_report;
  if r.id is null then
    raise exception 'El reporte no existe.' using errcode = 'P0002';
  end if;
  if r.author_id is distinct from (select auth.uid()) then
    raise exception 'Solo quien hizo el reporte puede calificar la solución.' using errcode = '42501';
  end if;
  if r.status <> 'resuelto' then
    raise exception 'La encuesta se responde cuando el reporte está resuelto.' using errcode = '22023';
  end if;
  if survey_rating is null or survey_rating not between 1 and 5 or was_solved is null then
    raise exception 'Elige de 1 a 5 estrellas y si de verdad quedó resuelto.' using errcode = '22023';
  end if;
  if clean_comment is not null and char_length(clean_comment) > 500 then
    raise exception 'El comentario puede tener hasta 500 caracteres.' using errcode = '22023';
  end if;
  insert into public.report_surveys (report_id, author_id, rating, solved, comment)
  values (r.id, r.author_id, survey_rating, was_solved, clean_comment)
  on conflict (report_id) do update
    set rating = excluded.rating, solved = excluded.solved, comment = excluded.comment, created_at = now()
    where public.report_surveys.created_at > now() - interval '7 days';
  if not found then
    raise exception 'La encuesta ya no se puede cambiar (pasaron 7 días).' using errcode = '22023';
  end if;
end;
$$;

-- Satisfacción por institución para la consola.
create or replace function public.admin_satisfaction()
returns table (institution text, surveys integer, avg_rating numeric, solved_share integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede ver la satisfacción.' using errcode = '42501';
  end if;
  return query
  select coalesce(nullif(p.full_name, ''), 'Sin institución'), count(*)::integer, round(avg(s.rating)::numeric, 1),
    round(100.0 * count(*) filter (where s.solved) / count(*))::integer
  from public.report_surveys s
  join public.reports r on r.id = s.report_id
  left join public.profiles p on p.id = r.assigned_institution_id
  group by p.full_name
  order by count(*) desc
  limit 20;
end;
$$;

-- =====================================================================
-- 9. RF-57: estadísticas públicas para la API abierta
-- =====================================================================
create or replace function public.public_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'reports_total', (select count(*) from public.reports),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.reports group by status) x),
    'by_category', (select coalesce(jsonb_object_agg(category, n), '{}'::jsonb) from (select category, count(*) n from public.reports group by category) x),
    'by_province', (select coalesce(jsonb_object_agg(province, n), '{}'::jsonb) from (select coalesce(province, 'Sin provincia') province, count(*) n from public.reports group by 1) x),
    'resolved_last_30_days', (select count(distinct h.report_id) from public.report_status_history h where h.to_status = 'resuelto' and h.created_at > now() - interval '30 days'),
    'median_resolution_hours', (
      select round((percentile_cont(0.5) within group (order by hours))::numeric, 1) from (
        select extract(epoch from (min(h.created_at) - r.created_at)) / 3600 as hours
        from public.reports r join public.report_status_history h on h.report_id = r.id and h.to_status = 'resuelto'
        where r.status = 'resuelto' group by r.id, r.created_at
      ) t
    ),
    'average_satisfaction', (select round(avg(rating)::numeric, 2) from public.report_surveys),
    'sensor_reports', (select count(*) from public.reports where source = 'sensor')
  );
$$;

-- =====================================================================
-- 10. Vista pública: origen, terreno y calificación de la solución
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
  nullif(i.full_name, '') as assigned_institution_name,
  coalesce(r.assigned_institution_id = (select auth.uid()), false) as assigned_to_me,
  case when r.duplicate_review = 'unido' then r.possible_duplicate_of end as merged_into,
  -- RF-58 y RF-59: si lo creó un sensor y en qué tipo de terreno está.
  r.source,
  r.land_status,
  -- RF-63: calificación que el autor le dio a la solución (sin su comentario).
  (select sv.rating from public.report_surveys sv where sv.report_id = r.id) as survey_rating
from public.reports r
join public.profiles p on p.id = r.author_id
left join public.profiles i on i.id = r.assigned_institution_id;

revoke all on public.public_reports from anon, authenticated;
grant select on public.public_reports to anon, authenticated;

-- Los reportes que ya existían toman su tipo de terreno (si ya hay zonas cargadas).
update public.reports r set land_status = public.land_status_at(r.latitude, r.longitude)
where exists (select 1 from public.cadastral_zones) and r.land_status is distinct from public.land_status_at(r.latitude, r.longitude);

-- =====================================================================
-- 11. Permisos de ejecución
-- =====================================================================
revoke execute on function public.data_key() from public, anon, authenticated;
revoke execute on function public.encrypt_value(text) from public, anon, authenticated;
revoke execute on function public.decrypt_value(bytea) from public, anon, authenticated;
revoke execute on function public.protect_contact_phone() from public, anon, authenticated;
revoke execute on function public.point_in_ring(double precision, double precision, jsonb) from public, anon, authenticated;
revoke execute on function public.geojson_points(jsonb) from public, anon, authenticated;
revoke execute on function public.format_number(numeric) from public, anon, authenticated;
revoke execute on function public.point_in_geometry(double precision, double precision, jsonb) from public, anon, authenticated;
revoke execute on function public.land_status_at(double precision, double precision) from public, anon, authenticated;
revoke execute on function public.set_report_land_status() from public, anon, authenticated;
revoke execute on function public.notify_nearby_alerts() from public, anon, authenticated;

revoke execute on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.can_manage_report(uuid) from public, anon;
grant execute on function public.can_manage_report(uuid) to authenticated;

-- Lo pueden llamar sin sesión: los sensores, la verificación de constancias y las estadísticas abiertas.
revoke execute on function public.iot_submit_reading(text, numeric) from public;
grant execute on function public.iot_submit_reading(text, numeric) to anon, authenticated;
revoke execute on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;
revoke execute on function public.public_stats() from public;
grant execute on function public.public_stats() to anon, authenticated;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_contact_phone(uuid)',
    'public.admin_import_cadastral_zones(jsonb, text, boolean)',
    'public.admin_cadastral_summary()',
    'public.admin_register_iot_device(text, uuid, text, text, text, numeric, text, double precision, double precision, text, text, text)',
    'public.admin_set_iot_device_active(uuid, boolean)',
    'public.admin_iot_devices()',
    'public.my_alert_subscriptions()',
    'public.save_alert_subscription(uuid, text, double precision, double precision, integer, text[], boolean)',
    'public.delete_alert_subscription(uuid)',
    'public.issue_volunteer_certificate()',
    'public.submit_report_survey(uuid, integer, boolean, text)',
    'public.admin_satisfaction()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
