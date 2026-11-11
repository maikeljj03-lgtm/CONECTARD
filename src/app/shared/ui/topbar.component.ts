import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ProfileService } from '../../core/data/profile.service';

/** Barra superior de las páginas internas (perfil, reportes, administración). */
@Component({
  selector: 'app-topbar',
  standalone: false,
  host: { class: 'app-topbar' },
  template: `
    <div class="app-topbar__inner">
      <a class="app-topbar__brand" routerLink="/landing" aria-label="ConectaRD, inicio"><app-logo [size]="30"></app-logo></a>
      <nav class="app-topbar__nav" aria-label="Navegación de la cuenta">
        <a routerLink="/reportes/nuevo" routerLinkActive="is-active"><app-icon name="camera"></app-icon><span>Nuevo reporte</span></a>
        <a routerLink="/perfil" routerLinkActive="is-active"><app-icon name="user"></app-icon><span>Mi perfil</span></a>
        @if (isAdmin) {
          <a routerLink="/admin/verificaciones" routerLinkActive="is-active"><app-icon name="shield-check"></app-icon><span>Verificaciones</span></a>
        }
      </nav>
      <button type="button" class="app-topbar__out" (click)="signOut()" aria-label="Cerrar sesión" title="Cerrar sesión"><app-icon name="log-out"></app-icon></button>
    </div>
  `,
})
export class TopbarComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  isAdmin = false;

  ngOnInit(): void {
    void this.profiles.getMyProfile()
      .then((profile) => {
        this.isAdmin = profile.role === 'administrator';
        this.changeDetector.markForCheck();
      })
      .catch(() => undefined);
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/landing', { replaceUrl: true });
  }
}
