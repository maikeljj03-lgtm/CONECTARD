import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ICON_PATHS, type IconName } from './icons';

/** Icono SVG de la app: <app-icon name="map-pin"></app-icon>. Toma el color y tamaño del texto. */
@Component({
  selector: 'app-icon',
  template: '',
  styleUrls: ['./icon.component.scss'],
  // Sin encapsulación: el SVG se inserta con innerHTML y no recibe los atributos de Angular.
  encapsulation: ViewEncapsulation.None,
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[innerHTML]': 'svg' },
})
export class IconComponent {
  private static readonly cache = new Map<string, SafeHtml>();
  private readonly sanitizer = inject(DomSanitizer);
  svg: SafeHtml = '';

  @Input({ required: true }) set name(value: IconName | string) {
    const key = value in ICON_PATHS ? (value as IconName) : 'more';
    let cached = IconComponent.cache.get(key);
    if (!cached) {
      // Los trazos son constantes del código (icons.ts), nunca datos del usuario.
      cached = this.sanitizer.bypassSecurityTrustHtml(
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false">${ICON_PATHS[key]}</svg>`,
      );
      IconComponent.cache.set(key, cached);
    }
    this.svg = cached;
  }
}
