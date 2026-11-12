import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { ReportsRoutingModule } from './reports-routing.module';
import { EditReportPage } from './pages/edit-report/edit-report.page';
import { MyReportsPage } from './pages/my-reports/my-reports.page';
import { NewReportPage } from './pages/new-report/new-report.page';

/** Reportes ciudadanos: crear (RF-08 a RF-14), y ver, editar o eliminar los propios (RF-15). Lazy loading. */
@NgModule({
  declarations: [NewReportPage, MyReportsPage, EditReportPage],
  imports: [SharedModule, ReportsRoutingModule],
})
export class ReportsModule {}
