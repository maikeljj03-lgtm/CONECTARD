import { ChangeDetectorRef, Component, OnInit, ViewEncapsulation, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS, ROLE_LABELS } from '../../../../core/constants/catalogs';
import { isReportEditable } from '../../../../core/constants/report-rules';
import type { CommunityEvent, ReportVolunteer } from '../../../../core/models/community.model';
import type { UserRole } from '../../../../core/models/profile.model';
import type { PublicReport } from '../../../../core/models/report.model';
import { AuthService } from '../../../../core/services/auth.service';
import { CommunityService } from '../../../../core/services/community.service';
import { EventsService } from '../../../../core/services/events.service';
import { ReportMediaService } from '../../../../core/services/report-media.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { RolesService } from '../../../../core/services/roles.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { timeAgo } from '../../../../core/utils/geo';
import { STATUS_COLORS } from '../../../../shared/components/community-scene/community-scene.component';

interface MediaView {
  url: string;
  kind: 'image' | 'video';
}

/**
 * Página completa de un reporte (pública, se puede compartir):
 * apoyos "Me afecta" (RF-24), conversación (RF-25), voluntarios (RF-26), jornadas (RF-27),
 * insumos y donaciones (RF-29, RF-30) y compartir (RF-31).
 */
@Component({
  selector: 'app-report-detail',
  templateUrl: './report-detail.page.html',
  styleUrls: ['./report-detail.page.scss'],
  // Estilos limitados por la clase raíz .report-page.
  encapsulation: ViewEncapsulation.None,
  standalone: false,
})
export class ReportDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly reportsService = inject(ReportsService);
  private readonly community = inject(CommunityService);
  private readonly eventsService = inject(EventsService);
  private readonly mediaService = inject(ReportMediaService);
  private readonly roles = inject(RolesService);
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly statusLabels = REPORT_STATUS_LABELS;
  readonly roleLabels = ROLE_LABELS;
  readonly statusColors = STATUS_COLORS;

  report: PublicReport | null = null;
  media: MediaView[] = [];
  activeIndex = 0;
  volunteers: ReportVolunteer[] = [];
  events: CommunityEvent[] = [];
  role: UserRole | null = null;
  signedIn = false;
  loading = true;
  notFound = false;
  error = '';
  actionError = '';
  supporting = false;
  joining = false;

  async ngOnInit(): Promise<void> {
    this.signedIn = !!this.auth.getCachedCurrentUser();
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    try {
      const [report, role] = await Promise.all([
        this.reportsService.getPublic(id),
        this.signedIn ? this.roles.currentRole().catch(() => null) : Promise.resolve(null),
      ]);
      this.role = role;
      if (!report) {
        this.notFound = true;
        return;
      }
      this.report = report;
      const [media, volunteers, events] = await Promise.allSettled([
        report.media_count ? this.mediaService.listForReport(report.id) : Promise.resolve([]),
        this.community.listVolunteers(report.id),
        this.eventsService.listForReport(report.id),
      ]);
      if (media.status === 'fulfilled') {
        this.media = media.value
          .map((item) => ({ url: this.mediaService.coverUrl(item.path), kind: item.kind }))
          .filter((item): item is MediaView => !!item.url);
      }
      if (volunteers.status === 'fulfilled') this.volunteers = volunteers.value;
      if (events.status === 'fulfilled') this.events = events.value;
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  // ---------- Datos ----------

  get category() {
    const value = this.report?.category;
    return REPORT_CATEGORIES.find((item) => item.value === value) ?? REPORT_CATEGORIES[REPORT_CATEGORIES.length - 1];
  }

  get place(): string {
    const r = this.report;
    if (!r) return '';
    return [...new Set([r.sector, r.municipality, r.province].filter(Boolean))].join(', ') || 'Ubicación marcada en el mapa';
  }

  get age(): string {
    return this.report ? timeAgo(this.report.created_at) : '';
  }

  get beforeImage(): string | null {
    return this.media.find((item) => item.kind === 'image')?.url ?? null;
  }

  get isClosed(): boolean {
    return this.report?.status === 'resuelto' || this.report?.status === 'rechazado';
  }

  get canEdit(): boolean {
    return !!this.report?.is_mine && isReportEditable(this.report);
  }

  /** Solo quien es voluntario, ONG o administrador puede sumarse. */
  get canJoinRole(): boolean {
    return this.role === 'volunteer' || this.role === 'organization' || this.role === 'administrator';
  }

  get canOrganize(): boolean {
    return !this.isClosed && (this.role === 'organization' || this.role === 'institution' || this.role === 'administrator');
  }

  get shareText(): string {
    const r = this.report;
    if (!r) return '';
    const supports = r.support_count ? ` Ya ${r.support_count === 1 ? 'a 1 persona le afecta' : `a ${r.support_count} personas les afecta`}.` : '';
    return `${r.title} (${this.place}).${supports} Apóyalo en ConectaRD:`;
  }

  initials(name: string | null): string {
    return (name || '?').split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  }

  step(direction: -1 | 1): void {
    if (!this.media.length) return;
    this.activeIndex = (this.activeIndex + direction + this.media.length) % this.media.length;
  }

  // ---------- Acciones ----------

  /** "Me afecta" (RF-24): cambia al instante y se confirma con la base de datos. */
  async toggleSupport(): Promise<void> {
    const report = this.report;
    if (!report || this.supporting) return;
    this.supporting = true;
    this.actionError = '';
    const before = { supported: !!report.supported_by_me, count: report.support_count ?? 0 };
    this.report = { ...report, supported_by_me: !before.supported, support_count: before.count + (before.supported ? -1 : 1) };
    try {
      const supported = await this.community.toggleSupport(report.id);
      this.report = { ...this.report, supported_by_me: supported, support_count: before.count + (supported === before.supported ? 0 : supported ? 1 : -1) };
    } catch (error) {
      this.report = { ...this.report, supported_by_me: before.supported, support_count: before.count };
      this.actionError = friendlyDataError(error);
    } finally {
      this.supporting = false;
      this.changeDetector.markForCheck();
    }
  }

  /** "Sumarme como voluntario" (RF-26). */
  async toggleVolunteer(): Promise<void> {
    const report = this.report;
    if (!report || this.joining) return;
    this.joining = true;
    this.actionError = '';
    try {
      const joined = await this.community.toggleVolunteer(report.id);
      this.volunteers = await this.community.listVolunteers(report.id);
      this.report = { ...report, joined_by_me: joined, volunteer_count: this.volunteers.length };
    } catch (error) {
      this.actionError = friendlyDataError(error);
    } finally {
      this.joining = false;
      this.changeDetector.markForCheck();
    }
  }

  onCommentCount(count: number): void {
    if (this.report && this.report.comment_count !== count) {
      this.report = { ...this.report, comment_count: count };
      this.changeDetector.markForCheck();
    }
  }
}
