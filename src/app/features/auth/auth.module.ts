import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { AuthRoutingModule } from './auth-routing.module';
import { AuthPage } from './pages/auth/auth.page';
import { SocialLoginComponent } from './components/social-login/social-login.component';

/** Inicio de sesión, registro, verificación por código y recuperación de contraseña. Se carga solo al visitar la sección (lazy loading). */
@NgModule({
  declarations: [AuthPage, SocialLoginComponent],
  imports: [SharedModule, AuthRoutingModule],
})
export class AuthModule {}
