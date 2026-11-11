import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { AdminRoutingModule } from './admin-routing.module';
import { AdminVerificationsPage } from './pages/verifications/verifications.page';

/** Administración: revisión de solicitudes de verificación. Se carga solo al visitar la sección (lazy loading). */
@NgModule({
  declarations: [AdminVerificationsPage],
  imports: [SharedModule, AdminRoutingModule],
})
export class AdminModule {}
