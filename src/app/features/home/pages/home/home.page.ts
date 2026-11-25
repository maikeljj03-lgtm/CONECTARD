import { ChangeDetectorRef, Component, OnDestroy, OnInit, ViewEncapsulation, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { REPORT_STATUS_LABELS, ROLE_LABELS } from '../../../../core/constants/catalogs';
import { PERMISSION_LABELS, ROLE_PERMISSIONS } from '../../../../core/constants/permissions';
import type { Profile } from '../../../../core/models/profile.model';
import type { CommunityEvent } from '../../../../core/models/community.model';
import { levelProgress, type Progress, type RankingRow } from '../../../../core/models/engagement.model';
import type { MyReport, PublicReport, ReportStatus } from '../../../../core/models/report.model';
import { EngagementService } from '../../../../core/services/engagement.service';
import { EventsService } from '../../../../core/services/events.service';
import { NotificationsService } from '../../../../core/services/notifications.service';
import { ProfileService } from '../../../../core/services/profile.service';
import { ReportMediaService } from '../../../../core/services/report-media.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { distanceKm, greetingFor, timeAgo, type LatLng } from '../../../../core/utils/geo';
import { dailyCounts, sparklinePath } from '../../../../core/utils/charts';
import { STATUS_COLORS } from '../../../../shared/components/community-scene/community-scene.component';

type Tab = 'recientes' | 'cercanos' | 'mios';

const LOCATION_KEY = 'conectard.last-location';

/**
 * Inicio de la persona con sesión (boceto "Dashboard principal").
 * Todo lo que muestra son datos reales: perfil, reportes públicos, cifras y sus propios reportes.
 */
@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  // Estilos limitados por la clase raíz .home-content.
  encapsulation: ViewEncapsulation.None,
  standalone: false,
})
export class HomePage implements OnInit, OnDestroy {
  private readonly profiles = inject(ProfileService);
  private readonly reportsService = inject(ReportsService);
  private readonly media = inject(ReportMediaService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly engagement = inject(EngagementService);
  private readonly eventsService = inject(EventsService);
  private readonly notifications = inject(NotificationsService);

  readonly roleLabels = ROLE_LABELS;
  readonly statusLabels = REPORT_STATUS_LABELS;
  readonly statusColors = STATUS_COLORS;
  readonly greeting = greetingFor();
  readonly today = new Date();
  readonly statusOrder: ReportStatus[] = ['reportado', 'en_revision', 'en_proceso', 'resuelto'];

  profile: Profile | null = null;
  reports: PublicReport[] = [];
  myReports: MyReport[] = [];
  counts: Record<ReportStatus | 'total', number> | null = null;
  loading = true;
  error = '';
  tab: Tab = 'recientes';
  location: LatLng | null = null;
  locating = false;
  locationError = '';
  selected: PublicReport | null = null;

  /** Puntos, nivel y medallas (RF-37). */
  progress: Progress | null = null;
  /** Próximas jornadas de la provincia (RF-27). */
  events: CommunityEvent[] = [];
  /** Top del mes en la provincia (RF-38). */
  top: RankingRow[] = [];
  unread = 0;
  private unreadSubscription?: Subscription;

  async ngOnInit(): Promise<void> {
    this.location = readSavedLocation();
    this.unreadSubscription = this.notifications.unread$.subscribe((count) => {
      this.unread = count;
      this.changeDetector.markForCheck();
    });
    try {
      this.profile = await this.profiles.getMyProfile();
      const province = this.profile.province;
      const [reports, counts, mine, progress, events, top] = await Promise.allSettled([
        this.reportsService.listPublic({ limit: 150 }),
        this.reportsService.countByStatus(province),
        this.reportsService.getMyReports(),
        this.engagement.myProgress(),
        this.eventsService.list({ province }),
        this.engagement.leaderboard('mes', 'personas', province, 3),
      ]);
      if (reports.status === 'fulfilled') this.reports = reports.value;
      else this.error = friendlyDataError(reports.reason);
      if (counts.status === 'fulfilled') this.counts = counts.value;
      if (mine.status === 'fulfilled') this.myReports = mine.value;
      if (progress.status === 'fulfilled') this.progress = progress.value;
      if (events.status === 'fulfilled') this.events = events.value.filter((event) => event.status === 'programado').slice(0, 3);
      if (top.status === 'fulfilled') this.top = top.value;
      if (this.location) this.tab = 'cercanos';
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  ngOnDestroy(): void {
    this.unreadSubscription?.unsubscribe();
  }

  // ---------- Pulso del día (datos reales de los reportes cargados) ----------

  private get scoped(): PublicReport[] {
    const province = this.profile?.province;
    return this.reports.filter((report) => report.status !== 'rechazado' && (!province || report.province === province));
  }

  /** Reportes nuevos desde la medianoche (hora local). */
  get newToday(): number {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return this.scoped.filter((report) => new Date(report.created_at) >= midnight).length;
  }

  /** Reportes resueltos en los últimos 7 días. */
  get resolvedThisWeek(): number {
    const since = Date.now() - 7 * 86_400_000;
    return this.scoped.filter((report) => report.status === 'resuelto' && new Date(report.status_updated_at ?? report.created_at).getTime() >= since).length;
  }

  /** Reportes por día en los últimos 14 días (el último es hoy). */
  get dailyCounts(): number[] {
    return dailyCounts(this.scoped.map((report) => report.created_at), 14);
  }

  /** Trazo de la minigráfica de 14 días (SVG de 120 × 36). */
  get sparkline(): { line: string; area: string } {
    return sparklinePath(this.dailyCounts, 120, 36);
  }

  get lastTwoWeeks(): number {
    return this.dailyCounts.reduce((sum, n) => sum + n, 0);
  }

  /** Anillo del % resuelto: largo del trazo para un círculo de radio 26. */
  get resolvedDash(): string {
    const length = 2 * Math.PI * 26;
    return `${(this.resolvedRate / 100) * length} ${length}`;
  }

  /** Anillo de nivel: largo del trazo para un círculo de radio 30. */
  get levelDash(): string {
    const length = 2 * Math.PI * 30;
    return `${((this.progress ? levelProgress(this.progress) : 0) / 100) * length} ${length}`;
  }

  get levelPercent(): number {
    return this.progress ? levelProgress(this.progress) : 0;
  }

  /** Reportes más recientes para las etiquetas flotantes de la maqueta. */
  get latestScene(): PublicReport | null {
    return this.sceneReports[0] ?? null;
  }

  /** Reportes visibles en el mapa que siguen abiertos, estén reportados o en atención. */
  get sceneOpenCount(): number {
    return this.sceneReports.filter((report) => report.status !== 'resuelto' && report.status !== 'rechazado').length;
  }

  /** Solamente los reportes visibles en el mapa que ya fueron resueltos. */
  get sceneResolvedCount(): number {
    return this.sceneReports.filter((report) => report.status === 'resuelto').length;
  }

  ago(iso: string): string {
    return timeAgo(iso);
  }

  initialsOf(name: string): string {
    return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  }

  // ---------- Cabecera ----------

  get firstName(): string {
    return this.profile?.full_name?.trim().split(/\s+/)[0] || 'Vecino';
  }

  get initials(): string {
    const name = this.profile?.full_name?.trim() || '?';
    return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  }

  get place(): string | null {
    const p = this.profile;
    if (!p) return null;
    return [...new Set([p.sector, p.municipality, p.province].filter(Boolean))].join(', ') || null;
  }

  get scopeLabel(): string {
    return this.profile?.province ? `en ${this.profile.province}` : 'en todo el país';
  }

  // ---------- Cifras ----------

  get resolvedRate(): number {
    const counts = this.counts;
    if (!counts) return 0;
    const considered = counts.total - counts.rechazado;
    return considered > 0 ? Math.round((counts.resuelto / considered) * 100) : 0;
  }

  /** Reparto por estado para la barra apilada (porcentajes). */
  get statusShares(): { status: ReportStatus; percent: number; count: number }[] {
    const counts = this.counts;
    if (!counts || !counts.total) return [];
    return this.statusOrder
      .map((status) => ({ status, count: counts[status], percent: (counts[status] / counts.total) * 100 }))
      .filter((share) => share.count > 0);
  }

  // ---------- Lista ----------

  get visibleReports(): PublicReport[] {
    if (this.tab === 'mios') {
      const mine = new Set(this.myReports.map((report) => report.id));
      return this.reports.filter((report) => mine.has(report.id)).slice(0, 8);
    }
    if (this.tab === 'cercanos' && this.location) {
      const here = this.location;
      return [...this.reports]
        .filter((report) => report.status !== 'rechazado')
        .sort((a, b) => distanceKm(here, toLatLng(a)) - distanceKm(here, toLatLng(b)))
        .slice(0, 8);
    }
    return this.reports.filter((report) => report.status !== 'rechazado').slice(0, 8);
  }

  /** Reportes para la maqueta 3D: los más recientes, sin los rechazados. */
  get sceneReports(): PublicReport[] {
    return this.reports.filter((report) => report.status !== 'rechazado');
  }

  distanceTo(report: PublicReport): number | null {
    return this.location ? distanceKm(this.location, toLatLng(report)) : null;
  }

  coverOf(report: PublicReport): string | null {
    return this.media.coverUrl(report.cover_path);
  }

  selectTab(tab: Tab): void {
    this.tab = tab;
    if (tab === 'cercanos' && !this.location) this.useMyLocation();
  }

  useMyLocation(): void {
    if (!navigator.geolocation) {
      this.locationError = 'Tu navegador no permite obtener la ubicación.';
      return;
    }
    this.locating = true;
    this.locationError = '';
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        this.location = { lat: coords.latitude, lng: coords.longitude };
        saveLocation(this.location);
        this.locating = false;
        this.tab = 'cercanos';
        this.changeDetector.markForCheck();
      },
      () => {
        this.locating = false;
        this.locationError = 'No pudimos obtener tu ubicación. Revisa el permiso del navegador.';
        if (this.tab === 'cercanos') this.tab = 'recientes';
        this.changeDetector.markForCheck();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  // ---------- Panel lateral ----------

  /** Pasos que faltan para completar el perfil. La jurisdicción institucional se registra en la solicitud. */
  get profileTodo(): string[] {
    const p = this.profile;
    if (!p) return [];
    const todo: string[] = [];
    if (!p.avatar_url) todo.push('Foto de perfil');
    if (p.role !== 'institution') {
      if (!p.province || !p.municipality) todo.push('Tu provincia y municipio');
      if (!p.sector) todo.push('Tu sector');
    }
    if (!p.bio) todo.push('Una breve presentación');
    return todo;
  }

  get profileProgress(): number {
    const total = this.profile?.role === 'institution' ? 2 : 4;
    return Math.round(((total - this.profileTodo.length) / total) * 100);
  }

  get rolePermissions(): string[] {
    return this.profile ? ROLE_PERMISSIONS[this.profile.role].map((permission) => PERMISSION_LABELS[permission]) : [];
  }

  get myOpenReports(): number {
    return this.myReports.filter((report) => report.status !== 'resuelto' && report.status !== 'rechazado').length;
  }

  get myResolvedReports(): number {
    return this.myReports.filter((report) => report.status === 'resuelto').length;
  }

  // ---------- Vista previa ----------

  open(report: PublicReport): void {
    this.selected = report;
  }

  showOnMap(report: PublicReport): void {
    this.selected = null;
    void this.router.navigate(['/explorar'], { queryParams: { reporte: report.id } });
  }
}

function toLatLng(report: PublicReport): LatLng {
  return { lat: report.latitude, lng: report.longitude };
}

function readSavedLocation(): LatLng | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(LOCATION_KEY) ?? 'null') as LatLng | null;
    return value && Number.isFinite(value.lat) && Number.isFinite(value.lng) ? value : null;
  } catch {
    return null;
  }
}

function saveLocation(location: LatLng): void {
  try {
    sessionStorage.setItem(LOCATION_KEY, JSON.stringify(location));
  } catch {
    // Sin almacenamiento: se volverá a pedir la ubicación.
  }
}
