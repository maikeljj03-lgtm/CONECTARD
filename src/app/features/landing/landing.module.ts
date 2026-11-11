import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { LandingRoutingModule } from './landing-routing.module';
import { LandingPage } from './pages/landing/landing.page';

/** Página principal pública (RF-66). Se carga solo al visitar la sección (lazy loading). */
@NgModule({
  declarations: [LandingPage],
  imports: [SharedModule, LandingRoutingModule],
})
export class LandingModule {}
