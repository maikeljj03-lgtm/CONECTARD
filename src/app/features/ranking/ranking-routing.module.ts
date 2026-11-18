import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { sessionGuard } from '../../core/guards/session.guard';
import { RankingPage } from './pages/ranking/ranking.page';

// Pública: el ranking lo ve cualquiera; el guard solo resuelve la sesión.
const routes: Routes = [{ path: '', component: RankingPage, canActivate: [sessionGuard] }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RankingRoutingModule {}
