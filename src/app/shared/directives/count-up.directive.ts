import { Directive, ElementRef, Input, OnChanges, OnDestroy, inject } from '@angular/core';

/**
 * Anima un número desde su valor anterior hasta el nuevo (cuenta hacia arriba):
 *   <strong [appCountUp]="total"></strong>
 * Respeta "reducir movimiento" del sistema y usa el formato de número de RD (12,345).
 */
@Directive({
  selector: '[appCountUp]',
  standalone: false,
})
export class CountUpDirective implements OnChanges, OnDestroy {
  private readonly element = inject(ElementRef<HTMLElement>);
  private frame = 0;
  private current = 0;

  @Input({ required: true }) appCountUp: number | null | undefined = 0;
  /** Duración en milisegundos. */
  @Input() countUpDuration = 1100;
  /** Texto que se añade al final (p. ej. " %"). */
  @Input() countUpSuffix = '';

  private readonly format = new Intl.NumberFormat('es-DO');

  ngOnChanges(): void {
    const target = Math.max(0, Math.round(Number(this.appCountUp) || 0));
    cancelAnimationFrame(this.frame);
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || target === this.current) {
      this.render(target);
      return;
    }
    const from = this.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / this.countUpDuration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.render(Math.round(from + (target - from) * eased));
      if (t < 1) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
  }

  private render(value: number): void {
    this.current = value;
    this.element.nativeElement.textContent = this.format.format(value) + this.countUpSuffix;
  }
}
