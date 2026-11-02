import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(projectRoot, '.env');
const templatePath = path.join(projectRoot, 'supabase', 'templates', 'confirmation.html');

let envContents = '';
try {
  envContents = await readFile(envPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const fileValues = Object.fromEntries(envContents.split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const separator = line.indexOf('=');
    if (separator < 0) return [line, ''];
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    return [line.slice(0, separator).trim(), value];
  }));

const supabaseUrl = (process.env.SUPABASE_URL
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? fileValues.SUPABASE_URL
  ?? fileValues.NEXT_PUBLIC_SUPABASE_URL)?.trim();
const accessToken = (process.env.SUPABASE_ACCESS_TOKEN ?? fileValues.SUPABASE_ACCESS_TOKEN)?.trim();

if (!supabaseUrl) throw new Error('Falta SUPABASE_URL en .env o en el entorno.');
if (!accessToken) {
  throw new Error('Falta SUPABASE_ACCESS_TOKEN. Añade un token de Management API con permisos auth_config_write y project_admin_write.');
}

const projectHost = new URL(supabaseUrl).hostname;
const projectRefMatch = projectHost.match(/^([a-z0-9]+)\.supabase\.co$/i);
if (!projectRefMatch) {
  throw new Error('No se pudo extraer el project ref de SUPABASE_URL; usa el dominio estándar <project-ref>.supabase.co.');
}

const content = await readFile(templatePath, 'utf8');
if (!content.includes('{{ .ConfirmationURL }}')) {
  throw new Error('La plantilla debe incluir {{ .ConfirmationURL }} para que el enlace de confirmación funcione.');
}

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRefMatch[1]}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    mailer_subjects_confirmation: 'Confirma tu correo | ConectaRD',
    mailer_templates_confirmation_content: content,
  }),
});

if (!response.ok) {
  let errorCode = '';
  try {
    const error = await response.json();
    errorCode = error.code ?? error.error_code ?? '';
  } catch {
    // Do not print response bodies; they can include project configuration.
  }
  throw new Error(`Supabase rechazó la actualización de la plantilla (HTTP ${response.status}${errorCode ? `, ${errorCode}` : ''}). Revisa los permisos del token.`);
}

console.log('Plantilla de confirmación de ConectaRD actualizada en Supabase.');
