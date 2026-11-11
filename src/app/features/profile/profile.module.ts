import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { ProfileRoutingModule } from './profile-routing.module';
import { ProfilePage } from './pages/profile/profile.page';

/** Mi perfil (RF-05). Se carga solo al visitar la sección (lazy loading). */
@NgModule({
  declarations: [ProfilePage],
  imports: [SharedModule, ProfileRoutingModule],
})
export class ProfileModule {}
