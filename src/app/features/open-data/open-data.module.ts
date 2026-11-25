import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { OpenDataRoutingModule } from './open-data-routing.module';
import { OpenDataPage } from './pages/open-data/open-data.page';
import { VerifyCertificatePage } from './pages/verify-certificate/verify-certificate.page';

/** Datos abiertos (RF-57) y verificación pública de constancias (RF-62). */
@NgModule({
  declarations: [OpenDataPage, VerifyCertificatePage],
  imports: [SharedModule, OpenDataRoutingModule],
})
export class OpenDataModule {}
