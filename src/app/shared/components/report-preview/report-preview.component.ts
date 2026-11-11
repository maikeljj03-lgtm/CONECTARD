import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, HostListener, Input, OnChanges, Output, inject,
} from '@angular/core';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS } from '../../../core/constants/catalogs';
import type { PublicReport, ReportMedia } from '../../../core/models/report.model';
import { ReportMediaService } from '../../../core/services/report-media.service';
import { formatDistance, timeAgo } from '../../../core/utils/geo';
import { STATUS_COLORS } from '../community-scene/community-scene.component';

const LIFECYCLE = ['reportado', 'en_revision', 'en_proceso', 'resuelto'] as const;

/** Vista previa de un reporte en una ventana emergente (RF-21). */
@Component({
  selector: 'app-report-preview',
  templateUrl: './report-preview.component.html',
  styleUrls: ['./report-preview.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportPreviewComponent implements OnChanges {
  private readonly mediaService = inject(ReportMediaService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  @Input() report: PublicReport | null = null;
  @Input() distanceKm: number | null = null;
  /** Muestra el botón "Ver en el mapa". */
  @Input() showMapAction = true;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly showOnMap = new EventEmitter<PublicReport>();

  media: { url: string; kind: 'image' | 'video' }[] = [];
  activeIndex = 0;
  loadingMedia = false;
  private requestId = 0;

  readonly lifecycle = LIFECYCLE;
  readonly statusLabels = REPORT_STATUS_LABELS;

  get category() {
    const value = this.report?.category;
    return REPORT_CATEGORIES.find((item) => item.value === value) ?? REPORT_CATEGORIES[REPORT_CATEGORIES.length - 1];
  }

  get statusColor(): string {
    return STATUS_COLORS[this.report?.status ?? 'reportado'] ?? STATUS_COLORS['reportado'];
  }

  get place(): string {
    const report = this.report;
    if (!report) return '';
    return [report.sector, report.municipality, report.province].filter(Boolean).join(', ') || 'Ubicación marcada en el mapa';
  }

  get age(): string {
    return this.report ? timeAgo(this.report.created_at) : '';
  }

  get distance(): string | null {
    return this.distanceKm === null ? null : formatDistance(this.distanceKm);
  }

  /** Posición del estado actual en la línea de tiempo (-1 si fue rechazado). */
  get stepIndex(): number {
    return this.report ? (LIFECYCLE as readonly string[]).indexOf(this.report.status) : -1;
  }

  async ngOnChanges(): Promise<void> {
    const report = this.report;
    this.media = [];
    this.activeIndex = 0;
    if (!report || !report.media_count) return;
    const request = ++this.requestId;
    this.loadingMedia = true;
    try {
      const items: ReportMedia[] = await this.mediaService.listForReport(report.id);
      if (request !== this.requestId) return;
      this.media = items
        .map((item) => ({ url: this.mediaService.coverUrl(item.path), kind: item.kind }))
        .filter((item): item is { url: string; kind: 'image' | 'video' } => !!item.url);
    } catch {
      this.media = [];
    } finally {
      if (request === this.requestId) {
        this.loadingMedia = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.report) this.closed.emit();
  }

  step(direction: -1 | 1): void {
    if (!this.media.length) return;
    this.activeIndex = (this.activeIndex + direction + this.media.length) % this.media.length;
  }
}
