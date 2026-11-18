import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FLAG_REASONS, type FlagQueueItem, type FlagReason } from '../../../../core/models/engagement.model';
import { EngagementService } from '../../../../core/services/engagement.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { timeAgo } from '../../../../core/utils/geo';

type Status = 'pendiente' | 'atendida' | 'descartada';

/** Bandeja de moderación (RF-32): denuncias agrupadas por contenido. Solo administradores. */
@Component({
  selector: 'app-admin-flags',
  templateUrl: './flags.page.html',
  styleUrls: ['./flags.page.scss'],
  standalone: false,
})
export class AdminFlagsPage implements OnInit {
  private readonly engagement = inject(EngagementService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  status: Status = 'pendiente';
  items: FlagQueueItem[] = [];
  notes: Record<string, string> = {};
  loading = true;
  busyId: string | null = null;
  error = '';
  feedback = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async setStatus(status: Status): Promise<void> {
    this.status = status;
    await this.load();
  }

  reasonLabel(reason: FlagReason): string {
    return FLAG_REASONS.find((item) => item.value === reason)?.label ?? reason;
  }

  kindLabel(item: FlagQueueItem): string {
    return item.target_type === 'report' ? 'Reporte' : item.target_type === 'comment' ? 'Comentario' : 'Jornada';
  }

  actionLabel(item: FlagQueueItem): string {
    return item.target_type === 'report' ? 'Rechazar reporte' : item.target_type === 'comment' ? 'Retirar comentario' : 'Cancelar jornada';
  }

  link(item: FlagQueueItem): string[] | null {
    if (item.target_type === 'event') return ['/jornadas', item.target_id];
    return item.report_id ? ['/reporte', item.report_id] : null;
  }

  age(iso: string): string {
    return timeAgo(iso);
  }

  async resolve(item: FlagQueueItem, accept: boolean): Promise<void> {
    const note = this.notes[item.target_id] ?? '';
    if (accept && !note.trim()) {
      this.error = 'Escribe el motivo: se le mostrará a quien publicó el contenido.';
      return;
    }
    this.busyId = item.target_id;
    this.error = '';
    this.feedback = '';
    try {
      await this.engagement.resolveFlags(item.target_type, item.target_id, accept, note);
      this.items = this.items.filter((candidate) => candidate.target_id !== item.target_id);
      this.feedback = accept ? `${this.actionLabel(item)}: hecho. Se avisó a quien lo publicó.` : 'Denuncias descartadas: el contenido sigue publicado.';
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.busyId = null;
      this.changeDetector.markForCheck();
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.changeDetector.markForCheck();
    try {
      this.items = await this.engagement.flagQueue(this.status);
    } catch (error) {
      this.error = friendlyDataError(error);
      this.items = [];
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }
}
