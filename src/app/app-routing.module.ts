import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

// Cada sección es un módulo que se descarga al visitarla (lazy loading).
// Las privadas exigen sesión con correo confirmado (authGuard).
const routes: Routes = [
  { path: '', redirectTo: 'landing', pathMatch: 'full' },
  { path: 'landing', loadChildren: () => import('./features/landing/landing.module').then((m) => m.LandingModule) },
  { path: 'auth', loadChildren: () => import('./features/auth/auth.module').then((m) => m.AuthModule) },
  { path: 'perfil', canActivate: [authGuard], loadChildren: () => import('./features/profile/profile.module').then((m) => m.ProfileModule) },
  { path: 'verificacion', canActivate: [authGuard], loadChildren: () => import('./features/verification/verification.module').then((m) => m.VerificationModule) },
  { path: 'reportes', canActivate: [authGuard], loadChildren: () => import('./features/reports/reports.module').then((m) => m.ReportsModule) },
  { path: 'admin', canActivate: [authGuard], loadChildren: () => import('./features/admin/admin.module').then((m) => m.AdminModule) },
  { path: 'home', redirectTo: 'landing', pathMatch: 'full' },
  { path: '**', redirectTo: 'landing' },
];

@NgModule({
  // Tras cargar la primera página, descarga el resto en segundo plano para que navegar sea instantáneo.
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
