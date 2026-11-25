import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { UserRole } from '../models/profile.model';
import { RolesService } from '../services/roles.service';
import { SecurityService } from '../services/security.service';
import { isSafeReturnUrl } from '../utils/return-url';

/**
 * Deja pasar solo a los roles indicados; al resto lo manda a su perfil.
 * Usar después de authGuard. La base de datos vuelve a comprobar el rol en cada acción.
 */
export function roleGuard(...allowed: UserRole[]): CanActivateFn {
  return async (_route, state) => {
    // inject() solo funciona antes del primer await.
    const roles = inject(RolesService);
    const security = inject(SecurityService);
    const router = inject(Router);
    try {
      const role = await roles.currentRole(true);
      if (!role || !allowed.includes(role)) return router.createUrlTree(['/perfil'], { queryParams: { sinPermiso: 1 } });
      // RF-53: si la cuenta activó la verificación en dos pasos, estas zonas piden el código primero.
      const mfa = await security.status().catch(() => null);
      if (mfa?.needsCode) return router.createUrlTree(['/ajustes/dos-pasos'], { queryParams: { volver: isSafeReturnUrl(state.url) ? state.url : '/inicio' } });
      return true;
    } catch {
      return router.createUrlTree(['/perfil']);
    }
  };
}
