import type { PublicReport } from '../models/report.model';
import {
  EMPTY_FILTERS, activeFilterCount, dateLabel, dateRange, fromQueryParams, matchesFilters, normalizeText, toQueryFilters,
  toQueryParams, type ReportFilterState,
} from './report-filters';

const report = (changes: Partial<PublicReport> = {}): PublicReport => ({
  id: '0b8f6c0e-3a55-4c1f-9d3b-0a2f9e6c1d11',
  title: 'Hoyo en la avenida',
  description: 'Un hoyo profundo frente a la escuela',
  category: 'baches',
  latitude: 18.6,
  longitude: -70.0,
  address: 'Frente al colmado',
  province: 'Santo Domingo',
  municipality: 'Santo Domingo Norte',
  sector: 'Villa Mella',
  status: 'reportado',
  is_anonymous: false,
  author_name: 'Ana',
  author_avatar_url: null,
  created_at: '2026-11-10T15:00:00.000Z',
  ...changes,
});

const filters = (changes: Partial<ReportFilterState> = {}): ReportFilterState => ({ ...EMPTY_FILTERS, ...changes });

describe('Filtros del mapa (RF-20)', () => {
  const now = new Date('2026-11-12T12:00:00.000Z');

  it('sin filtros, todo coincide', () => {
    expect(matchesFilters(report(), filters(), now)).toBe(true);
    expect(activeFilterCount(filters())).toBe(0);
  });

  it('filtra por provincia, municipio, sector, categoría y estado', () => {
    expect(matchesFilters(report(), filters({ province: 'Santiago' }), now)).toBe(false);
    expect(matchesFilters(report(), filters({ municipality: 'norte' }), now)).toBe(true);
    expect(matchesFilters(report(), filters({ sector: 'Los Mina' }), now)).toBe(false);
    expect(matchesFilters(report(), filters({ category: 'basura' }), now)).toBe(false);
    expect(matchesFilters(report(), filters({ status: 'resuelto' }), now)).toBe(false);
    expect(activeFilterCount(filters({ province: 'Santiago', sector: 'Centro', status: 'resuelto' }))).toBe(3);
  });

  it('municipio, sector y búsqueda no distinguen tildes ni mayúsculas', () => {
    const higuey = report({ municipality: 'Higüey', sector: 'San José' });
    expect(matchesFilters(higuey, filters({ municipality: 'higuey' }), now)).toBe(true);
    expect(matchesFilters(higuey, filters({ sector: 'SAN JOSE' }), now)).toBe(true);
    expect(matchesFilters(report(), filters({ search: 'ESCUELA' }), now)).toBe(true);
    expect(normalizeText('  Peña Gómez ')).toBe('pena gomez');
  });

  it('filtra por los últimos días', () => {
    expect(matchesFilters(report(), filters({ period: '7' }), now)).toBe(true);
    expect(matchesFilters(report({ created_at: '2026-10-01T00:00:00.000Z' }), filters({ period: '30' }), now)).toBe(false);
  });

  it('filtra por un rango de fechas, incluyendo el último día completo', () => {
    const range = filters({ period: 'rango', from: '2026-11-01', to: '2026-11-10' });
    expect(matchesFilters(report({ created_at: new Date(2026, 10, 10, 23, 30).toISOString() }), range, now)).toBe(true);
    expect(matchesFilters(report({ created_at: new Date(2026, 10, 11, 0, 5).toISOString() }), range, now)).toBe(false);
    expect(matchesFilters(report({ created_at: new Date(2026, 9, 31, 23, 0).toISOString() }), range, now)).toBe(false);
    expect(dateLabel(range)).toBe('01/11/2026 – 10/11/2026');
    expect(dateRange(filters({ period: 'rango' }), now)).toEqual({ since: null, until: null });
  });

  it('convierte los filtros en la consulta', () => {
    const query = toQueryFilters(filters({ search: '  hoyo ', sector: 'Villa Mella', period: '7' }), 300, now);
    expect(query.search).toBe('hoyo');
    expect(query.sector).toBe('Villa Mella');
    expect(query.since).toBe('2026-11-05T12:00:00.000Z');
    expect(query.limit).toBe(300);
  });

  it('se guarda en la dirección y se recupera igual (enlace compartible)', () => {
    const original = filters({ search: 'hoyo', category: 'baches', status: 'en_proceso', province: 'Santiago', municipality: 'Tamboril', sector: 'Centro', period: 'rango', from: '2026-11-01', to: '2026-11-05' });
    const params = toQueryParams(original);
    expect(fromQueryParams((key) => params[key] ?? null)).toEqual(original);
  });

  it('ignora valores no válidos en la dirección', () => {
    const parsed = fromQueryParams((key) => ({ estado: 'borrado', periodo: '999', desde: 'ayer' } as Record<string, string>)[key] ?? null);
    expect(parsed.status).toBe('');
    expect(parsed.period).toBe('');
    expect(parsed.from).toBe('');
  });
});
