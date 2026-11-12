import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { ManagementRoutingModule } from './management-routing.module';
import { ManageReportsPage } from './pages/manage-reports/manage-reports.page';

/** Gestión de reportes: estados con historial (RF-16) y evidencia "Antes y Después" (RF-17). Lazy loading. */
@NgModule({
  declarations: [ManageReportsPage],
  imports: [SharedModule, ManagementRoutingModule],
})
export class ManagementModule {}
