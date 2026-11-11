import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { RolesService } from '../../../core/services/roles.service';

/** Barra superior de las páginas internas. Las opciones dependen del rol (*appCan). */
@Component({
  selector: 'app-topbar',
  standalone: false,
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.scss'],
  host: { class: 'app-topbar' },
})
export class TopbarComponent {
  private readonly auth = inject(AuthService);
  private readonly roles = inject(RolesService);
  private readonly router = inject(Router);

  async signOut(): Promise<void> {
    await this.auth.signOut();
    this.roles.clearCache();
    await this.router.navigateByUrl('/landing', { replaceUrl: true });
  }
}
