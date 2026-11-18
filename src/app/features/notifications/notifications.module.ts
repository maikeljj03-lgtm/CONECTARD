import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { NotificationsRoutingModule } from './notifications-routing.module';
import { NotificationsPage } from './pages/notifications/notifications.page';

/** Centro de notificaciones (RF-36) y avisos del navegador (RF-34). Lazy loading. */
@NgModule({
  declarations: [NotificationsPage],
  imports: [SharedModule, NotificationsRoutingModule],
})
export class NotificationsModule {}
