import type { PublicReport, PublicReportFilters, ReportStatus } from '../models/report.model';

// Filtros del mapa y la lista (RF-20): provincia, municipio, sector, categoría, fecha y estado.
// El mismo estado sirve para consultar la base de datos, para decidir si un reporte que llega
// en tiempo real (RF-18) debe aparecer, y para guardarse en la dirección (enlace compartible).

export type Period = '' | '7' | '30' | '90' | 'rango';

export interface ReportFilterState {
  search: string;
  category: string;
  status: ReportStatus | '';
  province: string;
  municipality: string;
  sector: string;
  period: Period;
  /** Fechas 'AAAA-MM-DD' (solo con period = 'rango'). */
  from: string;
  to: string;
}

export const EMPTY_FILTERS: ReportFilterState = {
  search: '', category: '', status: '', province: '', municipality: '', sector: '', period: '', from: '', to: '',
};

const STATUSES: ReportStatus[] = ['reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado'];
const PERIODS: Period[] = ['', '7', '30', '90', 'rango'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Cuántos filtros hay activos (sin contar la búsqueda). */
export function activeFilterCount(filters: ReportFilterState): number {
  return [filters.category, filters.status, filters.province, filters.municipality, filters.sector, dateLabel(filters)]
    .filter(Boolean).length;
}

/** Inicio y fin del rango de fechas en ISO (fin incluido: hasta las 23:59 de ese día, hora local). */
export function dateRange(filters: ReportFilterState, now: Date = new Date()): { since: string | null; until: string | null } {
  if (filters.period === 'rango') {
    const since = DATE.test(filters.from) ? localDayStart(filters.from) : null;
    const until = DATE.test(filters.to) ? new Date(localDayStart(filters.to).getTime() + 86_400_000 - 1) : null;
    return { since: since?.toISOString() ?? null, until: until?.toISOString() ?? null };
  }
  if (filters.period) return { since: new Date(now.getTime() - Number(filters.period) * 86_400_000).toISOString(), until: null };
  return { since: null, until: null };
}

/** Texto corto del filtro de fecha ('' si no hay). */
export function dateLabel(filters: ReportFilterState): string {
  if (filters.period === '7') return 'Últimos 7 días';
  if (filters.period === '30') return 'Últimos 30 días';
  if (filters.period === '90') return 'Últimos 3 meses';
  if (filters.period === 'rango' && (filters.from || filters.to)) {
    const format = (value: string) => value.split('-').reverse().join('/');
    if (filters.from && filters.to) return `${format(filters.from)} – ${format(filters.to)}`;
    return filters.from ? `Desde ${format(filters.from)}` : `Hasta ${format(filters.to)}`;
  }
  return '';
}

/** Filtros para ReportsService.listPublic. */
export function toQueryFilters(filters: ReportFilterState, limit = 500, now: Date = new Date()): PublicReportFilters {
  const { since, until } = dateRange(filters, now);
  return {
    search: filters.search.trim() || null,
    category: filters.category || null,
    status: filters.status || null,
    province: filters.province || null,
    municipality: filters.municipality.trim() || null,
    sector: filters.sector.trim() || null,
    since,
    until,
    limit,
  };
}

/**
 * ¿Debe verse este reporte con los filtros actuales? Replica lo que hace la consulta
 * (búsqueda y municipio/sector por texto parcial, sin distinguir mayúsculas ni tildes).
 */
export function matchesFilters(report: PublicReport, filters: ReportFilterState, now: Date = new Date()): boolean {
  if (filters.category && report.category !== filters.category) return false;
  if (filters.status && report.status !== filters.status) return false;
  if (filters.province && report.province !== filters.province) return false;
  if (filters.municipality.trim() && !contains(report.municipality, filters.municipality)) return false;
  if (filters.sector.trim() && !contains(report.sector, filters.sector)) return false;
  const { since, until } = dateRange(filters, now);
  const created = new Date(report.created_at).getTime();
  if (since && created < new Date(since).getTime()) return false;
  if (until && created > new Date(until).getTime()) return false;
  const search = filters.search.trim();
  if (search) {
    const haystack = [report.title, report.description, report.sector, report.municipality, report.address].join(' ');
    if (!contains(haystack, search)) return false;
  }
  return true;
}

/** Filtros → parámetros de la dirección (solo los que tienen valor). */
export function toQueryParams(filters: ReportFilterState): Record<string, string | null> {
  const value = (text: string) => text.trim() || null;
  return {
    q: value(filters.search),
    categoria: value(filters.category),
    estado: value(filters.status),
    provincia: value(filters.province),
    municipio: value(filters.municipality),
    sector: value(filters.sector),
    periodo: value(filters.period),
    desde: filters.period === 'rango' ? value(filters.from) : null,
    hasta: filters.period === 'rango' ? value(filters.to) : null,
  };
}

/** Parámetros de la dirección → filtros (ignora valores no válidos). */
export function fromQueryParams(get: (key: string) => string | null): ReportFilterState {
  const status = get('estado') ?? '';
  const period = get('periodo') ?? '';
  const from = get('desde') ?? '';
  const to = get('hasta') ?? '';
  return {
    search: (get('q') ?? '').slice(0, 120),
    category: (get('categoria') ?? '').slice(0, 40),
    status: (STATUSES as string[]).includes(status) ? (status as ReportStatus) : '',
    province: (get('provincia') ?? '').slice(0, 60),
    municipality: (get('municipio') ?? '').slice(0, 80),
    sector: (get('sector') ?? '').slice(0, 80),
    period: (PERIODS as string[]).includes(period) ? (period as Period) : '',
    from: DATE.test(from) ? from : '',
    to: DATE.test(to) ? to : '',
  };
}

/** Texto sin tildes ni mayúsculas, para comparar. */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function contains(value: string | null | undefined, term: string): boolean {
  return normalizeText(value).includes(normalizeText(term));
}

function localDayStart(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
