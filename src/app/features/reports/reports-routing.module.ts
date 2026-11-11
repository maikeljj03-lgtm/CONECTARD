import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { NewReportPage } from './pages/new-report/new-report.page';

const routes: Routes = [
  { path: '', redirectTo: 'nuevo', pathMatch: 'full' },
  { path: 'nuevo', component: NewReportPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ReportsRoutingModule {}
