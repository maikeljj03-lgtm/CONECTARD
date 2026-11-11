import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { AuthRoutingModule } from './auth-routing.module';
import { AuthPage } from './pages/auth/auth.page';

/** Inicio de sesión, registro, verificación por código y recuperación de contraseña. Se carga solo al visitar la sección (lazy loading). */
@NgModule({
  declarations: [AuthPage],
  imports: [SharedModule, AuthRoutingModule],
})
export class AuthModule {}
