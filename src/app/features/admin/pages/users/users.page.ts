import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ROLE_LABELS } from '../../../../core/constants/catalogs';
import type { AdminUser, UserRole } from '../../../../core/models/profile.model';
import { AuthService } from '../../../../core/services/auth.service';
import { RolesService } from '../../../../core/services/roles.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';

/** Cuentas y roles (RF-03): el administrador busca cuentas y cambia su rol. */
@Component({
  selector: 'app-admin-users',
  templateUrl: './users.page.html',
  styleUrls: ['./users.page.scss'],
  standalone: false,
})
export class AdminUsersPage implements OnInit {
  private readonly roles = inject(RolesService);
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly roleLabels = ROLE_LABELS;
  readonly roleOptions: UserRole[] = ['citizen', 'volunteer', 'organization', 'institution', 'administrator'];

  users: AdminUser[] = [];
  myId = '';
  search = '';
  roleFilter: UserRole | '' = '';
  /** Rol elegido en el selector de cada fila, antes de guardar. */
  draft: Record<string, UserRole> = {};
  /** Fila donde se pidió confirmar un cambio a administrador. */
  confirmingAdmin = '';
  loading = true;
  busyId = '';
  error = '';
  feedback = '';
  private searchTimer?: ReturnType<typeof setTimeout>;

  async ngOnInit(): Promise<void> {
    this.myId = (await this.auth.getCurrentUser())?.id ?? '';
    await this.load();
  }

  onSearch(value: string): void {
    this.search = value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(), 350);
  }

  async onFilter(value: string): Promise<void> {
    this.roleFilter = value as UserRole | '';
    await this.load();
  }

  pendingLabel(user: AdminUser): string | null {
    if (user.verification_status !== 'pending') return null;
    return `Pidió ser ${this.roleLabels[user.requested_role].toLowerCase()}`;
  }

  hasChange(user: AdminUser): boolean {
    return !!this.draft[user.id] && this.draft[user.id] !== user.role;
  }

  async save(user: AdminUser): Promise<void> {
    const role = this.draft[user.id];
    if (!role || role === user.role) return;
    // Dar acceso de administrador pide una segunda confirmación.
    if (role === 'administrator' && this.confirmingAdmin !== user.id) {
      this.confirmingAdmin = user.id;
      return;
    }
    this.confirmingAdmin = '';
    this.busyId = user.id;
    this.error = '';
    this.feedback = '';
    try {
      await this.roles.setUserRole(user.id, role);
      user.role = role;
      user.verification_status = role === 'citizen' ? 'not_required' : 'approved';
      delete this.draft[user.id];
      this.feedback = `${user.full_name || user.email} ahora es ${this.roleLabels[role].toLowerCase()}.`;
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.busyId = '';
      this.changeDetector.markForCheck();
    }
  }

  cancel(user: AdminUser): void {
    delete this.draft[user.id];
    if (this.confirmingAdmin === user.id) this.confirmingAdmin = '';
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.changeDetector.markForCheck();
    try {
      this.users = await this.roles.listUsers(this.search, this.roleFilter);
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }
}
