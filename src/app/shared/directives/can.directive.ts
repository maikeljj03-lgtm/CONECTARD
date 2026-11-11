import { Directive, Input, OnChanges, TemplateRef, ViewContainerRef, inject } from '@angular/core';
import type { Permission } from '../../core/constants/permissions';
import { RolesService } from '../../core/services/roles.service';

/**
 * Muestra un bloque solo si el rol actual tiene el permiso (RF-03):
 *   <a *appCan="'users.manage'" routerLink="/admin">Administración</a>
 * Solo oculta la opción; el permiso real lo comprueba la base de datos.
 */
@Directive({
  selector: '[appCan]',
  standalone: false,
})
export class CanDirective implements OnChanges {
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);
  private readonly roles = inject(RolesService);
  private shown = false;
  private check = 0;

  @Input({ required: true }) appCan!: Permission;

  async ngOnChanges(): Promise<void> {
    const current = ++this.check;
    const allowed = await this.roles.can(this.appCan);
    if (current !== this.check) return; // llegó otra comprobación más reciente
    if (allowed && !this.shown) {
      this.container.createEmbeddedView(this.template);
      this.shown = true;
    } else if (!allowed && this.shown) {
      this.container.clear();
      this.shown = false;
    }
  }
}
