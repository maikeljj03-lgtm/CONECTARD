// RF-57: API pública de datos abiertos de ConectaRD (solo lectura, sin datos personales).
//
//   GET /functions/v1/public-api/v1/reports?category=&status=&province=&municipality=&since=&limit=&offset=
//   GET /functions/v1/public-api/v1/reports/{id}
//   GET /functions/v1/public-api/v1/stats
//   GET /functions/v1/public-api/v1/openapi.json   (especificación OpenAPI 3.1)
//
// Para publicarla (una sola vez): supabase functions deploy public-api --no-verify-jwt
// (es pública: no pide sesión; supabase/config.toml ya la marca con verify_jwt = false).
// Usa la clave pública (anon), así que la base de datos aplica los mismos permisos que a un visitante.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { CORS_HEADERS, REPORT_FIELDS, json, openApi, route, toPublicReport } from '../_shared/open-data.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Los datos cambian poco de un minuto a otro: se permite guardarlos en caché brevemente.
const CACHE = { 'Cache-Control': 'public, max-age=60' };

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'GET') return json({ error: 'Solo se permite GET.' }, 405);

  const url = new URL(request.url);
  const target = route(url);
  const base = `${url.origin}${url.pathname.replace(/\/public-api.*$/, '/public-api')}`;

  try {
    switch (target.kind) {
      case 'openapi':
        return json(openApi(base), 200, { 'Cache-Control': 'public, max-age=3600' });
      case 'error':
        return json({ error: target.message }, target.status);
      case 'stats': {
        const { data, error } = await supabase.rpc('public_stats');
        if (error) throw error;
        return json({ data }, 200, CACHE);
      }
      case 'report': {
        const { data, error } = await supabase.from('public_reports').select(REPORT_FIELDS.join(',')).eq('id', target.id).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'El reporte no existe.' }, 404);
        return json({ data: toPublicReport(data as unknown as Record<string, unknown>) }, 200, CACHE);
      }
      case 'reports': {
        const q = target.query;
        let query = supabase.from('public_reports').select(REPORT_FIELDS.join(','));
        if (q.category) query = query.eq('category', q.category);
        if (q.status) query = query.eq('status', q.status);
        if (q.province) query = query.eq('province', q.province);
        if (q.municipality) query = query.eq('municipality', q.municipality);
        if (q.since) query = query.gte('created_at', q.since);
        // Se pide uno más para saber si hay otra página.
        const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(q.offset, q.offset + q.limit);
        if (error) throw error;
        const rows = (data ?? []) as unknown as Record<string, unknown>[];
        const page = rows.slice(0, q.limit).map(toPublicReport);
        return json({ data: page, limit: q.limit, offset: q.offset, next_offset: rows.length > q.limit ? q.offset + q.limit : null }, 200, CACHE);
      }
    }
  } catch (error) {
    console.error('Error en la API abierta', error);
    return json({ error: 'No se pudieron leer los datos ahora. Inténtalo más tarde.' }, 503);
  }
});
