import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { OpenDataPage } from './pages/open-data/open-data.page';
import { VerifyCertificatePage } from './pages/verify-certificate/verify-certificate.page';

// Páginas públicas: no piden sesión.
const routes: Routes = [
  { path: 'datos-abiertos', component: OpenDataPage, title: 'Datos abiertos · ConectaRD' },
  { path: 'verificar', component: VerifyCertificatePage, title: 'Verificar constancia · ConectaRD' },
  { path: 'verificar/:codigo', component: VerifyCertificatePage, title: 'Verificar constancia · ConectaRD' },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class OpenDataRoutingModule {}
