import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { HomeRoutingModule } from './home-routing.module';
import { HomePage } from './pages/home/home.page';

/** Inicio de la persona con sesión: su comunidad en 3D, cifras reales y reportes cercanos. */
@NgModule({
  declarations: [HomePage],
  imports: [SharedModule, HomeRoutingModule],
})
export class HomeModule {}
