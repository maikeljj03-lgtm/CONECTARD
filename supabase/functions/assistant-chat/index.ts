// RF-47: asistente conversacional de ConectaRD, con Claude.
//
// Responde dudas sobre cómo usar la plataforma y sobre los reportes de la propia persona.
// Comprueba la sesión, descuenta del límite diario (40 mensajes por persona) y solo lee
// los datos de quien pregunta (con su propia sesión, así que la base de datos aplica sus permisos).
//
// Para activarlo (una sola vez):
//   1. supabase secrets set ANTHROPIC_API_KEY=<tu clave de la consola de Anthropic>
//   2. supabase functions deploy assistant-chat
// SUPABASE_URL y SUPABASE_ANON_KEY ya existen en las funciones de Supabase.

import Anthropic from 'npm:@anthropic-ai/sdk@1';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  AI_MODEL,
  ASSISTANT_KNOWLEDGE,
  CORS_HEADERS,
  buildUserContext,
  jsonResponse,
  validateChat,
  type ContextProfile,
  type ContextProgress,
  type ContextReport,
} from '../_shared/conectard-ai.ts';

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '', maxRetries: 2, timeout: 60_000 });

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return jsonResponse({ error: 'El asistente no está activado todavía.' }, 503);

  const authorization = request.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return jsonResponse({ error: 'Inicia sesión para usar el asistente.' }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'El mensaje no llegó bien. Inténtalo de nuevo.' }, 400);
  }
  const chat = validateChat(body);
  if ('error' in chat) return jsonResponse({ error: chat.error }, 400);

  const { data: remaining, error: quotaError } = await supabase.rpc('consume_ai_quota', { feature: 'chat' });
  if (quotaError) return jsonResponse({ error: quotaError.message }, quotaError.code === '42501' ? 403 : 429);

  // Datos de la propia persona (si alguno falla, el asistente responde igual sin ellos).
  const [profileResult, reportsResult, progressResult] = await Promise.allSettled([
    supabase.from('profiles').select('full_name, role, province').eq('id', user.id).maybeSingle(),
    supabase
      .from('public_reports')
      .select('title, status, category, created_at, municipality, province, support_count, assigned_institution_name')
      .eq('is_mine', true)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.rpc('my_progress'),
  ]);
  const profile = profileResult.status === 'fulfilled' ? (profileResult.value.data as ContextProfile | null) : null;
  const reports = reportsResult.status === 'fulfilled' ? ((reportsResult.value.data ?? []) as ContextReport[]) : [];
  const progress = progressResult.status === 'fulfilled' ? (progressResult.value.data as ContextProgress | null) : null;

  try {
    const response = await anthropic.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [
        // El conocimiento fijo va primero y se guarda en caché; los datos de la persona, después.
        { type: 'text', text: ASSISTANT_KNOWLEDGE, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: buildUserContext(profile, reports, progress, new Date()) },
      ],
      messages: chat.messages.map((turn) => ({ role: turn.role, content: turn.content })),
    });

    if (response.stop_reason === 'refusal') {
      return jsonResponse({ reply: 'No puedo ayudarte con eso. ¿Tienes alguna duda sobre cómo usar ConectaRD?', remaining });
    }
    const reply = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
      .trim();
    return jsonResponse({ reply: reply || 'No tengo una respuesta para eso. ¿Puedes contarme un poco más?', remaining });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return jsonResponse({ error: 'El asistente está ocupado. Inténtalo en un momento.' }, 503);
    if (error instanceof Anthropic.APIError) {
      console.error('Claude respondió con error', error.status, error.message);
      return jsonResponse({ error: 'El asistente no pudo responder ahora.' }, 502);
    }
    console.error('Error inesperado en el asistente', error);
    return jsonResponse({ error: 'El asistente no pudo responder ahora.' }, 500);
  }
});
