import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { sessionGuard } from '../../core/guards/session.guard';
import { ExplorePage } from './pages/explore/explore.page';

// Pública: cualquiera puede ver los reportes; el guard solo resuelve la sesión.
const routes: Routes = [{ path: '', component: ExplorePage, canActivate: [sessionGuard] }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ExploreRoutingModule {}
