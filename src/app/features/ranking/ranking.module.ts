import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { RankingPage } from './pages/ranking/ranking.page';
import { RankingRoutingModule } from './ranking-routing.module';

/** Ranking comunitario (RF-38). Lazy loading. */
@NgModule({
  declarations: [RankingPage],
  imports: [SharedModule, RankingRoutingModule],
})
export class RankingModule {}
