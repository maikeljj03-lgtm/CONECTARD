import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, inject,
} from '@angular/core';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS } from '../../../core/constants/catalogs';
import type { PublicReport } from '../../../core/models/report.model';
import { ReportMediaService } from '../../../core/services/report-media.service';
import { formatDistance, timeAgo } from '../../../core/utils/geo';
import { STATUS_COLORS } from '../community-scene/community-scene.component';

interface MediaView {
  url: string;
  kind: 'image' | 'video';
}

/**
 * Vista previa de un reporte en una ventana emergente (RF-21): fotos, datos, seguimiento
 * (RF-16, RF-17) y accesos a la página completa y a compartir (RF-31).
 */
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
  /** Muestra el botón "Mapa". */
  @Input() showMapAction = true;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly showOnMap = new EventEmitter<PublicReport>();

  media: MediaView[] = [];
  activeIndex = 0;
  loadingMedia = false;
  private requestId = 0;

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
    // Sin repetir (p. ej. municipio y provincia "Distrito Nacional").
    return [...new Set([report.sector, report.municipality, report.province].filter(Boolean))].join(', ') || 'Ubicación marcada en el mapa';
  }

  get age(): string {
    return this.report ? timeAgo(this.report.created_at) : '';
  }

  get distance(): string | null {
    return this.distanceKm === null ? null : formatDistance(this.distanceKm);
  }

  /** La primera foto del reporte: el "Antes" de la comparación. */
  get beforeImage(): string | null {
    return this.media.find((item) => item.kind === 'image')?.url ?? null;
  }

  get shareText(): string {
    return this.report ? `${this.report.title} (${this.place}). Míralo en ConectaRD:` : '';
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    const previous = changes['report']?.previousValue as PublicReport | null | undefined;
    const report = this.report;
    // Mismo reporte con datos actualizados (p. ej. en vivo): no se recargan las fotos.
    if (report && previous && previous.id === report.id && previous.media_count === report.media_count) return;
    this.media = [];
    this.activeIndex = 0;
    if (!report || !report.media_count) {
      this.loadingMedia = false;
      return;
    }
    const request = ++this.requestId;
    this.loadingMedia = true;
    try {
      const items = await this.mediaService.listForReport(report.id);
      if (request !== this.requestId) return;
      this.media = items
        .map((item) => ({ url: this.mediaService.coverUrl(item.path), kind: item.kind }))
        .filter((item): item is MediaView => !!item.url);
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
