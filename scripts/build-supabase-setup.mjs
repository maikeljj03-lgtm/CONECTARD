// Genera supabase/setup-completo.sql uniendo todas las migraciones en orden.
// Uso: npm.cmd run supabase:setup
// Ese archivo es el que se pega en Supabase → SQL Editor. No lo edites a mano:
// cambia la migración correspondiente y vuelve a ejecutar este script.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(projectRoot, 'supabase', 'migrations');
const outputPath = path.join(projectRoot, 'supabase', 'setup-completo.sql');

const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
if (!files.length) {
  console.error('No hay migraciones en supabase/migrations.');
  process.exit(1);
}

const header = [
  '-- ============================================================================',
  '-- ConectaRD · Configuración completa de la base de datos (Supabase)',
  '-- Pega TODO este archivo en Supabase → SQL Editor → New query → Run.',
  '-- Es seguro ejecutarlo varias veces: cada parte usa IF NOT EXISTS / DROP IF EXISTS.',
  '-- ARCHIVO GENERADO por scripts/build-supabase-setup.mjs a partir de supabase/migrations.',
  '-- No lo edites a mano: cambia la migración y ejecuta "npm.cmd run supabase:setup".',
  '-- ============================================================================',
].join('\n');

const sections = [];
for (const name of files) {
  const sql = (await readFile(path.join(migrationsDir, name), 'utf8')).trimEnd();
  sections.push([
    '-- ----------------------------------------------------------------------------',
    `-- ${name}`,
    '-- ----------------------------------------------------------------------------',
    sql,
  ].join('\n'));
}

await writeFile(outputPath, `${header}\n\n\n${sections.join('\n\n\n')}\n`, 'utf8');
console.log(`supabase/setup-completo.sql generado con ${files.length} migraciones.`);
