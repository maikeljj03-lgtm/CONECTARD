import { LOCALE_ID, NgModule } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsDo from '@angular/common/locales/es-DO';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular/lazy';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ReactiveFormsModule } from '@angular/forms';
import { AdminVerificationsPage } from './features/admin/pages/admin-verifications.page';
import { AuthPage } from './features/auth/pages/auth.page';
import { LandingPage } from './features/landing/pages/landing.page';
import { ProfilePage } from './features/profile/pages/profile.page';
import { NewReportPage } from './features/reports/pages/new-report.page';
import { VerificationPage } from './features/verification/pages/verification.page';
import { IconComponent } from './shared/ui/icon.component';
import { LogoComponent } from './shared/ui/logo.component';
import { SkylineComponent } from './shared/ui/skyline.component';
import { TopbarComponent } from './shared/ui/topbar.component';

// Fechas y números en español dominicano (ej. "11 nov 2026").
registerLocaleData(localeEsDo);

@NgModule({
  declarations: [
    AppComponent, AuthPage, LandingPage, ProfilePage, VerificationPage, NewReportPage, AdminVerificationsPage,
    IconComponent, LogoComponent, SkylineComponent, TopbarComponent,
  ],
  imports: [BrowserModule, IonicModule.forRoot(), AppRoutingModule, ReactiveFormsModule],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: LOCALE_ID, useValue: 'es-DO' },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
