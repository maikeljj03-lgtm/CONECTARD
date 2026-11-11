import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { requireTrustedDevice } from './device-verification';

/**
 * Para páginas públicas: deja pasar siempre, pero antes resuelve la sesión
 * (incluido el regreso de Google con ?code=...) para mostrar al usuario.
 */
export const sessionGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const isAuthCallback = state.url.includes('code=');

  // Si la red social rechaza el acceso, Supabase vuelve con ?error_description=...
  // Se envía al login para mostrar un mensaje claro en vez de dejarlo en la URL.
  const params = new URLSearchParams(state.url.split('?')[1]?.split('#')[0] ?? '');
  const providerError = params.get('error_description') ?? params.get('error');
  if (providerError) {
    return router.createUrlTree(['/auth/login'], { queryParams: { auth_callback: 'failed', reason: providerError.slice(0, 200) } });
  }

  try {
    await auth.initialize();
    const user = await auth.getCurrentUser();
    if (user && !user.email_confirmed_at) {
      await auth.signOut('local');
      return router.createUrlTree(['/auth/login'], { queryParams: { unverified: '1' } });
    }
    if (user) {
      const verification = await requireTrustedDevice(auth, router, user);
      if (verification) return verification;
      auth.cacheAuthenticatedUser(user);
      // Al volver de Google (?code=...) se entra directo a la homepage.
      if (isAuthCallback) return router.createUrlTree(['/inicio']);
    }
    return true;
  } catch {
    // Si Supabase no responde, la página pública sigue funcionando sin sesión.
    return isAuthCallback
      ? router.createUrlTree(['/auth/login'], { queryParams: { auth_callback: 'failed' } })
      : true;
  }
};
