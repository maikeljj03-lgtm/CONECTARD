import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { ExploreRoutingModule } from './explore-routing.module';
import { ExplorePage } from './pages/explore/explore.page';

/** Explorar: mapa y lista de reportes reales con filtros (RF-18 a RF-23). */
@NgModule({
  declarations: [ExplorePage],
  imports: [SharedModule, ExploreRoutingModule],
})
export class ExploreModule {}
