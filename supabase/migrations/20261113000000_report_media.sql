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
