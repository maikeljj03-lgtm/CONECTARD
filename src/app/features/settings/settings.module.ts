import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { SettingsPage } from './pages/settings/settings.page';
import { TwoFactorPage } from './pages/two-factor/two-factor.page';
import { SettingsRoutingModule } from './settings-routing.module';

/** Ajustes del módulo 8 (tema, idioma, app, alertas, 2FA, constancia) y el segundo paso al entrar. */
@NgModule({
  declarations: [SettingsPage, TwoFactorPage],
  imports: [SharedModule, SettingsRoutingModule],
})
export class SettingsModule {}
