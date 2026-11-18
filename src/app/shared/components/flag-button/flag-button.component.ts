import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, Input, inject } from '@angular/core';
import { FLAG_REASONS, type FlagReason, type FlagTarget } from '../../../core/models/engagement.model';
import { EngagementService } from '../../../core/services/engagement.service';
import { friendlyDataError } from '../../../core/utils/data-errors';

/** "Denunciar" un reporte, comentario o jornada (RF-32). La moderación lo revisa en Administración → Denuncias. */
@Component({
  selector: 'app-flag-button',
  templateUrl: './flag-button.component.html',
  styleUrls: ['./flag-button.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlagButtonComponent {
  private readonly engagement = inject(EngagementService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly changeDetector = inject(ChangeDetectorRef);

  @Input({ required: true }) kind!: FlagTarget;
  @Input({ required: true }) targetId!: string;
  /** Estilo de enlace pequeño (para comentarios). */
  @Input() compact = false;

  readonly reasons = FLAG_REASONS;
  open = false;
  reason: FlagReason | null = null;
  details = '';
  sending = false;
  done = false;
  error = '';

  get what(): string {
    return this.kind === 'report' ? 'este reporte' : this.kind === 'comment' ? 'este comentario' : 'esta jornada';
  }

  toggle(): void {
    this.open = !this.open;
    this.error = '';
  }

  async send(): Promise<void> {
    if (!this.reason || this.sending) return;
    if (this.reason === 'otro' && !this.details.trim()) {
      this.error = 'Cuéntanos brevemente el motivo.';
      return;
    }
    this.sending = true;
    this.error = '';
    this.changeDetector.markForCheck();
    try {
      await this.engagement.flag(this.kind, this.targetId, this.reason, this.details);
      this.done = true;
      this.open = false;
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.sending = false;
      this.changeDetector.markForCheck();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) {
      this.open = false;
      this.changeDetector.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  close(): void {
    if (this.open) {
      this.open = false;
      this.changeDetector.markForCheck();
    }
  }
}
