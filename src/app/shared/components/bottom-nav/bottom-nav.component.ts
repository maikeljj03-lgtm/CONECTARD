import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Barra inferior para el teléfono (como en los bocetos): Inicio, Explorar, Reportar, Perfil. */
@Component({
  selector: 'app-bottom-nav',
  templateUrl: './bottom-nav.component.html',
  styleUrls: ['./bottom-nav.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { slot: 'fixed' },
})
export class BottomNavComponent {}
