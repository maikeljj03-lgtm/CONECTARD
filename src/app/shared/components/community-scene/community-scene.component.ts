import {
  ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, inject,
} from '@angular/core';
import { REPORT_CATEGORIES } from '../../../core/constants/catalogs';
import { DR_OUTLINE_PATH, DR_VIEWBOX, projectToOutline } from '../../../core/constants/dr-outline';
import type { PublicReport } from '../../../core/models/report.model';
import type { LatLng } from '../../../core/utils/geo';

/** Colores por estado del ciclo de vida (RF-16). */
export const STATUS_COLORS: Record<string, string> = {
  reportado: '#8a9693',
  en_revision: '#4d7fb8',
  en_proceso: '#e9a13b',
  resuelto: '#00b2a9',
  rechazado: '#d0645a',
};

interface ScenePin {
  report: PublicReport;
  x: number;
  y: number;
  /** Altura de la columna en px: crece con lo reciente que es el reporte. */
  height: number;
  color: string;
  delay: number;
  fresh: boolean;
  label: string;
}

const MAX_PINS = 60;

/**
 * Maqueta 3D de República Dominicana con los reportes reales como columnas de luz.
 * CSS 3D puro (sin librerías). Respeta "reducir movimiento" del sistema.
 */
@Component({
  selector: 'app-community-scene',
  templateUrl: './community-scene.component.html',
  styleUrls: ['./community-scene.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(pointermove)': 'onPointerMove($event)',
    '(pointerleave)': 'onPointerLeave()',
  },
})
export class CommunitySceneComponent implements OnChanges, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);

  @Input() reports: PublicReport[] = [];
  /** Ubicación de la persona (muestra un faro "Tú"). */
  @Input() userLocation: LatLng | null = null;
  /** Escena más compacta (para la landing). */
  @Input() compact = false;
  @Output() readonly selectReport = new EventEmitter<PublicReport>();

  readonly outlinePath = DR_OUTLINE_PATH;
  readonly viewBox = `0 0 ${DR_VIEWBOX.width} ${DR_VIEWBOX.height}`;
  readonly aspect = DR_VIEWBOX.width / DR_VIEWBOX.height;
  readonly statusColors = STATUS_COLORS;
  pins: ScenePin[] = [];
  userPoint: { x: number; y: number } | null = null;
  private frame = 0;

  ngOnChanges(): void {
    const now = Date.now();
    const recent = [...this.reports]
      .filter((report) => Number.isFinite(report.latitude) && Number.isFinite(report.longitude))
      .slice(0, MAX_PINS);
    this.pins = recent.map((report, index) => {
      const point = projectToOutline(report.latitude, report.longitude);
      const ageDays = (now - new Date(report.created_at).getTime()) / 86_400_000;
      // Más alto = más reciente (máx. 120 px los de hoy, mín. 36 px los de hace un mes o más).
      const height = Math.round(36 + 84 * Math.max(0, 1 - Math.min(ageDays, 30) / 30));
      return {
        report,
        x: point.x,
        y: point.y,
        height,
        color: STATUS_COLORS[report.status] ?? STATUS_COLORS['reportado'],
        delay: 250 + index * 55,
        fresh: ageDays < 1,
        label: `${categoryLabel(report.category)} · ${report.title}`,
      };
    });
    this.userPoint = this.userLocation ? projectToOutline(this.userLocation.lat, this.userLocation.lng) : null;
  }

  trackPin(_: number, pin: ScenePin): string {
    return pin.report.id;
  }

  /** Paralaje: la maqueta se inclina siguiendo el cursor (sin pasar por Angular). */
  onPointerMove(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') return;
    const element = this.host.nativeElement;
    const rect = element.getBoundingClientRect();
    const dx = (event.clientX - rect.left) / rect.width - 0.5;
    const dy = (event.clientY - rect.top) / rect.height - 0.5;
    cancelAnimationFrame(this.frame);
    this.zone.runOutsideAngular(() => {
      this.frame = requestAnimationFrame(() => {
        element.style.setProperty('--px', `${(dx * 10).toFixed(2)}deg`);
        element.style.setProperty('--py', `${(-dy * 8).toFixed(2)}deg`);
      });
    });
  }

  onPointerLeave(): void {
    cancelAnimationFrame(this.frame);
    this.host.nativeElement.style.setProperty('--px', '0deg');
    this.host.nativeElement.style.setProperty('--py', '0deg');
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
  }
}

function categoryLabel(value: string): string {
  return REPORT_CATEGORIES.find((category) => category.value === value)?.label ?? 'Reporte';
}
