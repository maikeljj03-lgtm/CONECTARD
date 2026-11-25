import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SettingsPage } from './pages/settings/settings.page';
import { TwoFactorPage } from './pages/two-factor/two-factor.page';

const routes: Routes = [
  { path: '', component: SettingsPage },
  { path: 'dos-pasos', component: TwoFactorPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SettingsRoutingModule {}
