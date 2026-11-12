import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { authGuard } from '../../core/guards/auth.guard';
import { roleGuard } from '../../core/guards/role.guard';
import { sessionGuard } from '../../core/guards/session.guard';
import { EventDetailPage } from './pages/event-detail/event-detail.page';
import { EventFormPage } from './pages/event-form/event-form.page';
import { EventsListPage } from './pages/events-list/events-list.page';

// La lista y el detalle son públicos (se comparten); crear y editar, solo ONG, instituciones y administradores.
// El pase de lista por QR llega como /jornadas/:id?asistencia=<código>.
const organizers = [authGuard, roleGuard('organization', 'institution', 'administrator')];

const routes: Routes = [
  { path: '', component: EventsListPage, canActivate: [sessionGuard] },
  { path: 'nueva', component: EventFormPage, canActivate: organizers },
  { path: ':id', component: EventDetailPage, canActivate: [sessionGuard] },
  { path: ':id/editar', component: EventFormPage, canActivate: organizers },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class EventsRoutingModule {}
