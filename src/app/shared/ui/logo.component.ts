import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

let logoInstance = 0;

/**
 * Marca de ConectaRD: globo de meridianos y paralelos (mitad clara y mitad turquesa)
 * con una órbita que lo cruza por delante.
 * Variables CSS: --logo-white (mitad clara; en fondo claro se usa tinta) y
 * --logo-gap (color del fondo, para el corte de la órbita sobre la malla).
 */
@Component({
  selector: 'app-logo',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="logo-mark" [attr.width]="size" [attr.height]="size" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <defs>
        <clipPath [attr.id]="ids.left"><rect x="0" y="0" width="22" height="44" /></clipPath>
        <clipPath [attr.id]="ids.right"><rect x="22" y="0" width="22" height="44" /></clipPath>
        <clipPath [attr.id]="ids.front"><rect x="-10" y="22" width="64" height="30" /></clipPath>
        <g [attr.id]="ids.globe" fill="none" stroke-linecap="round">
          <circle cx="22" cy="21" r="14" stroke-width="2.4" />
          <ellipse cx="22" cy="21" rx="6.6" ry="14" stroke-width="1.8" />
          <path d="M22 7v28" stroke-width="1.8" />
          <path d="M8 21h28" stroke-width="1.8" />
          <path d="M10.2 13.6Q22 17 33.8 13.6M10.2 28.4Q22 25 33.8 28.4" stroke-width="1.8" />
        </g>
      </defs>

      <!-- Globo: mitad clara (izquierda) y mitad turquesa (derecha) -->
      <use [attr.href]="'#' + ids.globe" stroke="var(--logo-white, #FFFFFF)" [attr.clip-path]="'url(#' + ids.left + ')'" />
      <use [attr.href]="'#' + ids.globe" stroke="#00B2A9" [attr.clip-path]="'url(#' + ids.right + ')'" />

      <!-- Órbita: parte trasera fina; parte delantera gruesa con un corte del color del fondo -->
      <ellipse cx="22" cy="23" rx="20.5" ry="7" transform="rotate(-20 22 23)" fill="none" stroke="#00B2A9" stroke-width="1.4" opacity=".55" />
      <g transform="rotate(-20 22 23)" [attr.clip-path]="'url(#' + ids.front + ')'">
        <ellipse cx="22" cy="23" rx="20.5" ry="7" fill="none" stroke="var(--logo-gap, #11161A)" stroke-width="6" />
        <ellipse cx="22" cy="23" rx="20.5" ry="7" fill="none" stroke="#00B2A9" stroke-width="3.2" stroke-linecap="round" />
      </g>
    </svg>
    @if (wordmark) {
      <span class="logo-word">
        <span class="logo-name">Conecta<span>RD</span></span>
        @if (tagline) { <small class="logo-tagline">Connect • Solve • Improve</small> }
      </span>
    }
  `,
  host: { class: 'app-logo' },
})
export class LogoComponent {
  @Input() size = 32;
  @Input() wordmark = true;
  @Input() tagline = false;
  private readonly uid = ++logoInstance;
  readonly ids = {
    left: `crd-logo-left-${this.uid}`,
    right: `crd-logo-right-${this.uid}`,
    front: `crd-logo-front-${this.uid}`,
    globe: `crd-logo-globe-${this.uid}`,
  };
}
