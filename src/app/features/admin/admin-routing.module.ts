import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminUsersPage } from './pages/users/users.page';
import { AdminVerificationsPage } from './pages/verifications/verifications.page';
import { AdminVolunteersPage } from './pages/volunteers/volunteers.page';

// Toda la sección exige rol de administrador (roleGuard en app-routing).
// La base de datos vuelve a comprobarlo en cada acción (is_admin).
const routes: Routes = [
  { path: '', redirectTo: 'verificaciones', pathMatch: 'full' },
  { path: 'verificaciones', component: AdminVerificationsPage },
  { path: 'voluntarios', component: AdminVolunteersPage },
  { path: 'usuarios', component: AdminUsersPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminRoutingModule {}
