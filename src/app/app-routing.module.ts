import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthPage } from './auth/auth.page';
import { authGuard } from './auth/auth.guard';
import { LandingPage } from './landing/landing.page';

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
