-- RF-16: el ciclo del reporte debe avanzar de una etapa a la siguiente.
-- La moderación administrativa conserva las salidas excepcionales de rechazo y restauración.

create or replace function public.enforce_report_status_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := public.current_user_role();
  expected_status text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- La moderación puede rechazar un reporte abierto o restaurar uno rechazado por error.
  if actor_role = 'administrator'
    and (new.status = 'rechazado' or (old.status = 'rechazado' and new.status = 'reportado')) then
    return new;
  end if;

  expected_status := case old.status
    when 'reportado' then 'en_revision'
    when 'en_revision' then 'en_proceso'
    when 'en_proceso' then 'resuelto'
    else null
  end;

  if expected_status is null or new.status <> expected_status then
    raise exception 'El reporte debe avanzar en orden: Reportado → En revisión → En proceso → Resuelto.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_report_status_sequence() from public;

drop trigger if exists reports_enforce_status_sequence on public.reports;
create trigger reports_enforce_status_sequence
  before update of status on public.reports
  for each row execute function public.enforce_report_status_sequence();
