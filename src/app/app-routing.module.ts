import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { AuthPage } from './features/auth/pages/auth.page';
import { LandingPage } from './features/landing/pages/landing.page';

const routes: Routes = [
  { path: '', redirectTo: 'auth/login', pathMatch: 'full' },
  { path: 'auth/:mode', component: AuthPage },
  { path: 'landing', component: LandingPage, canActivate: [authGuard] },
  { path: 'home', redirectTo: 'landing', pathMatch: 'full' },
  { path: '**', redirectTo: 'auth/login' }
];
@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
