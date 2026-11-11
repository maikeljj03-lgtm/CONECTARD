import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { LegalRoutingModule } from './legal-routing.module';
import { LegalPage } from './pages/legal/legal.page';

/** Términos de uso y Política de privacidad (RF-50). Páginas públicas. */
@NgModule({
  declarations: [LegalPage],
  imports: [SharedModule, LegalRoutingModule],
})
export class LegalModule {}
