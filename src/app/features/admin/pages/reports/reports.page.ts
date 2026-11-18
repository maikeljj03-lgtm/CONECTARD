import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS } from '../../../../core/constants/catalogs';
import { DR_PROVINCES } from '../../../../core/constants/geography';
import type { AdminReportRow } from '../../../../core/models/admin.model';
import type { ReportStatus } from '../../../../core/models/report.model';
import { AdminService } from '../../../../core/services/admin.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { csvFilename, downloadCsv, toCsv } from '../../../../core/utils/csv';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { timeAgo } from '../../../../core/utils/geo';
import { STATUS_COLORS } from '../../../../shared/components/community-scene/community-scene.component';

const PAGE_SIZE = 20;

/**
 * Reportes para el administrador (RF-39, RF-41): filtros, autor real de los anónimos,
 * moderación en lote (rechazar / restaurar) y exportación a CSV.
 */
@Component({
  selector: 'app-admin-reports',
  templateUrl: './reports.page.html',
  styleUrls: ['./reports.page.scss'],
  standalone: false,
})
export class AdminReportsPage implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly reportsService = inject(ReportsService);
  private readonly route = inject(ActivatedRoute);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly categories = REPORT_CATEGORIES;
  readonly provinces = DR_PROVINCES;
  readonly statusLabels = REPORT_STATUS_LABELS;
  readonly statusColors = STATUS_COLORS;
  readonly statuses: ReportStatus[] = ['reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado'];

  rows: AdminReportRow[] = [];
  total = 0;
  page = 0;
  search = '';
  status: ReportStatus | '' = '';
  category = '';
  province = '';
  flaggedOnly = false;
  loading = true;
  exporting = false;
  error = '';
  feedback = '';
  selected = new Set<string>();
  bulkReason = '';
  bulkBusy = false;
  private searchTimer?: ReturnType<typeof setTimeout>;

  async ngOnInit(): Promise<void> {
    const status = this.route.snapshot.queryParamMap.get('estado');
    if (status && (this.statuses as string[]).includes(status)) this.status = status as ReportStatus;
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

  get allSelected(): boolean {
    return this.rows.length > 0 && this.rows.every((row) => this.selected.has(row.id));
  }

  get selectedRows(): AdminReportRow[] {
    return this.rows.filter((row) => this.selected.has(row.id));
  }

  categoryLabel(value: string): string {
    return this.categories.find((item) => item.value === value)?.label ?? value;
  }

  categoryIcon(value: string): string {
    return this.categories.find((item) => item.value === value)?.icon ?? 'more';
  }

  place(row: AdminReportRow): string {
    return [...new Set([row.sector, row.municipality, row.province].filter(Boolean))].join(', ') || '—';
  }

  ago(iso: string): string {
    return timeAgo(iso);
  }

  /** Días que lleva abierto (para resaltar lo que nadie atiende). */
  daysOpen(row: AdminReportRow): number {
    return Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86_400_000);
  }

  onSearch(value: string): void {
    this.search = value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.reload(), 300);
  }

  async setFilter(kind: 'status' | 'category' | 'province' | 'flagged', value: string | boolean): Promise<void> {
    if (kind === 'status') this.status = value as ReportStatus | '';
    if (kind === 'category') this.category = value as string;
    if (kind === 'province') this.province = value as string;
    if (kind === 'flagged') this.flaggedOnly = value as boolean;
    await this.reload();
  }

  async goTo(page: number): Promise<void> {
    this.page = Math.max(0, Math.min(this.pages - 1, page));
    await this.load();
  }

  async reload(): Promise<void> {
    this.page = 0;
    this.selected.clear();
    await this.load();
  }

  toggle(row: AdminReportRow, event: Event): void {
    event.stopPropagation();
    if (this.selected.has(row.id)) this.selected.delete(row.id);
    else this.selected.add(row.id);
  }

  toggleAll(): void {
    if (this.allSelected) this.rows.forEach((row) => this.selected.delete(row.id));
    else this.rows.forEach((row) => this.selected.add(row.id));
  }

  /** Rechaza en lote (moderación). Restaurar devuelve a "Reportado" los rechazados. */
  async bulk(action: 'rechazar' | 'restaurar'): Promise<void> {
    const targets = this.selectedRows.filter((row) => (action === 'rechazar' ? row.status !== 'rechazado' : row.status === 'rechazado'));
    if (!targets.length) {
      this.error = action === 'rechazar' ? 'Los reportes seleccionados ya están rechazados.' : 'Selecciona reportes rechazados para restaurarlos.';
      return;
    }
    if (action === 'rechazar' && !this.bulkReason.trim()) {
      this.error = 'Escribe el motivo del rechazo: se mostrará en el historial público de cada reporte.';
      return;
    }
    this.bulkBusy = true;
    this.error = '';
    this.feedback = '';
    let done = 0;
    const failures: string[] = [];
    for (const row of targets) {
      try {
        await this.reportsService.setStatus(row.id, action === 'rechazar' ? 'rechazado' : 'reportado', action === 'rechazar' ? this.bulkReason : 'Restaurado por moderación');
        done++;
      } catch (error) {
        failures.push(`${row.title}: ${friendlyDataError(error)}`);
      }
    }
    this.feedback = `${action === 'rechazar' ? 'Rechazados' : 'Restaurados'}: ${done} de ${targets.length}.`;
    if (failures.length) this.error = failures.slice(0, 3).join(' · ');
    this.bulkReason = '';
    this.selected.clear();
    this.bulkBusy = false;
    await this.load();
  }

  /** Exporta TODOS los reportes que cumplen los filtros (RF-41). */
  async exportCsv(): Promise<void> {
    this.exporting = true;
    this.error = '';
    try {
      const all = await this.admin.reports({ search: this.search, status: this.status, category: this.category, province: this.province, flaggedOnly: this.flaggedOnly, limit: 5000, offset: 0 });
      const csv = toCsv(all, [
        { header: 'ID', value: (r) => r.id },
        { header: 'Título', value: (r) => r.title },
        { header: 'Categoría', value: (r) => this.categoryLabel(r.category) },
        { header: 'Estado', value: (r) => this.statusLabels[r.status] },
        { header: 'Provincia', value: (r) => r.province },
        { header: 'Municipio', value: (r) => r.municipality },
        { header: 'Sector', value: (r) => r.sector },
        { header: 'Anónimo', value: (r) => (r.is_anonymous ? 'Sí' : 'No') },
        { header: 'Autor', value: (r) => r.author_name },
        { header: 'Correo del autor', value: (r) => r.author_email },
        { header: 'Me afecta', value: (r) => r.support_count },
        { header: 'Comentarios', value: (r) => r.comment_count },
        { header: 'Denuncias pendientes', value: (r) => r.pending_flags },
        { header: 'Creado', value: (r) => new Date(r.created_at).toLocaleString('es-DO') },
        { header: 'Último cambio de estado', value: (r) => new Date(r.status_updated_at).toLocaleString('es-DO') },
      ]);
      downloadCsv(csvFilename('reportes'), csv);
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.exporting = false;
      this.changeDetector.markForCheck();
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = this.error && this.bulkBusy ? this.error : '';
    this.changeDetector.markForCheck();
    try {
      this.rows = await this.admin.reports({ search: this.search, status: this.status, category: this.category, province: this.province, flaggedOnly: this.flaggedOnly, limit: PAGE_SIZE, offset: this.page * PAGE_SIZE });
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
