// RF-35: resumen semanal por correo (Supabase Edge Function, Deno).
//
// Qué hace: lee public.weekly_digest_rows() (solo con la clave de servicio) y envía a cada persona
// que lo aceptó un correo con lo que pasó en su provincia y en sus reportes durante la semana.
//
// Para activarlo (una sola vez):
//   1. supabase functions deploy weekly-digest --no-verify-jwt
//   2. supabase secrets set RESEND_API_KEY=re_xxx DIGEST_FROM="ConectaRD <resumen@tu-dominio.do>" APP_URL=https://tu-dominio.do CRON_SECRET=<texto-largo-al-azar>
//   3. Programarlo cada lunes 9:00 a. m. (hora de RD = 13:00 UTC) en el SQL Editor:
//        select cron.schedule('conectard-weekly-digest', '0 13 * * 1', $$
//          select net.http_post(
//            url := 'https://<tu-proyecto>.supabase.co/functions/v1/weekly-digest',
//            headers := jsonb_build_object('x-cron-secret', '<el mismo CRON_SECRET>')
//          );
//        $$);
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existen en las funciones de Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2';

interface DigestRow {
  user_id: string;
  email: string;
  full_name: string | null;
  province: string | null;
  new_reports: number;
  resolved_reports: number;
  my_updates: number;
  upcoming_events: number;
  points_week: number;
}

const env = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Falta la variable ${name}`);
  return value;
};

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function render(row: DigestRow, appUrl: string): { subject: string; html: string; text: string } {
  const name = escapeHtml((row.full_name || 'vecino').split(' ')[0]);
  const zone = escapeHtml(row.province || 'todo el país');
  const lines = [
    `${row.new_reports} ${row.new_reports === 1 ? 'reporte nuevo' : 'reportes nuevos'} en ${zone}`,
    `${row.resolved_reports} ${row.resolved_reports === 1 ? 'problema resuelto' : 'problemas resueltos'} en ${zone}`,
    `${row.my_updates} ${row.my_updates === 1 ? 'novedad' : 'novedades'} en tus reportes`,
    `${row.upcoming_events} ${row.upcoming_events === 1 ? 'jornada próxima' : 'jornadas próximas'} para sumarte`,
  ];
  if (row.points_week > 0) lines.push(`Ganaste ${row.points_week} puntos esta semana`);
  const subject = row.resolved_reports > 0
    ? `Tu semana en ConectaRD: ${row.resolved_reports} ${row.resolved_reports === 1 ? 'problema resuelto' : 'problemas resueltos'}`
    : 'Tu semana en ConectaRD';
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#fbfaf7;font-family:Arial,Helvetica,sans-serif;color:#13282b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e6e2d9;border-radius:20px" cellpadding="0" cellspacing="0">
      <tr><td style="padding:28px 28px 8px"><p style="margin:0;color:#00877f;font-weight:bold;font-size:13px;letter-spacing:.5px;text-transform:uppercase">Resumen semanal</p>
        <h1 style="margin:8px 0 0;font-size:24px">Hola, ${name}</h1>
        <p style="margin:8px 0 0;color:#4a5b5d;font-size:15px">Esto pasó en tu comunidad durante los últimos 7 días:</p></td></tr>
      <tr><td style="padding:12px 28px">${lines.map((line) => `<p style="margin:0 0 10px;padding:12px 14px;border-radius:12px;background:#f2f7f6;font-size:15px">${line}</p>`).join('')}</td></tr>
      <tr><td style="padding:8px 28px 28px"><a href="${appUrl}/inicio" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#13282b;color:#ffffff;text-decoration:none;font-weight:bold">Abrir ConectaRD</a>
        <p style="margin:18px 0 0;color:#8a9693;font-size:12px">Recibes este correo porque activaste el resumen semanal. Puedes desactivarlo en tu perfil, en “Privacidad y avisos”.</p></td></tr>
    </table></td></tr></table></body></html>`;
  const text = `Hola, ${row.full_name || 'vecino'}\n\n${lines.join('\n')}\n\nAbrir ConectaRD: ${appUrl}/inicio\n\nPuedes desactivar este resumen en tu perfil.`;
  return { subject, html, text };
}

Deno.serve(async (request) => {
  // Solo la tarea programada (o quien tenga el secreto) puede dispararlo.
  if (request.headers.get('x-cron-secret') !== env('CRON_SECRET')) {
    return new Response('No autorizado', { status: 401 });
  }

  const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc('weekly_digest_rows');
  if (error) return new Response(`Error leyendo el resumen: ${error.message}`, { status: 500 });

  const rows = (data ?? []) as DigestRow[];
  const appUrl = env('APP_URL').replace(/\/$/, '');
  let sent = 0;
  const failures: string[] = [];

  for (const row of rows) {
    // Sin novedades no se envía nada (no molestar).
    if (!row.new_reports && !row.resolved_reports && !row.my_updates && !row.upcoming_events) continue;
    const { subject, html, text } = render(row, appUrl);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('DIGEST_FROM'), to: [row.email], subject, html, text }),
    });
    if (response.ok) sent++;
    else failures.push(`${row.user_id}: ${response.status}`);
    // Resend permite unas 2 solicitudes por segundo en el plan gratuito.
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  return Response.json({ candidates: rows.length, sent, failures });
});
