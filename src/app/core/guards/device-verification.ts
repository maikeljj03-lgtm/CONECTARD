import { Router, UrlTree } from '@angular/router';
import type { User } from '@supabase/supabase-js';
import { AuthService, PENDING_LOGIN_EMAIL } from '../services/auth.service';

/**
 * Si la cuenta entra por primera vez desde este dispositivo (por ejemplo, al volver
 * de Google), cierra esa sesión, envía un código al correo y manda a la pantalla del código.
 * Devuelve null si el dispositivo ya está confirmado.
 */
export async function requireTrustedDevice(auth: AuthService, router: Router, user: User): Promise<UrlTree | null> {
  if (auth.isDeviceTrusted(user.id) || !user.email) return null;
  sessionStorage.setItem(PENDING_LOGIN_EMAIL, user.email);
  try {
    await auth.startDeviceVerification(user.email);
  } catch {
    // Si el envío falla (p. ej. límite de correos), la pantalla del código permite reenviarlo.
  }
  return router.createUrlTree(['/auth/verify-login']);
}
