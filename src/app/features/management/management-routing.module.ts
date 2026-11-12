import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ManageReportsPage } from './pages/manage-reports/manage-reports.page';

// Solo instituciones y administradores (roleGuard en app-routing).
// La base de datos vuelve a comprobar la jurisdicción en cada cambio (set_report_status).
const routes: Routes = [{ path: '', component: ManageReportsPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ManagementRoutingModule {}
