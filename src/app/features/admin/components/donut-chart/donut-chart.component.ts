import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/** Gráfica de dona con leyenda y porcentajes (RF-40). */
@Component({
  selector: 'app-donut-chart',
  template: `
    <div class="donut">
      <svg viewBox="0 0 120 120" role="img" [attr.aria-label]="centerLabel + ': ' + total">
        <circle class="donut__track" cx="60" cy="60" r="46"></circle>
        @for (arc of arcs; track arc.label) {
          <circle class="donut__arc" cx="60" cy="60" r="46" [attr.stroke]="arc.color"
            [attr.stroke-dasharray]="arc.length + ' ' + circumference" [attr.stroke-dashoffset]="-arc.offset">
            <title>{{ arc.label }}: {{ arc.value }}</title>
          </circle>
        }
      </svg>
      <div class="donut__center"><strong>{{ total }}</strong><small>{{ centerLabel }}</small></div>
    </div>
    <ul class="legend">
      @for (arc of arcs; track arc.label) {
        <li><i [style.background]="arc.color"></i><span>{{ arc.label }}</span><b>{{ arc.value }}</b><em>{{ arc.percent }}%</em></li>
      }
    </ul>
  `,
  styles: [`
    :host { display: grid; grid-template-columns: 150px minmax(0, 1fr); align-items: center; gap: 20px; }
    .donut { position: relative; width: 150px; height: 150px; }
    svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .donut__track { fill: none; stroke: var(--crd-surface-2); stroke-width: 16; }
    .donut__arc { fill: none; stroke-width: 16; transition: stroke-dasharray .8s cubic-bezier(.2, .7, .2, 1); }
    .donut__center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
    .donut__center strong { color: var(--crd-ink); font-family: var(--crd-font-display); font-size: 28px; line-height: 1; }
    .donut__center small { color: var(--crd-text-3); font-size: 11.5px; }
    .legend { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .legend li { display: grid; grid-template-columns: 10px 1fr auto 44px; align-items: center; gap: 8px; color: var(--crd-text-2); font-size: 13px; }
    .legend i { width: 10px; height: 10px; border-radius: 3px; }
    .legend b { color: var(--crd-ink); }
    .legend em { color: var(--crd-text-3); font-size: 12px; font-style: normal; text-align: right; }
    @media (max-width: 480px) { :host { grid-template-columns: 1fr; justify-items: center; } .legend { width: 100%; } }
  `],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DonutChartComponent {
  @Input({ required: true }) segments: DonutSegment[] = [];
  @Input() centerLabel = 'total';

  readonly circumference = 2 * Math.PI * 46;

  get total(): number {
    return this.segments.reduce((sum, segment) => sum + segment.value, 0);
  }

  get arcs(): (DonutSegment & { length: number; offset: number; percent: number })[] {
    const total = this.total || 1;
    let offset = 0;
    return this.segments
      .filter((segment) => segment.value > 0)
      .map((segment) => {
        const length = (segment.value / total) * this.circumference;
        const arc = { ...segment, length, offset, percent: Math.round((segment.value / total) * 100) };
        offset += length;
        return arc;
      });
  }
}
