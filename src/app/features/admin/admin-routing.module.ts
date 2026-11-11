import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminVerificationsPage } from './pages/verifications/verifications.page';

const routes: Routes = [
  { path: '', redirectTo: 'verificaciones', pathMatch: 'full' },
  // El permiso real lo controla la base de datos (is_admin); la página solo lo refleja.
  { path: 'verificaciones', component: AdminVerificationsPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminRoutingModule {}
