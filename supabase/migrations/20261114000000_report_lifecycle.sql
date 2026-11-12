-- RF-15: el autor edita o elimina su reporte dentro del período permitido.
-- RF-16: ciclo de vida del reporte con historial (quién cambió qué y cuándo).
-- RF-17: evidencia de solución con fotos "Antes y Después".
--
-- Reglas (sección 4 de la propuesta):
--   · El autor edita o elimina su reporte solo durante las primeras 24 horas y mientras siga
--     en "Reportado" (si una institución ya lo está atendiendo, ya no se puede cambiar).
--   · Los estados los cambia la institución pública de la jurisdicción del reporte.
--   · El administrador modera: solo puede rechazar un reporte o restaurar uno rechazado.
--   · Marcar "Resuelto" exige al menos una foto de evidencia (el "Después").
--   · Cada cambio de estado queda en un historial que nadie puede editar ni borrar.
-- Ejecutar después de 20261113000000_report_media.sql.

-- 1. Período de edición (debe coincidir con REPORT_EDIT_WINDOW_HOURS en la app).
create or replace function public.report_edit_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '24 hours';
$$;

-- ¿Puede la persona actual editar o eliminar este reporte?
create or replace function public.report_is_editable(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reports r
    where r.id = target
      and r.author_id = (select auth.uid())
      and r.status = 'reportado'
      and r.created_at > now() - public.report_edit_window()
  );
$$;

-- ¿Es la persona actual la institución responsable de este reporte?
-- Jurisdicción = la provincia del perfil de la institución y, si lo indicó, su municipio.
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
      and me.province is not null
      and r.province = me.province
      and (
        nullif(trim(me.municipality), '') is null
        or lower(trim(coalesce(r.municipality, ''))) = lower(trim(me.municipality))
      )
  );
$$;

revoke all on function public.report_is_editable(uuid) from public;
revoke all on function public.can_manage_report(uuid) from public;
grant execute on function public.report_is_editable(uuid) to authenticated;
grant execute on function public.can_manage_report(uuid) to authenticated;

-- Una institución no puede cambiarse sola de jurisdicción (se lo pide a la administración).
create or replace function public.lock_institution_jurisdiction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'institution'
     and (new.province is distinct from old.province or new.municipality is distinct from old.municipality)
     and not public.is_admin() then
    raise exception 'Una institución no puede cambiar su provincia o municipio: pídeselo a la administración.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.lock_institution_jurisdiction() from public;

drop trigger if exists profiles_lock_institution_jurisdiction on public.profiles;
create trigger profiles_lock_institution_jurisdiction
  before update on public.profiles
  for each row execute function public.lock_institution_jurisdiction();

-- 2. Historial de estados (RF-16). Base del SLA: estado anterior y nuevo, responsable y fecha.
create table if not exists public.report_status_history (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports (id) on delete cascade,
  from_status text check (from_status in ('reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado')),
  to_status text not null check (to_status in ('reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado')),
  note text check (note is null or char_length(note) <= 500),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_by_role text,
  created_at timestamptz not null default now()
);

create index if not exists report_status_history_report_idx on public.report_status_history (report_id, created_at);

-- Nadie lo escribe directamente: solo el disparador. Nadie lo edita ni lo borra.
alter table public.report_status_history enable row level security;
revoke all on public.report_status_history from anon, authenticated;

create or replace function public.log_report_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.report_status_history (report_id, from_status, to_status, changed_by, changed_by_role)
    values (new.id, null, new.status, new.author_id, 'author');
  elsif new.status is distinct from old.status then
    insert into public.report_status_history (report_id, from_status, to_status, note, changed_by, changed_by_role)
    values (
      new.id,
      old.status,
      new.status,
      nullif(current_setting('conectard.status_note', true), ''),
      (select auth.uid()),
      coalesce(public.current_user_role(), 'system')
    );
    perform set_config('conectard.status_note', '', true);
  end if;
  return new;
end;
$$;

revoke all on function public.log_report_status() from public;

drop trigger if exists reports_log_status on public.reports;
create trigger reports_log_status
  after insert or update of status on public.reports
  for each row execute function public.log_report_status();

-- Reportes que ya existían: se registra su creación (y su estado actual, si cambió).
insert into public.report_status_history (report_id, from_status, to_status, changed_by, changed_by_role, created_at)
select r.id, null, 'reportado', r.author_id, 'author', r.created_at
from public.reports r
where not exists (select 1 from public.report_status_history h where h.report_id = r.id);

insert into public.report_status_history (report_id, from_status, to_status, changed_by_role, created_at)
select r.id, 'reportado', r.status, 'system', r.updated_at
from public.reports r
where r.status <> 'reportado'
  and not exists (select 1 from public.report_status_history h where h.report_id = r.id and h.from_status is not null);

-- Vista pública del historial: nunca revela al autor (importante para los anónimos).
-- Muestra el nombre de la institución que hizo el cambio, o "Moderación de ConectaRD".
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
    when h.changed_by_role = 'institution' then coalesce(nullif(p.full_name, ''), 'Institución responsable')
    when h.changed_by_role = 'administrator' then 'Moderación de ConectaRD'
  end as actor_name,
  h.created_at
from public.report_status_history h
left join public.profiles p on p.id = h.changed_by;

revoke all on public.public_report_history from anon, authenticated;
grant select on public.public_report_history to anon, authenticated;

-- 3. Cambiar el estado (RF-16). Reemplaza a update_report_status, que no dejaba historial.
drop function if exists public.update_report_status(uuid, text);

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
    -- Moderación: rechazar, o devolver a "Reportado" uno rechazado por error.
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
  else
    raise exception 'Solo la institución responsable o un administrador puede cambiar el estado.' using errcode = '42501';
  end if;

  if new_status = 'rechazado' and clean_note is null then
    raise exception 'Escribe el motivo del rechazo.' using errcode = '22023';
  end if;
  if new_status = 'resuelto' and not exists (
    select 1 from public.report_evidence e where e.report_id = set_report_status.report_id
  ) then
    raise exception 'Para marcarlo como resuelto sube al menos una foto de cómo quedó.' using errcode = '22023';
  end if;

  -- La nota la recoge el disparador que escribe el historial.
  perform set_config('conectard.status_note', coalesce(clean_note, ''), true);
  update public.reports r set status = new_status where r.id = set_report_status.report_id;
end;
$$;

-- 4. Editar y eliminar el reporte propio (RF-15).
create or replace function public.update_own_report(
  report_id uuid,
  new_title text,
  new_description text,
  new_category text,
  new_address text default null,
  new_sector text default null,
  new_is_anonymous boolean default null
)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.reports;
begin
  if not public.report_is_editable(update_own_report.report_id) then
    raise exception 'Ya no puedes editar este reporte: pasaron las 24 horas o ya lo está atendiendo una institución.' using errcode = '22023';
  end if;

  update public.reports r
  set title = trim(new_title),
      description = trim(new_description),
      category = new_category,
      address = nullif(trim(coalesce(new_address, '')), ''),
      sector = nullif(trim(coalesce(new_sector, '')), ''),
      is_anonymous = coalesce(new_is_anonymous, r.is_anonymous)
  where r.id = update_own_report.report_id
  returning * into result;

  return result;
end;
$$;

-- Los archivos del almacenamiento los borra la app antes (la base de datos no puede borrarlos).
create or replace function public.delete_own_report(report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.report_is_editable(delete_own_report.report_id) then
    raise exception 'Ya no puedes eliminar este reporte: pasaron las 24 horas o ya lo está atendiendo una institución.' using errcode = '22023';
  end if;
  delete from public.reports r where r.id = delete_own_report.report_id;
end;
$$;

revoke all on function public.update_own_report(uuid, text, text, text, text, text, boolean) from public;
revoke all on function public.delete_own_report(uuid) from public;
grant execute on function public.update_own_report(uuid, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.delete_own_report(uuid) to authenticated;

-- 5. Fotos del autor: solo en la carpeta raíz del reporte y solo durante el período de edición.
drop policy if exists "Authors upload media to their reports" on storage.objects;
create policy "Authors upload media to their reports"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-media'
    and array_length(storage.foldername(name), 1) = 1
    and exists (
      select 1 from public.reports r
      where r.id::text = (storage.foldername(name))[1]
        and r.author_id = (select auth.uid())
        and r.status = 'reportado'
        and r.created_at > now() - public.report_edit_window()
    )
  );

drop policy if exists "Authors delete media from their reports" on storage.objects;
create policy "Authors delete media from their reports"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'report-media'
    and array_length(storage.foldername(name), 1) = 1
    and exists (
      select 1 from public.reports r
      where r.id::text = (storage.foldername(name))[1]
        and r.author_id = (select auth.uid())
        and r.status = 'reportado'
        and r.created_at > now() - public.report_edit_window()
    )
  );

drop policy if exists "Authors add media to their reports" on public.report_media;
create policy "Authors add media to their reports"
  on public.report_media for insert to authenticated
  with check (
    path like report_id::text || '/%'
    and path not like report_id::text || '/%/%'
    and path not like '%..%'
    and public.report_is_editable(report_id)
  );

drop policy if exists "Authors delete media from their reports" on public.report_media;
create policy "Authors delete media from their reports"
  on public.report_media for delete to authenticated
  using (public.report_is_editable(report_id));

-- 6. Evidencia de solución (RF-17): fotos del "Después", en <reporte>/evidencia/.
create table if not exists public.report_evidence (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  path text not null unique check (char_length(path) <= 300),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/webp', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 20971520),
  width integer check (width is null or width between 1 and 10000),
  height integer check (height is null or height between 1 and 10000),
  uploaded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists report_evidence_report_idx on public.report_evidence (report_id, created_at);

alter table public.report_evidence enable row level security;
revoke all on public.report_evidence from anon, authenticated;
-- Todos ven la evidencia, pero no quién la subió.
grant select (id, report_id, path, mime_type, size_bytes, width, height, created_at) on public.report_evidence to anon, authenticated;
grant insert (report_id, path, mime_type, size_bytes, width, height) on public.report_evidence to authenticated;
grant delete on public.report_evidence to authenticated;

drop policy if exists "Report evidence is public" on public.report_evidence;
create policy "Report evidence is public"
  on public.report_evidence for select
  using (true);

drop policy if exists "Institutions add evidence in their jurisdiction" on public.report_evidence;
create policy "Institutions add evidence in their jurisdiction"
  on public.report_evidence for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and path like report_id::text || '/evidencia/%'
    and path not like '%..%'
    and public.can_manage_report(report_id)
  );

drop policy if exists "Uploaders and admins delete evidence" on public.report_evidence;
create policy "Uploaders and admins delete evidence"
  on public.report_evidence for delete to authenticated
  using (uploaded_by = (select auth.uid()) or (select public.is_admin()));

create or replace function public.enforce_report_evidence_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.report_evidence where report_id = new.report_id) >= 5 then
    raise exception 'Un reporte puede tener como máximo 5 fotos de evidencia.' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_report_evidence_limit() from public;

drop trigger if exists report_evidence_limit on public.report_evidence;
create trigger report_evidence_limit
  before insert on public.report_evidence
  for each row execute function public.enforce_report_evidence_limit();

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
        and public.can_manage_report(r.id)
    )
  );

drop policy if exists "Uploaders delete their evidence" on storage.objects;
create policy "Uploaders delete their evidence"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'report-media'
    and (storage.foldername(name))[2] = 'evidencia'
    and owner_id = (select auth.uid())::text
  );

-- El administrador puede borrar cualquier archivo de reportes (moderación).
drop policy if exists "Admins delete report media" on storage.objects;
create policy "Admins delete report media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'report-media' and (select public.is_admin()));

-- 7. La vista pública añade la última actualización de estado y la evidencia.
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
  r.created_at
from public.reports r
join public.profiles p on p.id = r.author_id;

revoke all on public.public_reports from anon, authenticated;
grant select on public.public_reports to anon, authenticated;

-- set_report_status se concede al final: depende de report_evidence.
revoke all on function public.set_report_status(uuid, text, text) from public;
grant execute on function public.set_report_status(uuid, text, text) to authenticated;
