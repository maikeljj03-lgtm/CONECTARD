import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthPage } from './auth/auth.page';
import { authGuard } from './auth/auth.guard';
import { HomePage } from './home/home.page';

const routes: Routes = [
  { path: '', redirectTo: 'auth/login', pathMatch: 'full' },
  { path: 'auth/:mode', component: AuthPage },
  { path: 'home', component: HomePage, canActivate: [authGuard] },
  { path: '**', redirectTo: 'auth/login' }
];
@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
