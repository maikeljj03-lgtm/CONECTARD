// RF-47: asistente conversacional de ConectaRD, con Gemini.
//
// Responde dudas sobre cómo usar la plataforma y sobre los reportes de la propia persona.
// Comprueba la sesión, descuenta del límite diario (40 mensajes por persona) y solo lee
// los datos de quien pregunta (con su propia sesión, así que la base de datos aplica sus permisos).
//
// Para activarlo (una sola vez):
//   1. supabase secrets set GEMINI_API_KEY=<tu clave de Google AI Studio>
//   2. supabase functions deploy assistant-chat
// SUPABASE_URL y SUPABASE_ANON_KEY ya existen en las funciones de Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  ASSISTANT_KNOWLEDGE,
  CORS_HEADERS,
  buildUserContext,
  jsonResponse,
  validateChat,
  type ContextProfile,
  type ContextProgress,
  type ContextReport,
} from '../_shared/conectard-ai.ts';

const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiApiKey) return jsonResponse({ error: 'El asistente no está activado: falta configurar la clave de Gemini.' }, 503);

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
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        system_instruction: `${ASSISTANT_KNOWLEDGE}\n\n${buildUserContext(profile, reports, progress, new Date())}`,
        input: chat.messages.map((turn) => `${turn.role === 'assistant' ? 'Asistente' : 'Usuario'}: ${turn.content}`).join('\n'),
        store: false,
        generation_config: { max_output_tokens: 1200 },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const payload = await response.json().catch(() => null) as {
      steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
      error?: { status?: string; message?: string };
    } | null;

    if (!response.ok) {
      const status = payload?.error?.status ?? '';
      const message = payload?.error?.message ?? '';
      console.error('Gemini respondió con error', response.status, status, message.slice(0, 300));
      if (response.status === 429 || status === 'RESOURCE_EXHAUSTED') {
        return jsonResponse({ error: 'El asistente alcanzó el límite de uso de Gemini. Inténtalo más tarde o revisa la cuota de Google AI Studio.' }, 503);
      }
      if (response.status === 400 && /billing|quota|payment/i.test(message)) {
        return jsonResponse({ error: 'La cuenta de Gemini no tiene cuota disponible. Revisa el uso y la facturación en Google AI Studio.' }, 503);
      }
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return jsonResponse({ error: 'La clave de Gemini no es válida o no tiene acceso a este modelo. Revísala en los secretos de Supabase.' }, 503);
      }
      return jsonResponse({ error: 'El asistente no pudo responder ahora. Inténtalo de nuevo.' }, 502);
    }

    const reply = (payload?.steps ?? [])
      .filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('\n')
      .trim();
    return jsonResponse({ reply: reply || 'No tengo una respuesta para eso. ¿Puedes contarme un poco más?', remaining });
  } catch (error) {
    console.error('Error de conexión con Gemini', error instanceof Error ? error.message : 'error desconocido');
    return jsonResponse({ error: 'No pudimos conectar con Gemini ahora. Inténtalo de nuevo.' }, 502);
  }
});
