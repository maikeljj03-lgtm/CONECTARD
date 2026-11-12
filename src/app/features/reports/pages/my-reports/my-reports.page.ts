import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS } from '../../../../core/constants/catalogs';
import { REPORT_EDIT_WINDOW_HOURS, editTimeLeft, editableUntil, isReportEditable } from '../../../../core/constants/report-rules';
import type { MyReport, PublicReport } from '../../../../core/models/report.model';
import { ReportMediaService } from '../../../../core/services/report-media.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { STATUS_COLORS } from '../../../../shared/components/community-scene/community-scene.component';

/** Mis reportes: seguimiento, edición y eliminación dentro del período permitido (RF-15). */
@Component({
  selector: 'app-my-reports',
  templateUrl: './my-reports.page.html',
  styleUrls: ['./my-reports.page.scss'],
  standalone: false,
})
export class MyReportsPage implements OnInit, OnDestroy {
  private readonly reportsService = inject(ReportsService);
  private readonly media = inject(ReportMediaService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly statusLabels = REPORT_STATUS_LABELS;
  readonly statusColors = STATUS_COLORS;
  readonly editHours = REPORT_EDIT_WINDOW_HOURS;

  reports: MyReport[] = [];
  /** Datos públicos (portada, fotos, evidencia) por id de reporte. */
  publicById = new Map<string, PublicReport>();
  loading = true;
  error = '';
  feedback = '';
  confirmingId: string | null = null;
  deletingId: string | null = null;
  selected: PublicReport | null = null;
  /** Se actualiza cada minuto para que el tiempo restante no quede viejo. */
  now = new Date();
  private timer?: ReturnType<typeof setInterval>;

  async ngOnInit(): Promise<void> {
    // Mensaje de la página de edición al volver.
    const saved = (history.state as { saved?: string } | null)?.saved;
    if (saved) this.feedback = `Guardaste los cambios de “${saved}”.`;
    this.timer = setInterval(() => {
      this.now = new Date();
      this.changeDetector.markForCheck();
    }, 60_000);
    try {
      this.reports = await this.reportsService.getMyReports();
      const publicReports = await this.reportsService.listPublicByIds(this.reports.map((report) => report.id)).catch(() => []);
      this.publicById = new Map(publicReports.map((report) => [report.id, report]));
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  get editableCount(): number {
    return this.reports.filter((report) => this.canEdit(report)).length;
  }

  get resolvedCount(): number {
    return this.reports.filter((report) => report.status === 'resuelto').length;
  }

  canEdit(report: MyReport): boolean {
    return isReportEditable(report, this.now);
  }

  timeLeft(report: MyReport): string | null {
    return editTimeLeft(report, this.now);
  }

  deadline(report: MyReport): Date | null {
    return editableUntil(report);
  }

  /** Por qué ya no se puede editar. */
  lockedReason(report: MyReport): string {
    if (report.status !== 'reportado') return 'Ya lo está atendiendo una institución, por eso no se puede editar.';
    return `Pasaron las ${this.editHours} horas para editarlo o eliminarlo.`;
  }

  categoryOf(report: MyReport) {
    return REPORT_CATEGORIES.find((item) => item.value === report.category) ?? REPORT_CATEGORIES[REPORT_CATEGORIES.length - 1];
  }

  coverOf(report: MyReport): string | null {
    return this.media.coverUrl(this.publicById.get(report.id)?.cover_path);
  }

  open(report: MyReport): void {
    const publicReport = this.publicById.get(report.id);
    if (publicReport) this.selected = publicReport;
  }

  askDelete(report: MyReport): void {
    this.confirmingId = report.id;
    this.feedback = '';
    this.error = '';
  }

  async confirmDelete(report: MyReport): Promise<void> {
    if (!this.canEdit(report)) {
      this.error = this.lockedReason(report);
      this.confirmingId = null;
      return;
    }
    this.deletingId = report.id;
    this.error = '';
    try {
      // Primero las fotos (la base de datos no puede borrar archivos), luego el reporte.
      await this.media.removeAllForReport(report.id);
      await this.reportsService.deleteOwn(report.id);
      this.reports = this.reports.filter((item) => item.id !== report.id);
      this.publicById.delete(report.id);
      this.feedback = `Eliminaste “${report.title}”.`;
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.deletingId = null;
      this.confirmingId = null;
      this.changeDetector.markForCheck();
    }
  }
}
