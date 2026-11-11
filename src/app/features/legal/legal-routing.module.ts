import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LegalPage } from './pages/legal/legal.page';

// El documento a mostrar ('terminos' o 'privacidad') llega en data desde app-routing.
const routes: Routes = [
  { path: '', component: LegalPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class LegalRoutingModule {}
