import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Exige una sesión con correo confirmado. Para pantallas privadas. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  try {
    // The app can return from Supabase directly to /landing with ?code=...
    // Wait for Supabase to exchange that PKCE code before checking the user.
    await auth.initialize();
    const user = await auth.getCurrentUser();
    if (user?.email_confirmed_at) {
      auth.cacheAuthenticatedUser(user);
      return true;
    }
    if (user) await auth.signOut();
    return router.createUrlTree(['/auth/login'], {
      queryParams: {
        ...(user ? { unverified: '1' } : {}),
        ...(state.url.includes('code=') ? { auth_callback: 'failed' } : {}),
      },
    });
  } catch {
    return router.createUrlTree(['/auth/login'], {
      queryParams: state.url.includes('code=') ? { auth_callback: 'failed' } : undefined,
    });
  }
};

/**
 * Para páginas públicas: deja pasar siempre, pero antes resuelve la sesión
 * (incluido el regreso de Google con ?code=...) para mostrar al usuario.
 */
export const sessionGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const isAuthCallback = state.url.includes('code=');

  try {
    await auth.initialize();
    const user = await auth.getCurrentUser();
    if (user && !user.email_confirmed_at) {
      await auth.signOut('local');
      return router.createUrlTree(['/auth/login'], { queryParams: { unverified: '1' } });
    }
    if (user) auth.cacheAuthenticatedUser(user);
    return true;
  } catch {
    // Si Supabase no responde, la página pública sigue funcionando sin sesión.
    return isAuthCallback
      ? router.createUrlTree(['/auth/login'], { queryParams: { auth_callback: 'failed' } })
      : true;
  }
};
