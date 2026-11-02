import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(projectRoot, '.env');
const outputPath = path.join(projectRoot, 'src', 'assets', 'supabase-config.json');

let contents = '';
try {
  contents = await readFile(envPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const values = Object.fromEntries(contents.split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const separator = line.indexOf('=');
    if (separator < 0) return [line, ''];
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    return [line.slice(0, separator).trim(), value];
  }));

const supabaseUrl = (
  process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? process.env.SUPABASE_URL
  ?? values.NEXT_PUBLIC_SUPABASE_URL
  ?? values.SUPABASE_URL
)?.trim();
const supabasePublishableKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.SUPABASE_PUBLISHABLE_KEY
  ?? values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? values.SUPABASE_PUBLISHABLE_KEY
)?.trim();
if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Configura SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY (o sus variantes NEXT_PUBLIC_) en .env o en el entorno.');
}

let parsedUrl;
try {
  parsedUrl = new URL(supabaseUrl);
} catch {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL no es una URL válida.');
}
if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL debe ser una URL HTTP(S) válida sin credenciales.');
}
if (/YOUR_PROJECT_REF|YOUR_SUPABASE_URL|example\.supabase\.co/i.test(supabaseUrl)) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL todavía contiene un marcador de ejemplo. Usa la URL real de tu proyecto.');
}
if (/REPLACE_WITH_YOUR_KEY|YOUR_SUPABASE_KEY|PUBLISHABLE_KEY_HERE/i.test(supabasePublishableKey)) {
  throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY todavía contiene un marcador de ejemplo.');
}

await writeFile(outputPath, `${JSON.stringify({ supabaseUrl, supabasePublishableKey }, null, 2)}\n`, 'utf8');
console.log('Configuración pública de Supabase preparada para Ionic.');
