import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { NOTIFICATION_ICONS, type AppNotification } from '../../../core/models/engagement.model';
import { NotificationsService } from '../../../core/services/notifications.service';
import { timeAgo } from '../../../core/utils/geo';

/** Campanita de la barra superior con el número sin leer y las últimas notificaciones (RF-36). */
@Component({
  selector: 'app-notification-bell',
  templateUrl: './notification-bell.component.html',
  styleUrls: ['./notification-bell.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  private readonly notifications = inject(NotificationsService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly subscriptions = new Subscription();

  readonly icons = NOTIFICATION_ICONS;
  items: AppNotification[] = [];
  unread = 0;
  open = false;
  /** Para animar la campanita cuando llega algo nuevo. */
  ringing = false;

  ngOnInit(): void {
    this.subscriptions.add(this.notifications.items$.subscribe((items) => {
      this.items = items.slice(0, 8);
      this.changeDetector.markForCheck();
    }));
    this.subscriptions.add(this.notifications.unread$.subscribe((count) => {
      if (count > this.unread && this.unread !== 0) this.ring();
      this.unread = count;
      this.changeDetector.markForCheck();
    }));
    void this.notifications.start();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get badge(): string {
    return this.unread > 99 ? '99+' : String(this.unread);
  }

  age(item: AppNotification): string {
    return timeAgo(item.created_at);
  }

  toggle(): void {
    this.open = !this.open;
    if (this.open) void this.notifications.refresh().catch(() => undefined);
  }

  async select(item: AppNotification): Promise<void> {
    this.open = false;
    await this.notifications.open(item);
  }

  async markAll(): Promise<void> {
    await this.notifications.markAllRead().catch(() => undefined);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) {
      this.open = false;
      this.changeDetector.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  close(): void {
    if (this.open) {
      this.open = false;
      this.changeDetector.markForCheck();
    }
  }

  private ring(): void {
    this.ringing = true;
    setTimeout(() => {
      this.ringing = false;
      this.changeDetector.markForCheck();
    }, 1200);
  }
}
