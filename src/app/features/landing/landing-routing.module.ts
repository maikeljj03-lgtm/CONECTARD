import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { sessionGuard } from '../../core/guards/session.guard';
import { LandingPage } from './pages/landing/landing.page';

const routes: Routes = [
  // Pública: el mapa y la información se ven sin cuenta; el guard solo resuelve la sesión.
  { path: '', component: LandingPage, canActivate: [sessionGuard] },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class LandingRoutingModule {}
