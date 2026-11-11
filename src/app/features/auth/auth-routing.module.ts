import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthPage } from './pages/auth/auth.page';

const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  // /auth/login, /auth/register, /auth/verify-email, /auth/verify-login, /auth/forgot-password, /auth/reset-password
  { path: ':mode', component: AuthPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AuthRoutingModule {}
