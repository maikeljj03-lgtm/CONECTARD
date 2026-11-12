import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { ReportDetailRoutingModule } from './report-detail-routing.module';
import { ReportDetailPage } from './pages/report-detail/report-detail.page';

/** Página completa de un reporte: apoyos, conversación, voluntarios, jornadas, insumos y compartir (módulo 4). */
@NgModule({
  declarations: [ReportDetailPage],
  imports: [SharedModule, ReportDetailRoutingModule],
})
export class ReportDetailModule {}
