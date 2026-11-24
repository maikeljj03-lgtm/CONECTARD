import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivationEnd, NavigationEnd, Router } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import type { AdminDashboard } from '../../../../core/models/admin.model';
import { AdminService } from '../../../../core/services/admin.service';
import { AuthService } from '../../../../core/services/auth.service';
import { NotificationsService } from '../../../../core/services/notifications.service';
import { ProfileService } from '../../../../core/services/profile.service';
import { RolesService } from '../../../../core/services/roles.service';

interface NavItem {
  path: string;
  icon: string;
  label: string;
  badge?: keyof AdminDashboard['queues'];
}

/** Consola de administración: menú lateral, encabezado y contenido (RF-39). */
@Component({
  selector: 'app-admin-shell',
  templateUrl: './admin-shell.component.html',
  styleUrls: ['./admin-shell.component.scss'],
  standalone: false,
})
export class AdminShellComponent implements OnInit, OnDestroy {
  private readonly admin = inject(AdminService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly roles = inject(RolesService);
  private readonly notifications = inject(NotificationsService);
  private readonly profiles = inject(ProfileService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private subscription?: Subscription;

  readonly groups: { title: string; items: NavItem[] }[] = [
    { title: 'General', items: [{ path: 'resumen', icon: 'bar-chart', label: 'Resumen' }] },
    {
      title: 'Gestión',
      items: [
        { path: 'usuarios', icon: 'users', label: 'Usuarios' },
        { path: 'reportes', icon: 'file-text', label: 'Reportes', badge: 'stale_reports' },
      ],
    },
    {
      title: 'Moderación',
      items: [
        { path: 'denuncias', icon: 'flag', label: 'Denuncias', badge: 'flags' },
        { path: 'verificaciones', icon: 'shield-check', label: 'Verificaciones', badge: 'verifications' },
        { path: 'voluntarios', icon: 'heart', label: 'Voluntarios', badge: 'volunteers' },
      ],
    },
    { title: 'Control', items: [{ path: 'auditoria', icon: 'history', label: 'Auditoría' }] },
  ];

  queues: AdminDashboard['queues'] | null = null;
  title = '';
  subtitle = '';
  myName = '';
  readonly today = new Date();

  async ngOnInit(): Promise<void> {
    this.readTitle();
    this.subscription = this.router.events.pipe(filter((event) => event instanceof NavigationEnd || event instanceof ActivationEnd)).subscribe((event) => {
      if (event instanceof ActivationEnd) {
        this.readTitle();
        return;
      }
      this.readTitle();
      void this.loadQueues();
    });
    const [profile] = await Promise.allSettled([this.profiles.getMyProfile(), this.loadQueues()]);
    if (profile.status === 'fulfilled') this.myName = profile.value.full_name;
    this.changeDetector.markForCheck();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  badge(item: NavItem): number {
    return item.badge && this.queues ? this.queues[item.badge] ?? 0 : 0;
  }

  async signOut(): Promise<void> {
    await this.notifications.stop().catch(() => undefined);
    await this.auth.signOut();
    this.roles.clearCache();
    await this.router.navigateByUrl('/landing', { replaceUrl: true });
  }

  private async loadQueues(): Promise<void> {
    try {
      this.queues = (await this.admin.dashboard()).queues;
    } catch {
      this.queues = null;
    }
    this.changeDetector.markForCheck();
  }

  /** Título de la sección activa: el de la ruta más profunda (se lee desde la raíz, sin depender del momento de carga). */
  private readTitle(): void {
    let snapshot = this.router.routerState.snapshot.root;
    while (snapshot.firstChild) snapshot = snapshot.firstChild;
    this.title = (snapshot.data['title'] as string) ?? 'Administración';
    this.subtitle = (snapshot.data['subtitle'] as string) ?? '';
    this.changeDetector.markForCheck();
  }
}
