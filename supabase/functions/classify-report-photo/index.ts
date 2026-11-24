// RF-44: sugiere la categoría (y un título) de un reporte a partir de su foto, con Claude.
//
// La app manda una copia reducida de la foto; aquí se comprueba la sesión, se descuenta del
// límite diario (30 fotos por persona) y se pide la clasificación con salida estructurada.
// La persona siempre decide: la app solo muestra la sugerencia.
//
// Para activarla (una sola vez):
//   1. supabase secrets set ANTHROPIC_API_KEY=<tu clave de la consola de Anthropic>
//   2. supabase functions deploy classify-report-photo
// SUPABASE_URL y SUPABASE_ANON_KEY ya existen en las funciones de Supabase.

import Anthropic from 'npm:@anthropic-ai/sdk@1';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  AI_MODEL,
  CLASSIFICATION_SCHEMA,
  CLASSIFY_SYSTEM,
  CORS_HEADERS,
  jsonResponse,
  parseClassification,
  validateImagePayload,
} from '../_shared/conectard-ai.ts';

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '', maxRetries: 2, timeout: 45_000 });

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return jsonResponse({ error: 'La sugerencia automática no está activada.' }, 503);

  // Sesión de la persona: la misma con la que usa la app.
  const authorization = request.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: 'Inicia sesión para continuar.' }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'La foto no llegó bien. Inténtalo de nuevo.' }, 400);
  }
  const payload = validateImagePayload(body);
  if ('error' in payload) return jsonResponse({ error: payload.error }, 400);

  const { data: remaining, error: quotaError } = await supabase.rpc('consume_ai_quota', { feature: 'foto' });
  if (quotaError) return jsonResponse({ error: quotaError.message }, quotaError.code === '42501' ? 403 : 429);

  try {
    const response = await anthropic.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: CLASSIFICATION_SCHEMA as unknown as Record<string, unknown> },
      },
      system: CLASSIFY_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: payload.mediaType, data: payload.data } },
            { type: 'text', text: 'Clasifica esta foto para un reporte comunitario.' },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') return jsonResponse({ suggestion: null, remaining });
    const text = response.content.find((block) => block.type === 'text');
    const suggestion = text && text.type === 'text' ? parseClassification(text.text) : null;
    return jsonResponse({ suggestion, remaining });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return jsonResponse({ error: 'El servicio está ocupado. Inténtalo en un momento.' }, 503);
    if (error instanceof Anthropic.APIError) {
      console.error('Claude respondió con error', error.status, error.message);
      return jsonResponse({ error: 'No se pudo analizar la foto ahora.' }, 502);
    }
    console.error('Error inesperado al clasificar', error);
    return jsonResponse({ error: 'No se pudo analizar la foto ahora.' }, 500);
  }
});
