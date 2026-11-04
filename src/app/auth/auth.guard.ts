import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  try {
    const user = await auth.getCurrentUser();
    if (user?.email_confirmed_at) return true;
    if (user) await auth.signOut();
    return router.createUrlTree(['/auth/login'], {
      queryParams: user ? { unverified: '1' } : undefined,
    });
  } catch {
    return router.createUrlTree(['/auth/login']);
  }
};
