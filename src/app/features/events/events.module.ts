import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { EventsRoutingModule } from './events-routing.module';
import { EventDetailPage } from './pages/event-detail/event-detail.page';
import { EventFormPage } from './pages/event-form/event-form.page';
import { EventsListPage } from './pages/events-list/events-list.page';

/** Jornadas comunitarias (RF-27) con inscripción y pase de lista por código QR (RF-28). Lazy loading. */
@NgModule({
  declarations: [EventsListPage, EventDetailPage, EventFormPage],
  imports: [SharedModule, EventsRoutingModule],
})
export class EventsModule {}
