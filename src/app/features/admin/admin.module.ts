import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { AdminRoutingModule } from './admin-routing.module';
import { AdminNavComponent } from './components/admin-nav/admin-nav.component';
import { AdminUsersPage } from './pages/users/users.page';
import { AdminVerificationsPage } from './pages/verifications/verifications.page';
import { AdminVolunteersPage } from './pages/volunteers/volunteers.page';

/** Administración: verificaciones, voluntarios y roles (RF-03, RF-06). Solo administradores. */
@NgModule({
  declarations: [AdminVerificationsPage, AdminVolunteersPage, AdminUsersPage, AdminNavComponent],
  imports: [SharedModule, AdminRoutingModule],
})
export class AdminModule {}
