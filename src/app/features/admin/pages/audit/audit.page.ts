import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { REPORT_STATUS_LABELS, ROLE_LABELS } from '../../../../core/constants/catalogs';
import { AUDIT_ICONS, AUDIT_LABELS, type AuditAction, type AuditEntry } from '../../../../core/models/admin.model';
import { AdminService } from '../../../../core/services/admin.service';
import { csvFilename, downloadCsv, toCsv } from '../../../../core/utils/csv';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { timeAgo } from '../../../../core/utils/geo';

const PAGE_SIZE = 30;

/** Registro de auditoría inalterable (RF-52): quién hizo qué, a quién y cuándo. */
@Component({
  selector: 'app-admin-audit',
  templateUrl: './audit.page.html',
  styleUrls: ['./audit.page.scss'],
  standalone: false,
})
export class AdminAuditPage implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly labels = AUDIT_LABELS;
  readonly icons = AUDIT_ICONS;
  readonly actions = Object.keys(AUDIT_LABELS) as AuditAction[];

  entries: AuditEntry[] = [];
  total = 0;
  page = 0;
  action: AuditAction | '' = '';
  target: string | null = null;
  loading = true;
  error = '';

  async ngOnInit(): Promise<void> {
    this.target = this.route.snapshot.queryParamMap.get('persona');
    await this.load();
  }

  get pages(): number {
    return Math.max(1, Math.ceil(this.total / PAGE_SIZE));
  }

  ago(iso: string): string {
    return timeAgo(iso);
  }

  /** Detalle legible de cada acción a partir de su JSON. */
  describe(entry: AuditEntry): string {
    const d = entry.details as Record<string, string | number | null>;
    const role = (value: unknown) => ROLE_LABELS[String(value)] ?? String(value);
    const status = (value: unknown) => REPORT_STATUS_LABELS[String(value)] ?? String(value);
    switch (entry.action) {
      case 'cambiar_rol': return `De ${role(d['de'])} a ${role(d['a'])}${d['nota'] ? ` · “${d['nota']}”` : ''}`;
      case 'bloquear': return d['motivo'] ? `Motivo: ${d['motivo']}` : '';
      case 'revisar_verificacion': return `${d['resultado'] === 'approved' ? 'Aprobada' : 'Rechazada'} como ${role(d['rol'])}${d['nota'] ? ` · “${d['nota']}”` : ''}`;
      case 'revisar_voluntario': return `Rechazada${d['nota'] ? ` · “${d['nota']}”` : ''}`;
      case 'estado_reporte': return `De ${status(d['de'])} a ${status(d['a'])}${d['nota'] ? ` · “${d['nota']}”` : ''}`;
      case 'resolver_denuncias': return `${d['resultado'] === 'retirado' ? 'Contenido retirado' : 'Denuncias descartadas'} (${d['denuncias']})${d['nota'] ? ` · “${d['nota']}”` : ''}`;
      default: return '';
    }
  }

  link(entry: AuditEntry): (string | null)[] | null {
    if (!entry.target_id) return null;
    if (entry.target_type === 'reporte') return ['/reporte', entry.target_id];
    if (entry.target_type === 'jornada') return ['/jornadas', entry.target_id];
    return null;
  }

  async setAction(value: string): Promise<void> {
    this.action = value as AuditAction | '';
    this.page = 0;
    await this.load();
  }

  async clearTarget(): Promise<void> {
    this.target = null;
    this.page = 0;
    void this.router.navigate([], { queryParams: { persona: null }, queryParamsHandling: 'merge', replaceUrl: true });
    await this.load();
  }

  async goTo(page: number): Promise<void> {
    this.page = Math.max(0, Math.min(this.pages - 1, page));
    await this.load();
  }

  async exportCsv(): Promise<void> {
    try {
      const all = await this.admin.audit({ action: this.action, target: this.target, limit: 500, offset: 0 });
      downloadCsv(csvFilename('auditoria'), toCsv(all, [
        { header: 'Fecha', value: (e) => new Date(e.created_at).toLocaleString('es-DO') },
        { header: 'Administrador', value: (e) => e.actor_name },
        { header: 'Acción', value: (e) => this.labels[e.action] },
        { header: 'Sobre', value: (e) => e.target_label },
        { header: 'Detalle', value: (e) => this.describe(e) },
      ]));
    } catch (error) {
      this.error = friendlyDataError(error);
      this.changeDetector.markForCheck();
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.changeDetector.markForCheck();
    try {
      this.entries = await this.admin.audit({ action: this.action, target: this.target, limit: PAGE_SIZE, offset: this.page * PAGE_SIZE });
      this.total = this.entries[0]?.total_count ?? 0;
    } catch (error) {
      this.error = friendlyDataError(error);
      this.entries = [];
      this.total = 0;
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }
}
