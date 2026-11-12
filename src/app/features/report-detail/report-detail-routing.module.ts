import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { sessionGuard } from '../../core/guards/session.guard';
import { ReportDetailPage } from './pages/report-detail/report-detail.page';

// Pública (se comparte por WhatsApp y redes, RF-31); el guard solo resuelve la sesión.
const routes: Routes = [{ path: ':id', component: ReportDetailPage, canActivate: [sessionGuard] }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ReportDetailRoutingModule {}
