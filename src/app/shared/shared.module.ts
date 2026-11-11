import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { IconComponent } from './components/icon/icon.component';
import { LogoComponent } from './components/logo/logo.component';
import { SkylineComponent } from './components/skyline/skyline.component';
import { TopbarComponent } from './components/topbar/topbar.component';

const COMPONENTS = [IconComponent, LogoComponent, SkylineComponent, TopbarComponent];

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
