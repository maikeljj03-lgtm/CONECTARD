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
