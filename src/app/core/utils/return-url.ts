// Volver a la página de origen después de iniciar sesión (por ejemplo, al escanear el QR
// de una jornada sin tener la sesión abierta). Solo se aceptan rutas internas de la app.

const KEY = 'conectard.return-url';

/** Ruta interna segura: empieza con una sola "/" (nunca "//dominio" ni "https://..."). */
export function isSafeReturnUrl(value: string | null | undefined): value is string {
  return !!value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && !value.startsWith('/auth') && value.length <= 500;
}

export function rememberReturnUrl(url: string): void {
  if (!isSafeReturnUrl(url)) return;
  try {
    sessionStorage.setItem(KEY, url);
  } catch {
    // Sin almacenamiento: tras iniciar sesión irá al inicio.
  }
}

/** Devuelve la ruta guardada (una sola vez) o null. */
export function consumeReturnUrl(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return isSafeReturnUrl(value) ? value : null;
  } catch {
    return null;
  }
}
