import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS, ROLE_LABELS } from '../../../../core/constants/catalogs';
import { DR_PROVINCES } from '../../../../core/constants/geography';
import type { AdminInstitution, AdminUserDetail, AdminUserRow, UserSort, UserStateFilter } from '../../../../core/models/admin.model';
import type { UserRole } from '../../../../core/models/profile.model';
import { AdminService } from '../../../../core/services/admin.service';
import { AuthService } from '../../../../core/services/auth.service';
import { csvFilename, downloadCsv, toCsv } from '../../../../core/utils/csv';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { timeAgo } from '../../../../core/utils/geo';
import { STATUS_COLORS } from '../../../../shared/components/community-scene/community-scene.component';

const PAGE_SIZE = 20;

/** Usuarios (RF-39): tabla con filtros y ficha con cambio de rol y bloqueo. */
@Component({
  selector: 'app-admin-users',
  templateUrl: './users.page.html',
  styleUrls: ['./users.page.scss'],
  standalone: false,
})
export class AdminUsersPage implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly roleLabels = ROLE_LABELS;
  readonly statusLabels = REPORT_STATUS_LABELS;
  readonly statusColors = STATUS_COLORS;
  readonly roleOptions: UserRole[] = ['citizen', 'volunteer', 'organization', 'institution', 'administrator'];
  readonly pageSize = PAGE_SIZE;
  readonly categories = REPORT_CATEGORIES;
  readonly provinces = DR_PROVINCES;

  rows: AdminUserRow[] = [];
  total = 0;
  page = 0;
  search = '';
  role: UserRole | '' = '';
  state: UserStateFilter = '';
  sort: UserSort = 'recientes';
  loading = true;
  exporting = false;
  error = '';
  feedback = '';
  myId = '';
  private searchTimer?: ReturnType<typeof setTimeout>;

  // Ficha
  detail: AdminUserDetail | null = null;
  detailLoading = false;
  newRole: UserRole | '' = '';
  roleNote = '';
  blockReason = '';
  confirmAdmin = false;
  busy = false;
  /** RF-42: zona y categorías de una institución (para que le lleguen sus reportes). */
  scope: AdminInstitution | null = null;
  scopeProvince = '';
  scopeMunicipality = '';
  scopeCategories = new Set<string>();
  drawerError = '';

  async ngOnInit(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const state = params.get('estado');
    if (state === 'bloqueados' || state === 'pendientes' || state === 'activos') this.state = state;
    this.myId = (await this.auth.getCurrentUser())?.id ?? '';
    await this.load();
  }

  get pages(): number {
    return Math.max(1, Math.ceil(this.total / PAGE_SIZE));
  }

  get rangeLabel(): string {
    if (!this.total) return 'Sin resultados';
    const from = this.page * PAGE_SIZE + 1;
    return `${from}–${Math.min(this.total, from + this.rows.length - 1)} de ${this.total}`;
  }

  initials(name: string): string {
    return (name || '?').split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  }

  ago(iso: string | null): string {
    return iso ? timeAgo(iso) : 'Nunca';
  }

  roleChip(role: UserRole): string {
    return { citizen: '', volunteer: 'chip--teal', organization: 'chip--sun', institution: 'chip--blue', administrator: 'chip--ink' }[role];
  }

  onSearch(value: string): void {
    this.search = value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.reload(), 300);
  }

  async setFilter(kind: 'role' | 'state' | 'sort', value: string): Promise<void> {
    if (kind === 'role') this.role = value as UserRole | '';
    if (kind === 'state') this.state = value as UserStateFilter;
    if (kind === 'sort') this.sort = value as UserSort;
    await this.reload();
  }

  async goTo(page: number): Promise<void> {
    this.page = Math.max(0, Math.min(this.pages - 1, page));
    await this.load();
  }

  async reload(): Promise<void> {
    this.page = 0;
    await this.load();
  }

  /** Exporta TODAS las cuentas que cumplen los filtros (RF-41). */
  async exportCsv(): Promise<void> {
    this.exporting = true;
    try {
      const all = await this.admin.users({ search: this.search, role: this.role, state: this.state, sort: this.sort, limit: 200, offset: 0 });
      let rows = all;
      // admin_users_page devuelve hasta 200 por página: se piden las siguientes si hay más.
      for (let offset = 200; offset < (all[0]?.total_count ?? 0); offset += 200) {
        rows = rows.concat(await this.admin.users({ search: this.search, role: this.role, state: this.state, sort: this.sort, limit: 200, offset }));
      }
      const csv = toCsv(rows, [
        { header: 'Nombre', value: (r) => r.full_name },
        { header: 'Correo', value: (r) => r.email },
        { header: 'Rol', value: (r) => this.roleLabels[r.role] },
        { header: 'Provincia', value: (r) => r.province },
        { header: 'Reportes', value: (r) => r.reports_count },
        { header: 'Puntos', value: (r) => r.points },
        { header: 'Bloqueada', value: (r) => (r.is_blocked ? 'Sí' : 'No') },
        { header: 'Registro', value: (r) => new Date(r.created_at).toLocaleString('es-DO') },
        { header: 'Último acceso', value: (r) => (r.last_sign_in_at ? new Date(r.last_sign_in_at).toLocaleString('es-DO') : '') },
      ]);
      downloadCsv(csvFilename('usuarios'), csv);
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.exporting = false;
      this.changeDetector.markForCheck();
    }
  }

  // ---------- Ficha ----------

  async openDetail(row: AdminUserRow): Promise<void> {
    this.detail = null;
    this.detailLoading = true;
    this.drawerError = '';
    this.newRole = '';
    this.roleNote = '';
    this.blockReason = '';
    this.confirmAdmin = false;
    this.changeDetector.markForCheck();
    try {
      this.detail = await this.admin.userDetail(row.id);
      this.newRole = this.detail.role;
      await this.loadScope();
    } catch (error) {
      this.drawerError = friendlyDataError(error);
    } finally {
      this.detailLoading = false;
      this.changeDetector.markForCheck();
    }
  }

  toggleScopeCategory(value: string): void {
    if (this.scopeCategories.has(value)) this.scopeCategories.delete(value);
    else this.scopeCategories.add(value);
  }

  /** Guarda la zona y las categorías: sus reportes abiertos se reasignan solos. */
  async saveScope(): Promise<void> {
    const d = this.detail;
    if (!d) return;
    if (!this.scopeProvince) {
      this.drawerError = 'Elige la provincia que atiende la institución.';
      return;
    }
    await this.act(async () => {
      const open = await this.admin.setInstitutionScope(d.id, this.scopeProvince, this.scopeMunicipality, [...this.scopeCategories]);
      this.feedback = `Zona guardada. ${d.full_name || 'La institución'} tiene ahora ${open} ${open === 1 ? 'reporte abierto asignado' : 'reportes abiertos asignados'}.`;
    });
  }

  /** Carga la zona y categorías actuales si la cuenta es una institución. */
  private async loadScope(): Promise<void> {
    const d = this.detail;
    this.scope = null;
    if (!d || d.role !== 'institution') return;
    try {
      this.scope = (await this.admin.institutions()).find((item) => item.id === d.id) ?? null;
    } catch {
      this.scope = null;
    }
    this.scopeProvince = this.scope?.province ?? d.province ?? '';
    this.scopeMunicipality = this.scope?.municipality ?? d.municipality ?? '';
    this.scopeCategories = new Set(this.scope?.service_categories ?? []);
  }

  closeDetail(): void {
    this.detail = null;
    this.detailLoading = false;
  }

  zone(d: AdminUserDetail): string {
    return [...new Set([d.sector, d.municipality, d.province].filter(Boolean))].join(', ') || '—';
  }

  get isMe(): boolean {
    return !!this.detail && this.detail.id === this.myId;
  }

  async saveRole(): Promise<void> {
    const d = this.detail;
    if (!d || !this.newRole || this.newRole === d.role) return;
    if (this.newRole === 'administrator' && !this.confirmAdmin) {
      this.confirmAdmin = true;
      return;
    }
    await this.act(async () => {
      await this.admin.setRole(d.id, this.newRole as UserRole, this.roleNote);
      this.feedback = `${d.full_name || 'La cuenta'} ahora es ${this.roleLabels[this.newRole].toLowerCase()}.`;
    });
  }

  async toggleBlock(): Promise<void> {
    const d = this.detail;
    if (!d) return;
    if (!d.is_blocked && !this.blockReason.trim()) {
      this.drawerError = 'Escribe el motivo del bloqueo: se le mostrará a la persona.';
      return;
    }
    await this.act(async () => {
      await this.admin.setBlocked(d.id, !d.is_blocked, this.blockReason);
      this.feedback = d.is_blocked ? `Desbloqueaste a ${d.full_name || 'la cuenta'}.` : `Bloqueaste a ${d.full_name || 'la cuenta'}: ya no puede publicar ni iniciar sesión.`;
    });
  }

  private async act(action: () => Promise<void>): Promise<void> {
    const d = this.detail;
    if (!d) return;
    this.busy = true;
    this.drawerError = '';
    this.feedback = '';
    try {
      await action();
      this.confirmAdmin = false;
      this.blockReason = '';
      this.roleNote = '';
      this.detail = await this.admin.userDetail(d.id);
      this.newRole = this.detail.role;
      await this.loadScope();
      await this.load();
    } catch (error) {
      this.drawerError = friendlyDataError(error);
    } finally {
      this.busy = false;
      this.changeDetector.markForCheck();
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.changeDetector.markForCheck();
    try {
      this.rows = await this.admin.users({ search: this.search, role: this.role, state: this.state, sort: this.sort, limit: PAGE_SIZE, offset: this.page * PAGE_SIZE });
      this.total = this.rows[0]?.total_count ?? 0;
    } catch (error) {
      this.error = friendlyDataError(error);
      this.rows = [];
      this.total = 0;
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }
}
