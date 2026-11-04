import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

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
