import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import { ROLE_LABELS } from '../../../core/constants/catalogs';
import type { CommentThread, ReportComment } from '../../../core/models/community.model';
import type { UserRole } from '../../../core/models/profile.model';
import { CommunityService } from '../../../core/services/community.service';
import { friendlyDataError } from '../../../core/utils/data-errors';
import { timeAgo } from '../../../core/utils/geo';

const MAX_LENGTH = 1000;

/** Comentarios e hilos de un reporte para coordinar soluciones (RF-25). */
@Component({
  selector: 'app-report-comments',
  templateUrl: './report-comments.component.html',
  styleUrls: ['./report-comments.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportCommentsComponent implements OnChanges {
  private readonly community = inject(CommunityService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  @Input({ required: true }) reportId!: string;
  /** Rol de quien mira (null sin sesión). */
  @Input() role: UserRole | null = null;
  /** No se aceptan comentarios nuevos (reporte rechazado). */
  @Input() closed = false;
  /** Avisa cuántos comentarios visibles hay (para el contador del reporte). */
  @Output() readonly countChange = new EventEmitter<number>();

  readonly maxLength = MAX_LENGTH;
  readonly roleLabels = ROLE_LABELS;

  threads: CommentThread[] = [];
  loading = true;
  error = '';
  draft = '';
  sending = false;
  replyingTo: string | null = null;
  replyDraft = '';
  editingId: string | null = null;
  editDraft = '';
  busyId: string | null = null;

  get signedIn(): boolean {
    return !!this.role;
  }

  get isAdmin(): boolean {
    return this.role === 'administrator';
  }

  get total(): number {
    return this.threads.reduce((sum, thread) => sum + (thread.is_deleted ? 0 : 1) + thread.replies.length, 0);
  }

  async ngOnChanges(): Promise<void> {
    await this.load();
  }

  age(comment: ReportComment): string {
    return timeAgo(comment.created_at);
  }

  displayName(comment: ReportComment): string {
    if (comment.is_report_author && !comment.author_name) return 'Autor del reporte';
    return comment.author_name || 'Vecino';
  }

  /** Insignia junto al nombre: autor del reporte, institución, ONG o voluntario. */
  badge(comment: ReportComment): string | null {
    if (comment.is_report_author) return 'Autor del reporte';
    if (comment.author_role && comment.author_role !== 'citizen') return this.roleLabels[comment.author_role];
    return null;
  }

  initials(comment: ReportComment): string {
    const name = this.displayName(comment);
    return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  }

  canModify(comment: ReportComment): boolean {
    return !comment.is_deleted && (!!comment.is_mine || this.isAdmin);
  }

  async send(): Promise<void> {
    const body = this.draft.trim();
    if (!body || this.sending) return;
    this.sending = true;
    this.error = '';
    try {
      await this.community.addComment(this.reportId, body);
      this.draft = '';
      await this.load();
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.sending = false;
      this.changeDetector.markForCheck();
    }
  }

  startReply(thread: CommentThread): void {
    this.replyingTo = this.replyingTo === thread.id ? null : thread.id;
    this.replyDraft = '';
    this.editingId = null;
  }

  async sendReply(thread: CommentThread): Promise<void> {
    const body = this.replyDraft.trim();
    if (!body) return;
    this.busyId = thread.id;
    this.error = '';
    try {
      await this.community.addComment(this.reportId, body, thread.id);
      this.replyingTo = null;
      this.replyDraft = '';
      await this.load();
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.busyId = null;
      this.changeDetector.markForCheck();
    }
  }

  startEdit(comment: ReportComment): void {
    this.editingId = comment.id;
    this.editDraft = comment.body ?? '';
    this.replyingTo = null;
  }

  async saveEdit(comment: ReportComment): Promise<void> {
    const body = this.editDraft.trim();
    if (!body) return;
    this.busyId = comment.id;
    this.error = '';
    try {
      await this.community.editComment(comment.id, body);
      this.editingId = null;
      await this.load();
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.busyId = null;
      this.changeDetector.markForCheck();
    }
  }

  async remove(comment: ReportComment): Promise<void> {
    const question = comment.is_mine ? '¿Eliminar tu comentario?' : '¿Eliminar este comentario por moderación?';
    if (!window.confirm(question)) return;
    this.busyId = comment.id;
    this.error = '';
    try {
      await this.community.deleteComment(comment.id);
      await this.load();
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.busyId = null;
      this.changeDetector.markForCheck();
    }
  }

  /** Ctrl/Cmd + Enter envía el comentario. */
  submitKey(event: KeyboardEvent): boolean {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      return true;
    }
    return false;
  }

  private async load(): Promise<void> {
    if (!this.reportId) return;
    this.loading = true;
    this.changeDetector.markForCheck();
    try {
      this.threads = await this.community.listComments(this.reportId);
      this.countChange.emit(this.total);
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }
}
