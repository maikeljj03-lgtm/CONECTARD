import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation } from '@angular/core';

let logoInstance = 0;

/**
 * Marca de ConectaRD: globo de meridianos y paralelos (mitad clara y mitad turquesa)
 * con una órbita que lo cruza por delante.
 * Variables CSS: --logo-white (mitad clara; en fondo claro se usa tinta) y
 * --logo-gap (color del fondo, para el corte de la órbita sobre la malla).
 */
@Component({
  selector: 'app-logo',
  templateUrl: './logo.component.html',
  styleUrls: ['./logo.component.scss'],
  // Sin encapsulación: cada página ajusta colores del logo según su fondo.
  encapsulation: ViewEncapsulation.None,
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'app-logo' },
})
export class LogoComponent {
  @Input() size = 32;
  @Input() wordmark = true;
  @Input() tagline = false;
  private readonly uid = ++logoInstance;
  /** Identificadores únicos por instancia (varios logos en la misma página). */
  readonly ids = {
    left: `crd-logo-left-${this.uid}`,
    right: `crd-logo-right-${this.uid}`,
    front: `crd-logo-front-${this.uid}`,
    globe: `crd-logo-globe-${this.uid}`,
  };
}
