import { LOCALE_ID, NgModule, isDevMode } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsDo from '@angular/common/locales/es-DO';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { ServiceWorkerModule } from '@angular/service-worker';
import { IonicModule, IonicRouteStrategy } from '@ionic/angular/lazy';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { SharedModule } from './shared/shared.module';

// Fechas y números en español dominicano (ej. "11 nov 2026").
registerLocaleData(localeEsDo);

/** Módulo raíz: solo arranca la app. Cada sección vive en su módulo de features/. */
@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    IonicModule.forRoot(),
    AppRoutingModule,
    SharedModule,
    // App instalable y con caché sin conexión (RF-48, RF-60). Solo en la versión publicada.
    ServiceWorkerModule.register('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' }),
  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: LOCALE_ID, useValue: 'es-DO' },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
