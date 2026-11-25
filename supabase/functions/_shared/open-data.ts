// API abierta de ConectaRD (RF-57): lógica sin dependencias, para poder probarla con Node.

export const API_VERSION = '1.0.0';
export const MAX_LIMIT = 100;

export const CATEGORIES = ['basura', 'baches', 'alumbrado', 'agua', 'areas_verdes', 'seguridad', 'educacion', 'otros'] as const;
export const STATUSES = ['reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado'] as const;

/** Columnas públicas: nunca el autor (ni su nombre), aunque el reporte no sea anónimo. */
export const REPORT_FIELDS = [
  'id', 'title', 'description', 'category', 'status', 'province', 'municipality', 'sector',
  'latitude', 'longitude', 'created_at', 'status_updated_at', 'support_count', 'comment_count',
  'assigned_institution_name', 'source', 'land_status', 'survey_rating',
] as const;

export interface ReportQuery {
  category: string | null;
  status: string | null;
  province: string | null;
  municipality: string | null;
  since: string | null;
  limit: number;
  offset: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Route =
  | { kind: 'reports'; query: ReportQuery }
  | { kind: 'report'; id: string }
  | { kind: 'stats' }
  | { kind: 'openapi' }
  | { kind: 'error'; status: number; message: string };

/** Interpreta la ruta y los parámetros. La función se publica como /public-api. */
export function route(url: URL): Route {
  const path = url.pathname.replace(/^.*\/public-api/, '').replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/v1' || path === '/v1/openapi.json') return { kind: 'openapi' };
  if (path === '/v1/stats') return { kind: 'stats' };
  if (path === '/v1/reports') {
    const query = parseReportQuery(url.searchParams);
    return 'error' in query ? { kind: 'error', status: 400, message: query.error } : { kind: 'reports', query };
  }
  const single = path.match(/^\/v1\/reports\/([^/]+)$/);
  if (single) {
    return UUID.test(single[1]) ? { kind: 'report', id: single[1].toLowerCase() } : { kind: 'error', status: 400, message: 'El id debe ser un UUID.' };
  }
  return { kind: 'error', status: 404, message: 'Ruta no encontrada. Consulta /public-api/v1/openapi.json.' };
}

export function parseReportQuery(params: URLSearchParams): ReportQuery | { error: string } {
  const text = (name: string, max: number) => {
    const value = params.get(name)?.trim() ?? '';
    return value ? value.slice(0, max) : null;
  };
  const category = text('category', 30);
  if (category && !(CATEGORIES as readonly string[]).includes(category)) return { error: `category debe ser una de: ${CATEGORIES.join(', ')}.` };
  const status = text('status', 30);
  if (status && !(STATUSES as readonly string[]).includes(status)) return { error: `status debe ser uno de: ${STATUSES.join(', ')}.` };
  const since = text('since', 40);
  if (since && Number.isNaN(Date.parse(since))) return { error: 'since debe ser una fecha ISO 8601 (por ejemplo, 2027-01-31).' };
  const limitRaw = params.get('limit');
  const offsetRaw = params.get('offset');
  const limit = limitRaw === null ? 50 : Number(limitRaw);
  const offset = offsetRaw === null ? 0 : Number(offsetRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { error: `limit debe ser un entero entre 1 y ${MAX_LIMIT}.` };
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return { error: 'offset debe ser un entero entre 0 y 100000.' };
  return {
    category,
    status,
    province: text('province', 60),
    municipality: text('municipality', 80),
    since: since ? new Date(since).toISOString() : null,
    limit,
    offset,
  };
}

/** Deja solo los campos públicos (por si la vista suma columnas en el futuro). */
export function toPublicReport(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of REPORT_FIELDS) out[field] = row[field] ?? null;
  return out;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

/** Especificación OpenAPI 3.1 de la API. */
export function openApi(baseUrl: string): Record<string, unknown> {
  const report = {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      description: { type: 'string' },
      category: { type: 'string', enum: [...CATEGORIES] },
      status: { type: 'string', enum: [...STATUSES] },
      province: { type: ['string', 'null'] },
      municipality: { type: ['string', 'null'] },
      sector: { type: ['string', 'null'] },
      latitude: { type: 'number' },
      longitude: { type: 'number' },
      created_at: { type: 'string', format: 'date-time' },
      status_updated_at: { type: 'string', format: 'date-time' },
      support_count: { type: 'integer', description: 'Personas que marcaron "Me afecta".' },
      comment_count: { type: 'integer' },
      assigned_institution_name: { type: ['string', 'null'], description: 'Institución responsable asignada según zona y categoría.' },
      source: { type: 'string', enum: ['ciudadano', 'sensor'] },
      land_status: { type: 'string', enum: ['publico', 'privado', 'protegido', 'desconocido'] },
      survey_rating: { type: ['integer', 'null'], minimum: 1, maximum: 5, description: 'Calificación de la solución dada por quien reportó.' },
    },
  };
  const error = { type: 'object', properties: { error: { type: 'string' } } };
  return {
    openapi: '3.1.0',
    info: {
      title: 'ConectaRD · API de datos abiertos',
      version: API_VERSION,
      description: 'Reportes comunitarios públicos de República Dominicana. Solo lectura, sin datos personales: nunca incluye quién hizo el reporte. Licencia de los datos: CC BY 4.0 (cita "ConectaRD").',
      license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.es' },
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/v1/reports': {
        get: {
          summary: 'Lista de reportes (más recientes primero)',
          parameters: [
            { name: 'category', in: 'query', schema: { type: 'string', enum: [...CATEGORIES] } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: [...STATUSES] } },
            { name: 'province', in: 'query', schema: { type: 'string' }, description: 'Nombre exacto, por ejemplo "Distrito Nacional".' },
            { name: 'municipality', in: 'query', schema: { type: 'string' } },
            { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Solo reportes creados desde esa fecha.' },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
          ],
          responses: {
            200: { description: 'Página de reportes', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: report }, limit: { type: 'integer' }, offset: { type: 'integer' }, next_offset: { type: ['integer', 'null'] } } } } } },
            400: { description: 'Parámetro no válido', content: { 'application/json': { schema: error } } },
          },
        },
      },
      '/v1/reports/{id}': {
        get: {
          summary: 'Un reporte',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'El reporte', content: { 'application/json': { schema: { type: 'object', properties: { data: report } } } } },
            404: { description: 'No existe', content: { 'application/json': { schema: error } } },
          },
        },
      },
      '/v1/stats': {
        get: {
          summary: 'Estadísticas generales',
          responses: { 200: { description: 'Totales por estado, categoría y provincia, resueltos en 30 días, mediana de resolución y satisfacción promedio.' } },
        },
      },
    },
  };
}
