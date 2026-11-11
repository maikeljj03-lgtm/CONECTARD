import { LOCALE_ID, NgModule } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsDo from '@angular/common/locales/es-DO';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { IonicModule, IonicRouteStrategy } from '@ionic/angular/lazy';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

// Fechas y números en español dominicano (ej. "11 nov 2026").
registerLocaleData(localeEsDo);

/** Módulo raíz: solo arranca la app. Cada sección vive en su módulo de features/. */
@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: LOCALE_ID, useValue: 'es-DO' },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
