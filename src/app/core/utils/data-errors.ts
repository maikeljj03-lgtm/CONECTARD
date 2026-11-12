/** Convierte errores de Supabase/PostgREST en mensajes claros en español. */
export function friendlyDataError(error: unknown): string {
  const candidate = error as { code?: string; message?: string; statusCode?: string | number; name?: string };
  const code = String(candidate?.code ?? '');
  const detail = String(candidate?.message ?? '');
  const lower = detail.toLowerCase();

  if (candidate?.name === 'AbortError') return 'El servidor no respondió. Revisa tu conexión e inténtalo otra vez.';
  // Tabla, vista o función inexistente: falta aplicar una migración.
  if (code === 'PGRST205' || code === '42P01' || code === '42703' || code === '42883' || code === 'PGRST202' || lower.includes('could not find the table') || lower.includes('could not find the function')) {
    return 'Falta aplicar una migración en Supabase. Ejecuta los archivos de supabase/migrations en el SQL Editor.';
  }
  if (lower.includes('bucket not found')) return 'Falta crear el almacenamiento de archivos. Ejecuta las migraciones de supabase/migrations.';
  if (code === '23505') return 'Ya tienes una solicitud pendiente de revisión.';
  if (code === '23514') return 'Algún dato no cumple el formato permitido. Revisa los campos e inténtalo otra vez.';
  if (code === '42501' || lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'No tienes permiso para realizar esta acción.';
  }
  if (lower.includes('payload too large') || lower.includes('maximum allowed size')) return 'El archivo es demasiado grande.';
  if (lower.includes('mime type') || lower.includes('invalid_mime_type')) return 'Ese tipo de archivo no está permitido.';
  if (lower.includes('fetch')) return 'No pudimos conectar con el servidor. Revisa tu conexión.';
  return detail || 'Ocurrió un error. Inténtalo de nuevo.';
}
