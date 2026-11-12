import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';
import { REPORT_STATUS_LABELS } from '../../../core/constants/catalogs';
import { REPORT_LIFECYCLE } from '../../../core/constants/report-rules';
import type { PublicReport, ReportStatusChange } from '../../../core/models/report.model';
import { ReportMediaService } from '../../../core/services/report-media.service';
import { ReportsService } from '../../../core/services/reports.service';
import { STATUS_COLORS } from '../community-scene/community-scene.component';

/**
 * Seguimiento de un reporte: línea de estados y historial (RF-16) y la comparación
 * "Antes y Después" (RF-17). Lo usan la vista previa y la página completa del reporte.
 */
@Component({
  selector: 'app-report-progress',
  templateUrl: './report-progress.component.html',
  styleUrls: ['./report-progress.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportProgressComponent implements OnChanges {
  private readonly mediaService = inject(ReportMediaService);
  private readonly reportsService = inject(ReportsService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  @Input({ required: true }) report!: PublicReport;
  /** Primera foto del reporte: el "Antes". */
  @Input() beforeImage: string | null = null;
  /** Abre el historial aunque sea largo. */
  @Input() expandHistory = false;

  evidence: string[] = [];
  history: ReportStatusChange[] = [];
  afterIndex = 0;
  /** Posición del divisor en la comparación (porcentaje que muestra el "Después"). */
  split = 50;
  private requestId = 0;

  readonly lifecycle = REPORT_LIFECYCLE;
  readonly statusLabels = REPORT_STATUS_LABELS;
  readonly statusColors = STATUS_COLORS;

  get stepIndex(): number {
    return this.lifecycle.indexOf(this.report.status);
  }

  get afterImage(): string | null {
    return this.evidence[this.afterIndex] ?? null;
  }

  /** Motivo del rechazo, si lo hay (último cambio a "Rechazado"). */
  get rejectionNote(): string | null {
    return [...this.history].reverse().find((item) => item.to_status === 'rechazado')?.note ?? null;
  }

  /** Historial del más reciente al más antiguo. */
  get timeline(): ReportStatusChange[] {
    return [...this.history].reverse();
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    const previous = changes['report']?.previousValue as PublicReport | undefined;
    const report = this.report;
    if (!report) return;
    // Solo se recarga si cambió el reporte o su estado/evidencia (no por otros datos como los apoyos).
    if (previous && previous.id === report.id && previous.status === report.status && previous.evidence_count === report.evidence_count) return;
    if (!previous || previous.id !== report.id) {
      this.evidence = [];
      this.history = [];
      this.afterIndex = 0;
      this.split = 50;
    }
    const request = ++this.requestId;
    const [evidence, history] = await Promise.allSettled([
      report.evidence_count ? this.mediaService.listEvidence(report.id) : Promise.resolve([]),
      this.reportsService.getHistory(report.id),
    ]);
    if (request !== this.requestId) return;
    if (evidence.status === 'fulfilled') {
      this.evidence = evidence.value.map((item) => this.mediaService.coverUrl(item.path)).filter((url): url is string => !!url);
    }
    // Si la vista del historial aún no existe (migración pendiente), simplemente no se muestra.
    if (history.status === 'fulfilled') this.history = history.value;
    this.changeDetector.markForCheck();
  }

  onSplit(event: Event): void {
    this.split = Number((event.target as HTMLInputElement).value);
  }

  changeLabel(change: ReportStatusChange): string {
    if (!change.from_status) return 'Reporte creado';
    if (change.to_status === 'reportado' && change.from_status === 'rechazado') return 'Restaurado';
    return this.statusLabels[change.to_status] ?? change.to_status;
  }
}
