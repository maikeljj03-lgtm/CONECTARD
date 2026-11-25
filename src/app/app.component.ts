import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { applyDocumentLanguage } from './core/i18n/i18n';
import { PreferencesService } from './core/services/preferences.service';
import { PwaService } from './core/services/pwa.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnDestroy {
  // Crear el servicio de preferencias aplica el tema guardado (RF-49).
  private readonly preferences = inject(PreferencesService);
  private readonly pwa = inject(PwaService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly subscription: Subscription;
  online = true;

  constructor() {
    applyDocumentLanguage(this.preferences.language);
    this.subscription = this.pwa.online$.subscribe((online) => {
      this.online = online;
      this.changeDetector.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  /** "Saltar al contenido" (RF-54): lleva el foco al contenido principal de la página visible. */
  skipToContent(event: Event): void {
    event.preventDefault();
    const pages = Array.from(document.querySelectorAll<HTMLElement>('ion-router-outlet > .ion-page:not(.ion-page-hidden)'));
    const page = pages.at(-1) ?? document.body;
    const main = page.querySelector<HTMLElement>('main') ?? page.querySelector<HTMLElement>('ion-content');
    if (!main) return;
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus();
  }
}
