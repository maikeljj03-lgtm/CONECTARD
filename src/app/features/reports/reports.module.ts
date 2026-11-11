import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { ReportsRoutingModule } from './reports-routing.module';
import { NewReportPage } from './pages/new-report/new-report.page';

/** Reportes ciudadanos (RF-07 y, más adelante, el resto del módulo 2). Se carga solo al visitar la sección (lazy loading). */
@NgModule({
  declarations: [NewReportPage],
  imports: [SharedModule, ReportsRoutingModule],
})
export class ReportsModule {}
