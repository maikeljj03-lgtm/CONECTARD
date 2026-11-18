import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationsService } from '../../../core/services/notifications.service';
import { RolesService } from '../../../core/services/roles.service';

/** Barra superior de las páginas internas. Las opciones dependen del rol (*appCan). */
@Component({
  selector: 'app-topbar',
  standalone: false,
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.scss'],
  host: { class: 'app-topbar' },
})
export class TopbarComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly roles = inject(RolesService);
  private readonly notifications = inject(NotificationsService);
  private readonly router = inject(Router);
  private readonly admin = inject(AdminService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  /** La cuenta está bloqueada por la moderación (RF-39): se avisa arriba de todo. */
  blocked = false;
  private static blockedCache: { at: number; value: boolean } | null = null;

  async ngOnInit(): Promise<void> {
    // Se consulta como máximo una vez por minuto (la barra aparece en todas las páginas).
    const cache = TopbarComponent.blockedCache;
    if (cache && Date.now() - cache.at < 60_000) {
      this.blocked = cache.value;
      return;
    }
    this.blocked = await this.admin.amIBlocked().catch(() => false);
    TopbarComponent.blockedCache = { at: Date.now(), value: this.blocked };
    this.changeDetector.markForCheck();
  }

  async signOut(): Promise<void> {
    await this.notifications.stop().catch(() => undefined);
    await this.auth.signOut();
    this.roles.clearCache();
    TopbarComponent.blockedCache = null;
    await this.router.navigateByUrl('/landing', { replaceUrl: true });
  }
}
