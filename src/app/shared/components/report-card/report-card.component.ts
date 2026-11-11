import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS } from '../../../core/constants/catalogs';
import type { PublicReport } from '../../../core/models/report.model';
import { formatDistance, timeAgo } from '../../../core/utils/geo';
import { STATUS_COLORS } from '../community-scene/community-scene.component';

/** Tarjeta de un reporte en listas (RF-22). */
@Component({
  selector: 'app-report-card',
  templateUrl: './report-card.component.html',
  styleUrls: ['./report-card.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportCardComponent {
  @Input({ required: true }) report!: PublicReport;
  @Input() coverUrl: string | null = null;
  /** Distancia a la persona, en km (si se conoce su ubicación). */
  @Input() distanceKm: number | null = null;
  @Input() selected = false;
  @Output() readonly open = new EventEmitter<PublicReport>();

  get category() {
    return REPORT_CATEGORIES.find((item) => item.value === this.report.category) ?? REPORT_CATEGORIES[REPORT_CATEGORIES.length - 1];
  }

  get statusLabel(): string {
    return REPORT_STATUS_LABELS[this.report.status] ?? this.report.status;
  }

  get statusColor(): string {
    return STATUS_COLORS[this.report.status] ?? STATUS_COLORS['reportado'];
  }

  get place(): string {
    return [this.report.sector, this.report.municipality].filter(Boolean).join(', ') || this.report.province || 'Ubicación en el mapa';
  }

  get age(): string {
    return timeAgo(this.report.created_at);
  }

  get distance(): string | null {
    return this.distanceKm === null ? null : formatDistance(this.distanceKm);
  }
}
