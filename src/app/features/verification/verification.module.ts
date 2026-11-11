import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { VerificationRoutingModule } from './verification-routing.module';
import { VerificationPage } from './pages/verification/verification.page';

/** Solicitud de verificación de organizaciones e instituciones (RF-06). Se carga solo al visitar la sección (lazy loading). */
@NgModule({
  declarations: [VerificationPage],
  imports: [SharedModule, VerificationRoutingModule],
})
export class VerificationModule {}
