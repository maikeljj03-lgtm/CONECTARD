import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { BottomNavComponent } from './components/bottom-nav/bottom-nav.component';
import { CommunitySceneComponent } from './components/community-scene/community-scene.component';
import { IconComponent } from './components/icon/icon.component';
import { LogoComponent } from './components/logo/logo.component';
import { ReportCardComponent } from './components/report-card/report-card.component';
import { ReportPreviewComponent } from './components/report-preview/report-preview.component';
import { SkylineComponent } from './components/skyline/skyline.component';
import { TopbarComponent } from './components/topbar/topbar.component';
import { CanDirective } from './directives/can.directive';

const COMPONENTS = [
  IconComponent, LogoComponent, SkylineComponent, TopbarComponent, BottomNavComponent,
  CommunitySceneComponent, ReportCardComponent, ReportPreviewComponent, CanDirective,
];

/**
 * Lo que todas las páginas necesitan: componentes de la marca y módulos comunes.
 * Cada módulo de feature importa SharedModule y nada más de esta lista.
 */
@NgModule({
  declarations: COMPONENTS,
  imports: [CommonModule, RouterModule, IonicModule],
  exports: [...COMPONENTS, CommonModule, ReactiveFormsModule, RouterModule, IonicModule],
})
export class SharedModule {}
