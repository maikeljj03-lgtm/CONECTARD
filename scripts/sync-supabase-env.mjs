import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(projectRoot, '.env');
const outputPath = path.join(projectRoot, 'src', 'assets', 'supabase-config.json');

let contents;
try {
  contents = await readFile(envPath, 'utf8');
} catch {
  throw new Error('No se encontró .env. Añade NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
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

const supabaseUrl = values.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Falta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en .env.');
}

await writeFile(outputPath, `${JSON.stringify({ supabaseUrl, supabasePublishableKey }, null, 2)}\n`, 'utf8');
console.log('Configuración pública de Supabase preparada para Ionic.');
