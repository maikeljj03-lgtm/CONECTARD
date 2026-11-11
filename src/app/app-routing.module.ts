import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { authGuard, sessionGuard } from './core/auth/auth.guard';
import { AdminVerificationsPage } from './features/admin/pages/admin-verifications.page';
import { AuthPage } from './features/auth/pages/auth.page';
import { LandingPage } from './features/landing/pages/landing.page';
import { ProfilePage } from './features/profile/pages/profile.page';
import { NewReportPage } from './features/reports/pages/new-report.page';
import { VerificationPage } from './features/verification/pages/verification.page';

const routes: Routes = [
  { path: '', redirectTo: 'landing', pathMatch: 'full' },
  { path: 'auth/:mode', component: AuthPage },
  // Pública: el mapa, el feed y las métricas son visibles para todos (matriz de roles).
  { path: 'landing', component: LandingPage, canActivate: [sessionGuard] },
  { path: 'perfil', component: ProfilePage, canActivate: [authGuard] },
  { path: 'verificacion', component: VerificationPage, canActivate: [authGuard] },
  { path: 'reportes/nuevo', component: NewReportPage, canActivate: [authGuard] },
  // El permiso real lo controla la base de datos (is_admin); la página solo lo refleja.
  { path: 'admin/verificaciones', component: AdminVerificationsPage, canActivate: [authGuard] },
  { path: 'home', redirectTo: 'landing', pathMatch: 'full' },
  { path: '**', redirectTo: 'landing' }
];
@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
