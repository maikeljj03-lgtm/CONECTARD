import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Menú de la sección de administración. */
@Component({
  selector: 'app-admin-nav',
  templateUrl: './admin-nav.component.html',
  styleUrls: ['./admin-nav.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminNavComponent {
  readonly items = [
    { path: '/admin/verificaciones', icon: 'shield-check', label: 'Organizaciones' },
    { path: '/admin/voluntarios', icon: 'heart', label: 'Voluntarios' },
    { path: '/admin/usuarios', icon: 'users', label: 'Usuarios y roles' },
  ];
}
