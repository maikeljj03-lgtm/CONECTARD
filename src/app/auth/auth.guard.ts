import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  try {
    return await auth.getCurrentUser() ? true : router.createUrlTree(['/auth/login']);
  } catch {
    return router.createUrlTree(['/auth/login']);
  }
};
