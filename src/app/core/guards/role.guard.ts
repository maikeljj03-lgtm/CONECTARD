import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { UserRole } from '../models/profile.model';
import { RolesService } from '../services/roles.service';

/**
 * Deja pasar solo a los roles indicados; al resto lo manda a su perfil.
 * Usar después de authGuard. La base de datos vuelve a comprobar el rol en cada acción.
 */
export function roleGuard(...allowed: UserRole[]): CanActivateFn {
  return async () => {
    // inject() solo funciona antes del primer await.
    const roles = inject(RolesService);
    const router = inject(Router);
    try {
      const role = await roles.currentRole(true);
      return role && allowed.includes(role) ? true : router.createUrlTree(['/perfil'], { queryParams: { sinPermiso: 1 } });
    } catch {
      return router.createUrlTree(['/perfil']);
    }
  };
}
