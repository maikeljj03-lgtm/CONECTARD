import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

// Cada sección es un módulo que se descarga al visitarla (lazy loading).
// Las privadas exigen sesión con correo confirmado (authGuard).
const routes: Routes = [
  { path: '', redirectTo: 'landing', pathMatch: 'full' },
  { path: 'landing', loadChildren: () => import('./features/landing/landing.module').then((m) => m.LandingModule) },
  { path: 'auth', loadChildren: () => import('./features/auth/auth.module').then((m) => m.AuthModule) },
  // Públicas (RF-50): las redes sociales piden enlazarlas para abrir el inicio de sesión al público.
  { path: 'terminos', data: { document: 'terminos' }, loadChildren: () => import('./features/legal/legal.module').then((m) => m.LegalModule) },
  { path: 'privacidad', data: { document: 'privacidad' }, loadChildren: () => import('./features/legal/legal.module').then((m) => m.LegalModule) },
  // Pública: el mapa y la lista de reportes los ve cualquiera (matriz de roles).
  { path: 'explorar', loadChildren: () => import('./features/explore/explore.module').then((m) => m.ExploreModule) },
  // Inicio de la persona con sesión (homepage).
  { path: 'inicio', canActivate: [authGuard], loadChildren: () => import('./features/home/home.module').then((m) => m.HomeModule) },
  { path: 'perfil', canActivate: [authGuard], loadChildren: () => import('./features/profile/profile.module').then((m) => m.ProfileModule) },
  { path: 'verificacion', canActivate: [authGuard], loadChildren: () => import('./features/verification/verification.module').then((m) => m.VerificationModule) },
  { path: 'reportes', canActivate: [authGuard], loadChildren: () => import('./features/reports/reports.module').then((m) => m.ReportsModule) },
  { path: 'admin', canActivate: [authGuard, roleGuard('administrator')], loadChildren: () => import('./features/admin/admin.module').then((m) => m.AdminModule) },
  { path: 'home', redirectTo: 'inicio', pathMatch: 'full' },
  { path: '**', redirectTo: 'landing' },
];

@NgModule({
  // Tras cargar la primera página, descarga el resto en segundo plano para que navegar sea instantáneo.
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
