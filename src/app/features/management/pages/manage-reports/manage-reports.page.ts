import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS } from '../../../../core/constants/catalogs';
import {
  STATUS_DESCRIPTIONS, allowedNextStatuses, statusNeedsEvidence, statusNeedsNote,
} from '../../../../core/constants/report-rules';
import type { Profile } from '../../../../core/models/profile.model';
import type { PublicReport, ReportEvidence, ReportStatus } from '../../../../core/models/report.model';
import { ProfileService } from '../../../../core/services/profile.service';
import { ReportMediaService } from '../../../../core/services/report-media.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { timeAgo } from '../../../../core/utils/geo';
import type { ProcessedMedia } from '../../../../core/utils/media';
import { STATUS_COLORS } from '../../../../shared/components/community-scene/community-scene.component';

type Filter = 'activos' | ReportStatus;

const STATUS_ORDER: ReportStatus[] = ['reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado'];

/**
 * Gestión de reportes (RF-16, RF-17).
 * - Institución: los reportes de su jurisdicción; cambia el estado y sube la evidencia del "Después".
 * - Administrador: todos los reportes, pero solo modera (rechazar o restaurar).
 */
@Component({
  selector: 'app-manage-reports',
  templateUrl: './manage-reports.page.html',
  styleUrls: ['./manage-reports.page.scss'],
  standalone: false,
})
export class ManageReportsPage implements OnInit {
  private readonly profiles = inject(ProfileService);
  private readonly reportsService = inject(ReportsService);
  private readonly media = inject(ReportMediaService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly statusLabels = REPORT_STATUS_LABELS;
  readonly statusColors = STATUS_COLORS;
  readonly statusDescriptions = STATUS_DESCRIPTIONS;
  readonly statusOrder = STATUS_ORDER;

  profile: Profile | null = null;
  reports: PublicReport[] = [];
  loading = true;
  error = '';
  feedback = '';
  filter: Filter = 'activos';
  search = '';

  /** Reporte abierto para gestionar. */
  openId: string | null = null;
  target: ReportStatus | null = null;
  note = '';
  newEvidence: ProcessedMedia[] = [];
  evidenceProcessing = false;
  evidence: (ReportEvidence & { url: string | null })[] = [];
  loadingEvidence = false;
  saving = false;
  actionError = '';
  /** Reporte en la vista previa (historial y antes/después). */
  preview: PublicReport | null = null;

  async ngOnInit(): Promise<void> {
    try {
      this.profile = await this.profiles.getMyProfile();
      await this.load();
    } catch (error) {
      this.error = friendlyDataError(error);
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  get isAdmin(): boolean {
    return this.profile?.role === 'administrator';
  }

  get isOrganization(): boolean {
    return this.profile?.role === 'organization';
  }

  /** La institución necesita una provincia en su perfil para saber qué reportes le tocan. */
  get missingJurisdiction(): boolean {
    return this.profile?.role === 'institution' && !this.profile.province;
  }

  get jurisdiction(): string {
    const p = this.profile;
    if (!p) return '';
    if (this.isAdmin) return 'todo el país';
    return [...new Set([p.municipality?.trim(), p.province].filter(Boolean))].join(', ');
  }

  count(filter: Filter): number {
    if (filter === 'activos') return this.reports.filter((report) => isActive(report.status)).length;
    return this.reports.filter((report) => report.status === filter).length;
  }

  get visible(): PublicReport[] {
    const term = normalize(this.search);
    return this.reports
      .filter((report) => (this.filter === 'activos' ? isActive(report.status) : report.status === this.filter))
      .filter((report) => !term || normalize([report.title, report.description, report.sector, report.municipality, report.address].join(' ')).includes(term))
      // Lo más antiguo primero entre los activos: es lo que más tiempo lleva esperando.
      .sort((a, b) => (this.filter === 'activos' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
  }

  categoryOf(report: PublicReport) {
    return REPORT_CATEGORIES.find((item) => item.value === report.category) ?? REPORT_CATEGORIES[REPORT_CATEGORIES.length - 1];
  }

  place(report: PublicReport): string {
    return [...new Set([report.sector, report.municipality, report.province].filter(Boolean))].join(', ') || 'Sin zona indicada';
  }

  waiting(report: PublicReport): string {
    return timeAgo(report.status_updated_at ?? report.created_at);
  }

  coverOf(report: PublicReport): string | null {
    return this.media.coverUrl(report.cover_path);
  }

  nextStatuses(report: PublicReport): ReportStatus[] {
    return allowedNextStatuses(this.profile?.role, report.status);
  }

  needsNote(status: ReportStatus | null): boolean {
    return !!status && statusNeedsNote(status);
  }

  needsEvidence(status: ReportStatus | null): boolean {
    return !!status && statusNeedsEvidence(status);
  }

  setFilter(filter: Filter): void {
    this.filter = filter;
    this.close();
  }

  async toggle(report: PublicReport): Promise<void> {
    if (this.openId === report.id) {
      this.close();
      return;
    }
    this.close();
    this.openId = report.id;
    this.feedback = '';
    if (report.evidence_count) await this.loadEvidence(report);
  }

  close(): void {
    this.openId = null;
    this.target = null;
    this.note = '';
    this.newEvidence = [];
    this.evidence = [];
    this.actionError = '';
  }

  choose(status: ReportStatus): void {
    this.target = this.target === status ? null : status;
    this.actionError = '';
  }

  /** Aplica el cambio de estado; si es "Resuelto", sube antes las fotos de evidencia. */
  async apply(report: PublicReport): Promise<void> {
    const status = this.target;
    if (!status) return;
    if (this.needsNote(status) && !this.note.trim()) {
      this.actionError = 'Escribe el motivo del rechazo: la persona que reportó lo verá.';
      return;
    }
    if (this.needsEvidence(status) && !this.newEvidence.length && !this.evidence.length) {
      this.actionError = 'Sube al menos una foto de cómo quedó el lugar.';
      return;
    }
    if (this.evidenceProcessing) {
      this.actionError = 'Espera a que terminen de procesarse las fotos.';
      return;
    }

    this.saving = true;
    this.actionError = '';
    try {
      if (this.needsEvidence(status) && this.newEvidence.length) {
        const result = await this.media.uploadEvidence(report.id, this.newEvidence);
        if (result.failed.length && !result.evidence.length && !this.evidence.length) {
          throw result.firstError ?? new Error('No se pudo subir la evidencia.');
        }
      }
      await this.reportsService.setStatus(report.id, status, this.note);
      this.feedback = `“${report.title}” pasó a ${this.statusLabels[status]}.`;
      this.close();
      await this.load();
    } catch (error) {
      this.actionError = friendlyDataError(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async removeEvidence(report: PublicReport, item: ReportEvidence): Promise<void> {
    try {
      await this.media.removeEvidence(item);
      await this.loadEvidence(report);
    } catch (error) {
      this.actionError = friendlyDataError(error);
      this.changeDetector.markForCheck();
    }
  }

  private async loadEvidence(report: PublicReport): Promise<void> {
    this.loadingEvidence = true;
    this.changeDetector.markForCheck();
    try {
      const items = await this.media.listEvidence(report.id);
      this.evidence = items.map((item) => ({ ...item, url: this.media.coverUrl(item.path) }));
    } catch {
      this.evidence = [];
    } finally {
      this.loadingEvidence = false;
      this.changeDetector.markForCheck();
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const profile = this.profile;
      if (!profile || this.missingJurisdiction) {
        this.reports = [];
      } else if (this.isOrganization) {
        this.reports = await this.reportsService.listJoined();
      } else {
        this.reports = await this.reportsService.listManaged(
          this.isAdmin ? 'all' : { province: profile.province, municipality: profile.municipality },
        );
      }
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }
}

function isActive(status: ReportStatus): boolean {
  return status !== 'resuelto' && status !== 'rechazado';
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
