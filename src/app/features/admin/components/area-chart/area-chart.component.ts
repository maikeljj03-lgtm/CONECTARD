import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export interface ChartSeries {
  label: string;
  color: string;
  values: number[];
}

const W = 640;
const H = 220;
const PAD = { top: 16, right: 12, bottom: 26, left: 34 };

/** Gráfica de área con varias series, cuadrícula y detalle al pasar el cursor (RF-40). */
@Component({
  selector: 'app-area-chart',
  templateUrl: './area-chart.component.html',
  styleUrls: ['./area-chart.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AreaChartComponent {
  @Input({ required: true }) series: ChartSeries[] = [];
  /** Etiqueta de cada punto (por ejemplo, la fecha). */
  @Input({ required: true }) labels: string[] = [];

  readonly width = W;
  readonly height = H;
  readonly pad = PAD;
  hover: number | null = null;

  get count(): number {
    return this.labels.length;
  }

  get max(): number {
    const all = this.series.flatMap((serie) => serie.values);
    const top = Math.max(1, ...all);
    // Redondea hacia arriba a un número "bonito" para la escala.
    const magnitude = Math.pow(10, Math.floor(Math.log10(top)));
    return Math.ceil(top / magnitude) * magnitude;
  }

  get ticks(): number[] {
    const max = this.max;
    return [0, max / 2, max].map((value) => Math.round(value));
  }

  x(index: number): number {
    const span = W - PAD.left - PAD.right;
    return PAD.left + (this.count > 1 ? (index / (this.count - 1)) * span : span / 2);
  }

  y(value: number): number {
    return H - PAD.bottom - (value / this.max) * (H - PAD.top - PAD.bottom);
  }

  line(values: number[]): string {
    return values.map((value, index) => `${index ? 'L' : 'M'}${this.x(index).toFixed(1)} ${this.y(value).toFixed(1)}`).join(' ');
  }

  area(values: number[]): string {
    if (!values.length) return '';
    return `${this.line(values)} L${this.x(values.length - 1).toFixed(1)} ${H - PAD.bottom} L${this.x(0).toFixed(1)} ${H - PAD.bottom} Z`;
  }

  /** Muestra una etiqueta del eje X cada cierto número de puntos. */
  showLabel(index: number): boolean {
    const step = Math.max(1, Math.ceil(this.count / 6));
    return index % step === 0 || index === this.count - 1;
  }

  onMove(event: MouseEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const relative = ((event.clientX - rect.left) / rect.width) * W;
    const span = W - PAD.left - PAD.right;
    const index = Math.round(((relative - PAD.left) / span) * (this.count - 1));
    this.hover = Math.max(0, Math.min(this.count - 1, index));
  }

  tooltipLeft(): number {
    return this.hover === null ? 0 : (this.x(this.hover) / W) * 100;
  }
}
