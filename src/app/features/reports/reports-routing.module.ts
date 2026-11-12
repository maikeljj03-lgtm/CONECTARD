import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { EditReportPage } from './pages/edit-report/edit-report.page';
import { MyReportsPage } from './pages/my-reports/my-reports.page';
import { NewReportPage } from './pages/new-report/new-report.page';

const routes: Routes = [
  { path: '', redirectTo: 'nuevo', pathMatch: 'full' },
  { path: 'nuevo', component: NewReportPage },
  { path: 'mios', component: MyReportsPage },
  { path: ':id/editar', component: EditReportPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ReportsRoutingModule {}
