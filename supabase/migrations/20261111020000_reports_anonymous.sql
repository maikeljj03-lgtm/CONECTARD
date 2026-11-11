-- RF-07: reportes con opción de publicación anónima.
-- Base mínima de la tabla de reportes (el módulo 2 la ampliará con fotos, estados e historial).
-- El anonimato se garantiza en la base de datos: la tabla no es legible por el público y la
-- vista public_reports nunca expone el autor de un reporte anónimo.
-- Ejecutar después de 20261111010000_organization_verification.sql.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 5 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  category text not null check (category in (
    'basura', 'baches', 'alumbrado', 'agua', 'areas_verdes', 'seguridad', 'educacion', 'otros'
  )),
  latitude double precision not null check (latitude between 17.3 and 20.2),
  longitude double precision not null check (longitude between -72.1 and -68.2),
  address text check (address is null or char_length(address) <= 200),
  province text check (province is null or char_length(province) <= 60),
  municipality text check (municipality is null or char_length(municipality) <= 80),
  sector text check (sector is null or char_length(sector) <= 80),
  status text not null default 'reportado'
    check (status in ('reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado')),
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reports_created_at_idx on public.reports (created_at desc);
create index if not exists reports_author_idx on public.reports (author_id);

drop trigger if exists reports_set_updated_at on public.reports;
create trigger reports_set_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;
grant insert (title, description, category, latitude, longitude, address, province, municipality, sector, is_anonymous)
  on public.reports to authenticated;

-- La tabla solo la leen el autor y los administradores (incluye author_id).
drop policy if exists "Authors and admins read reports" on public.reports;
create policy "Authors and admins read reports"
  on public.reports for select to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Users create their own reports" on public.reports;
create policy "Users create their own reports"
  on public.reports for insert to authenticated
  with check (author_id = (select auth.uid()) and status = 'reportado');

-- Vista pública: todos ven los reportes, pero un reporte anónimo no revela quién lo hizo.
-- Se ejecuta con los permisos de su dueño (no security_invoker) para poder leer la tabla
-- sin exponer author_id; por eso solo selecciona columnas seguras.
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
  r.created_at
from public.reports r
join public.profiles p on p.id = r.author_id;

revoke all on public.public_reports from anon, authenticated;
grant select on public.public_reports to anon, authenticated;
