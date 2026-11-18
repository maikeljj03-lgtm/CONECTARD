import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { NOTIFICATION_ICONS, type AppNotification } from '../../../../core/models/engagement.model';
import { NotificationsService } from '../../../../core/services/notifications.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { timeAgo } from '../../../../core/utils/geo';

type Filter = 'todas' | 'sin_leer';

/** Centro de notificaciones (RF-36) y activación de avisos del navegador (RF-34). */
@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: false,
})
export class NotificationsPage implements OnInit, OnDestroy {
  readonly notifications = inject(NotificationsService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly subscriptions = new Subscription();

  readonly icons = NOTIFICATION_ICONS;
  items: AppNotification[] = [];
  unread = 0;
  loading = true;
  filter: Filter = 'todas';
  error = '';
  browserEnabled = false;

  async ngOnInit(): Promise<void> {
    this.browserEnabled = this.notifications.browserEnabled;
    this.subscriptions.add(this.notifications.items$.subscribe((items) => {
      this.items = items;
      this.changeDetector.markForCheck();
    }));
    this.subscriptions.add(this.notifications.unread$.subscribe((count) => {
      this.unread = count;
      this.changeDetector.markForCheck();
    }));
    try {
      await this.notifications.start();
      await this.notifications.refresh();
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get visible(): AppNotification[] {
    return this.filter === 'sin_leer' ? this.items.filter((item) => !item.read_at) : this.items;
  }

  age(item: AppNotification): string {
    return timeAgo(item.created_at);
  }

  async open(item: AppNotification): Promise<void> {
    await this.notifications.open(item).catch((error) => (this.error = friendlyDataError(error)));
  }

  async markAll(): Promise<void> {
    await this.notifications.markAllRead().catch((error) => (this.error = friendlyDataError(error)));
  }

  async remove(item: AppNotification, event: Event): Promise<void> {
    event.stopPropagation();
    await this.notifications.remove(item).catch((error) => (this.error = friendlyDataError(error)));
  }

  async toggleBrowser(): Promise<void> {
    if (this.browserEnabled) {
      this.notifications.disableBrowser();
      this.browserEnabled = false;
    } else {
      this.browserEnabled = await this.notifications.enableBrowser();
      if (!this.browserEnabled) this.error = 'El navegador no dio permiso para mostrar avisos. Puedes activarlo en la configuración del sitio (ícono del candado).';
    }
    this.changeDetector.markForCheck();
  }
}
