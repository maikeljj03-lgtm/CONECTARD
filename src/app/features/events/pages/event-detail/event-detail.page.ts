import { ChangeDetectorRef, Component, HostListener, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toDataURL } from 'qrcode';
import { ROLE_LABELS } from '../../../../core/constants/catalogs';
import type { CommunityEvent, EventRosterEntry } from '../../../../core/models/community.model';
import type { UserRole } from '../../../../core/models/profile.model';
import type { PublicReport } from '../../../../core/models/report.model';
import { AuthService } from '../../../../core/services/auth.service';
import { EventsService } from '../../../../core/services/events.service';
import { ReportMediaService } from '../../../../core/services/report-media.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { RolesService } from '../../../../core/services/roles.service';
import { buildIcs } from '../../../../core/utils/calendar';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { rememberReturnUrl } from '../../../../core/utils/return-url';

/**
 * Detalle de una jornada (RF-27) con inscripción y pase de lista por QR (RF-28).
 * - Voluntario: se inscribe y, el día de la jornada, escanea el QR para confirmar su asistencia.
 * - Quien organiza: muestra el QR, ve la lista y marca asistencia a mano.
 */
@Component({
  selector: 'app-event-detail',
  templateUrl: './event-detail.page.html',
  styleUrls: ['./event-detail.page.scss'],
  standalone: false,
})
export class EventDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly eventsService = inject(EventsService);
  private readonly reportsService = inject(ReportsService);
  private readonly media = inject(ReportMediaService);
  private readonly roles = inject(RolesService);
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly roleLabels = ROLE_LABELS;

  event: CommunityEvent | null = null;
  reports: PublicReport[] = [];
  role: UserRole | null = null;
  signedIn = false;
  loading = true;
  notFound = false;
  error = '';
  actionError = '';
  feedback = '';
  busy = false;
  selectedReport: PublicReport | null = null;

  // Pase de lista (RF-28)
  checkInState: 'idle' | 'working' | 'done' | 'failed' | 'login' = 'idle';
  checkInMessage = '';
  qrUrl = '';
  qrImage = '';
  qrLoading = false;
  qrFullscreen = false;
  roster: EventRosterEntry[] = [];
  rosterLoading = false;
  rosterBusy: string | null = null;

  async ngOnInit(): Promise<void> {
    this.signedIn = !!this.auth.getCachedCurrentUser();
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    const code = this.route.snapshot.queryParamMap.get('asistencia');
    try {
      const [event, role] = await Promise.all([
        this.eventsService.get(id),
        this.signedIn ? this.roles.currentRole().catch(() => null) : Promise.resolve(null),
      ]);
      this.role = role;
      if (!event) {
        this.notFound = true;
        return;
      }
      this.event = event;
      const ids = await this.eventsService.reportIds(id).catch(() => []);
      this.reports = await this.reportsService.listPublicByIds(ids).catch(() => []);
      if (event.is_organizer || role === 'administrator') void this.loadRoster();
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
    if (code && this.event) await this.checkIn(code);
  }

  // ---------- Datos ----------

  get isOrganizer(): boolean {
    return !!this.event?.is_organizer || this.role === 'administrator';
  }

  get isOpen(): boolean {
    return this.event?.status === 'programado';
  }

  get isFull(): boolean {
    const e = this.event;
    return !!e && e.capacity !== null && e.attendee_count >= e.capacity;
  }

  get canRegisterRole(): boolean {
    return this.role === 'volunteer' || this.role === 'organization' || this.role === 'administrator';
  }

  /** El pase de lista está abierto desde 1 hora antes hasta 2 horas después (como en la base de datos). */
  get checkInWindowOpen(): boolean {
    const e = this.event;
    if (!e || e.status === 'cancelado') return false;
    const now = Date.now();
    return now >= new Date(e.starts_at).getTime() - 3_600_000 && now <= new Date(e.ends_at).getTime() + 7_200_000;
  }

  get capacityPercent(): number {
    const e = this.event;
    if (!e || !e.capacity) return 0;
    return Math.min(100, Math.round((e.attendee_count / e.capacity) * 100));
  }

  get place(): string {
    const e = this.event;
    if (!e) return '';
    // Sin repetir (p. ej. municipio y provincia "Distrito Nacional").
    return [...new Set([e.location_name, e.municipality, e.province].filter(Boolean))].join(', ');
  }

  get directionsUrl(): string | null {
    const e = this.event;
    if (!e) return null;
    const destination = e.latitude !== null && e.longitude !== null ? `${e.latitude},${e.longitude}` : this.place;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
  }

  get shareText(): string {
    const e = this.event;
    if (!e) return '';
    const date = new Date(e.starts_at).toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' });
    return `${e.title}: ${date} en ${e.location_name}. ¡Súmate como voluntario!`;
  }

  get presentCount(): number {
    return this.roster.filter((entry) => entry.checked_in_at).length;
  }

  coverOf(report: PublicReport): string | null {
    return this.media.coverUrl(report.cover_path);
  }

  initials(name: string | null): string {
    return (name || '?').split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  }

  // ---------- Inscripción y asistencia ----------

  async toggleRegistration(): Promise<void> {
    const event = this.event;
    if (!event || this.busy) return;
    this.busy = true;
    this.actionError = '';
    this.feedback = '';
    try {
      const registered = await this.eventsService.toggleRegistration(event.id);
      this.event = (await this.eventsService.get(event.id)) ?? event;
      this.feedback = registered
        ? '¡Listo! Estás inscrito. El día de la jornada escanea el código QR que mostrará quien organiza para confirmar tu asistencia.'
        : 'Cancelaste tu inscripción.';
    } catch (error) {
      this.actionError = friendlyDataError(error);
    } finally {
      this.busy = false;
      this.changeDetector.markForCheck();
    }
  }

  /** Confirma la asistencia con el código del QR (llega en el enlace ?asistencia=...). */
  private async checkIn(code: string): Promise<void> {
    const event = this.event!;
    if (!this.signedIn) {
      // Al iniciar sesión volverá a esta misma dirección y se confirmará solo.
      rememberReturnUrl(this.router.url);
      this.checkInState = 'login';
      this.changeDetector.markForCheck();
      return;
    }
    this.checkInState = 'working';
    this.changeDetector.markForCheck();
    try {
      await this.eventsService.checkIn(event.id, code);
      this.checkInState = 'done';
      this.checkInMessage = '¡Asistencia confirmada! Gracias por sumarte.';
      this.event = (await this.eventsService.get(event.id)) ?? event;
    } catch (error) {
      this.checkInState = 'failed';
      this.checkInMessage = friendlyDataError(error);
    } finally {
      // Se quita el código de la dirección para que no quede en el historial ni se comparta.
      void this.router.navigate([], { queryParams: { asistencia: null }, queryParamsHandling: 'merge', replaceUrl: true });
      this.changeDetector.markForCheck();
    }
  }

  goToLogin(): void {
    void this.router.navigateByUrl('/auth/login');
  }

  // ---------- Panel de quien organiza ----------

  async showQr(regenerate = false): Promise<void> {
    const event = this.event;
    if (!event) return;
    if (regenerate && !window.confirm('¿Cambiar el código? El QR anterior dejará de funcionar (útil si alguien lo compartió fuera de la jornada).')) return;
    this.qrLoading = true;
    this.actionError = '';
    this.changeDetector.markForCheck();
    try {
      const code = await this.eventsService.checkinCode(event.id, regenerate);
      this.qrUrl = new URL(`/jornadas/${event.id}?asistencia=${encodeURIComponent(code)}`, window.location.origin).toString();
      this.qrImage = await toDataURL(this.qrUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 720,
        color: { dark: '#13282b', light: '#ffffff' },
      });
    } catch (error) {
      this.actionError = friendlyDataError(error);
    } finally {
      this.qrLoading = false;
      this.changeDetector.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  closeFullscreen(): void {
    this.qrFullscreen = false;
  }

  async loadRoster(): Promise<void> {
    if (!this.event) return;
    this.rosterLoading = true;
    this.changeDetector.markForCheck();
    try {
      this.roster = await this.eventsService.roster(this.event.id);
    } catch (error) {
      this.actionError = friendlyDataError(error);
    } finally {
      this.rosterLoading = false;
      this.changeDetector.markForCheck();
    }
  }

  async setAttendance(entry: EventRosterEntry, present: boolean): Promise<void> {
    if (!this.event) return;
    this.rosterBusy = entry.user_id;
    try {
      await this.eventsService.setAttendance(this.event.id, entry.user_id, present);
      this.roster = this.roster.map((item) => (item.user_id === entry.user_id ? { ...item, checked_in_at: present ? new Date().toISOString() : null } : item));
      this.event = { ...this.event, checked_in_count: this.presentCount };
    } catch (error) {
      this.actionError = friendlyDataError(error);
    } finally {
      this.rosterBusy = null;
      this.changeDetector.markForCheck();
    }
  }

  async cancelEvent(): Promise<void> {
    const event = this.event;
    if (!event || !window.confirm('¿Cancelar esta jornada? Las personas inscritas la verán como cancelada.')) return;
    this.busy = true;
    try {
      await this.eventsService.setStatus(event.id, 'cancelado');
      this.event = (await this.eventsService.get(event.id)) ?? event;
      this.feedback = 'La jornada quedó cancelada.';
    } catch (error) {
      this.actionError = friendlyDataError(error);
    } finally {
      this.busy = false;
      this.changeDetector.markForCheck();
    }
  }

  /** Descarga un .ics para agregar la jornada al calendario. */
  addToCalendar(): void {
    const event = this.event;
    if (!event) return;
    const ics = buildIcs({
      id: event.id,
      title: event.title,
      description: event.description,
      location: this.place,
      start: event.starts_at,
      end: event.ends_at,
      url: new URL(`/jornadas/${event.id}`, window.location.origin).toString(),
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    link.download = 'jornada-conectard.ics';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
}
