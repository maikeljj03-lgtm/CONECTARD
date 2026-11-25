import { ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { REPORT_CATEGORIES } from '../../../../core/constants/catalogs';
import { DR_MAP_VIEW, isInsideDominicanRepublic } from '../../../../core/constants/geography';
import { LANGUAGES, t, type Language } from '../../../../core/i18n/i18n';
import { PlatformService, ALERT_RADII, MAX_ALERTS, type AlertRadius, type AlertSubscription } from '../../../../core/services/platform.service';
import { PreferencesService, type ThemePreference } from '../../../../core/services/preferences.service';
import { PwaService, type InstallState } from '../../../../core/services/pwa.service';
import { SecurityService, type MfaStatus, type TotpEnrollment } from '../../../../core/services/security.service';
import { downloadCertificatePdf } from '../../../../core/utils/certificate-pdf';
import { friendlyDataError } from '../../../../core/utils/data-errors';

interface AlertDraft {
  id: string | null;
  label: string;
  latitude: number | null;
  longitude: number | null;
  radius_m: AlertRadius;
  categories: Set<string>;
  active: boolean;
}

/**
 * Ajustes (módulo 8): tema (RF-49), idioma (RF-56), instalar la app (RF-48), ahorro de datos (RF-60),
 * alertas por radio (RF-61), verificación en dos pasos (RF-53) y constancia de voluntariado (RF-62).
 */
@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage implements OnInit, OnDestroy {
  private readonly preferences = inject(PreferencesService);
  private readonly pwa = inject(PwaService);
  private readonly platform = inject(PlatformService);
  private readonly security = inject(SecurityService);
  private readonly zone = inject(NgZone);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly subscriptions = new Subscription();
  @ViewChild('alertMap') private alertMapElement?: ElementRef<HTMLDivElement>;
  private map?: L.Map;
  private marker?: L.Marker;
  private circle?: L.Circle;

  readonly languages = LANGUAGES;
  readonly categories = REPORT_CATEGORIES;
  readonly radii = ALERT_RADII;
  readonly maxAlerts = MAX_ALERTS;
  readonly themes: { value: ThemePreference; icon: string; label: string }[] = [
    { value: 'system', icon: 'smartphone', label: t('theme.system') },
    { value: 'light', icon: 'sun', label: t('theme.light') },
    { value: 'dark', icon: 'moon', label: t('theme.dark') },
  ];

  theme: ThemePreference = this.preferences.theme;
  language: Language = this.preferences.language;
  dataSaver = this.preferences.dataSaver;
  installState: InstallState = 'manual';

  alerts: AlertSubscription[] = [];
  alertsLoading = true;
  alertsError = '';
  alertsFeedback = '';
  draft: AlertDraft | null = null;
  savingAlert = false;
  locating = false;

  mfa: MfaStatus | null = null;
  mfaError = '';
  mfaFeedback = '';
  enrollment: TotpEnrollment | null = null;
  mfaCode = '';
  mfaBusy = false;

  certBusy = false;
  certError = '';
  certFeedback = '';

  async ngOnInit(): Promise<void> {
    this.subscriptions.add(this.pwa.installState$.subscribe((state) => {
      this.installState = state;
      this.changeDetector.markForCheck();
    }));
    await Promise.all([this.loadAlerts(), this.loadMfa()]);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.map?.remove();
  }

  radiusLabel(radius: number): string {
    return radius >= 1000 ? `${radius / 1000} km` : `${radius} m`;
  }

  categoryLabel(value: string): string {
    return this.categories.find((item) => item.value === value)?.label ?? value;
  }

  alertCategories(alert: AlertSubscription): string {
    return alert.categories?.length ? alert.categories.map((value) => this.categoryLabel(value)).join(', ') : t('alerts.all');
  }

  // ---------- Apariencia, idioma, app y datos ----------

  setTheme(theme: ThemePreference): void {
    this.theme = theme;
    this.preferences.setTheme(theme);
  }

  setLanguage(language: Language): void {
    this.preferences.setLanguage(language);
  }

  toggleDataSaver(): void {
    this.dataSaver = !this.dataSaver;
    this.preferences.setDataSaver(this.dataSaver);
  }

  async install(): Promise<void> {
    await this.pwa.install();
    this.changeDetector.markForCheck();
  }

  // ---------- RF-61: alertas ----------

  newAlert(): void {
    this.alertsFeedback = '';
    this.alertsError = '';
    this.draft = { id: null, label: '', latitude: null, longitude: null, radius_m: 1000, categories: new Set(), active: true };
    this.openMapSoon();
  }

  editAlert(alert: AlertSubscription): void {
    this.alertsFeedback = '';
    this.alertsError = '';
    this.draft = {
      id: alert.id, label: alert.label, latitude: alert.latitude, longitude: alert.longitude,
      radius_m: alert.radius_m, categories: new Set(alert.categories ?? []), active: alert.active,
    };
    this.openMapSoon();
  }

  cancelAlert(): void {
    this.draft = null;
    this.destroyMap();
  }

  toggleDraftCategory(value: string): void {
    if (!this.draft) return;
    if (this.draft.categories.has(value)) this.draft.categories.delete(value);
    else this.draft.categories.add(value);
  }

  setDraftRadius(radius: AlertRadius): void {
    if (!this.draft) return;
    this.draft.radius_m = radius;
    this.circle?.setRadius(radius);
    this.fitCircle();
  }

  useMyLocation(): void {
    if (!navigator.geolocation) {
      this.alertsError = t('alerts.pick');
      return;
    }
    this.locating = true;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => this.zone.run(() => {
        this.locating = false;
        if (isInsideDominicanRepublic(coords.latitude, coords.longitude)) this.setPoint(coords.latitude, coords.longitude, true);
        else this.alertsError = t('alerts.pick');
        this.changeDetector.markForCheck();
      }),
      () => this.zone.run(() => {
        this.locating = false;
        this.alertsError = t('alerts.pick');
        this.changeDetector.markForCheck();
      }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  async saveAlert(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    if (draft.latitude === null || draft.longitude === null) {
      this.alertsError = t('alerts.needPoint');
      return;
    }
    this.savingAlert = true;
    this.alertsError = '';
    try {
      await this.platform.saveAlert({
        id: draft.id, label: draft.label, latitude: draft.latitude, longitude: draft.longitude,
        radius_m: draft.radius_m, categories: [...draft.categories], active: draft.active,
      });
      this.draft = null;
      this.destroyMap();
      this.alertsFeedback = t('alerts.saved');
      await this.loadAlerts();
    } catch (error) {
      this.alertsError = friendlyDataError(error);
    } finally {
      this.savingAlert = false;
      this.changeDetector.markForCheck();
    }
  }

  async toggleAlert(alert: AlertSubscription): Promise<void> {
    try {
      await this.platform.saveAlert({ ...alert, categories: alert.categories ?? [], active: !alert.active });
      await this.loadAlerts();
    } catch (error) {
      this.alertsError = friendlyDataError(error);
    }
    this.changeDetector.markForCheck();
  }

  async deleteAlert(alert: AlertSubscription): Promise<void> {
    try {
      await this.platform.deleteAlert(alert.id);
      this.alertsFeedback = t('alerts.deleted');
      await this.loadAlerts();
    } catch (error) {
      this.alertsError = friendlyDataError(error);
    }
    this.changeDetector.markForCheck();
  }

  private async loadAlerts(): Promise<void> {
    this.alertsLoading = true;
    try {
      this.alerts = await this.platform.myAlerts();
    } catch (error) {
      this.alertsError = friendlyDataError(error);
    } finally {
      this.alertsLoading = false;
      this.changeDetector.markForCheck();
    }
  }

  private openMapSoon(): void {
    this.changeDetector.detectChanges();
    setTimeout(() => this.initMap());
  }

  private initMap(): void {
    const element = this.alertMapElement?.nativeElement;
    const draft = this.draft;
    if (!element || !draft) return;
    this.destroyMap();
    const bounds = L.latLngBounds(DR_MAP_VIEW);
    this.map = L.map(element, { zoomControl: true, minZoom: 6, maxZoom: 18, maxBounds: bounds.pad(0.1) });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }).addTo(this.map);
    if (draft.latitude !== null && draft.longitude !== null) this.setPoint(draft.latitude, draft.longitude, true);
    else this.map.fitBounds(bounds, { padding: [10, 10] });
    this.map.on('click', (event: L.LeafletMouseEvent) => this.zone.run(() => {
      if (isInsideDominicanRepublic(event.latlng.lat, event.latlng.lng)) this.setPoint(event.latlng.lat, event.latlng.lng, false);
      this.changeDetector.markForCheck();
    }));
    setTimeout(() => this.map?.invalidateSize(), 50);
  }

  private setPoint(lat: number, lng: number, fit: boolean): void {
    const draft = this.draft;
    if (!draft || !this.map) return;
    draft.latitude = lat;
    draft.longitude = lng;
    const icon = L.divIcon({ className: 'pick-marker', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 28] });
    if (this.marker) this.marker.setLatLng([lat, lng]);
    else this.marker = L.marker([lat, lng], { icon }).addTo(this.map);
    if (this.circle) this.circle.setLatLng([lat, lng]);
    else this.circle = L.circle([lat, lng], { radius: draft.radius_m, color: '#00b2a9', weight: 2, fillOpacity: 0.12 }).addTo(this.map);
    if (fit) this.fitCircle();
  }

  private fitCircle(): void {
    if (this.map && this.circle) this.map.fitBounds(this.circle.getBounds(), { padding: [20, 20] });
  }

  private destroyMap(): void {
    this.map?.remove();
    this.map = undefined;
    this.marker = undefined;
    this.circle = undefined;
  }

  // ---------- RF-53: verificación en dos pasos ----------

  async startMfa(): Promise<void> {
    await this.runMfa(async () => {
      this.enrollment = await this.security.startEnrollment();
      this.mfaCode = '';
    });
  }

  async confirmMfa(): Promise<void> {
    const enrollment = this.enrollment;
    if (!enrollment) return;
    await this.runMfa(async () => {
      await this.security.verifyCode(enrollment.factorId, this.mfaCode);
      this.enrollment = null;
      this.mfaCode = '';
      this.mfaFeedback = t('mfa.enabled');
      await this.loadMfa();
    });
  }

  cancelMfa(): void {
    this.enrollment = null;
    this.mfaCode = '';
  }

  async disableMfa(): Promise<void> {
    const status = this.mfa;
    if (!status?.factorId) return;
    if (status.needsCode) {
      // Supabase solo deja quitar la 2FA con la sesión ya verificada: primero se pide el código.
      if (this.mfaCode.replace(/\D/g, '').length !== 6) {
        this.mfaError = t('mfa.needVerify');
        return;
      }
      await this.runMfa(async () => {
        await this.security.verifyCode(status.factorId!, this.mfaCode);
        await this.security.disable(status.factorId!);
        this.mfaCode = '';
        this.mfaFeedback = t('mfa.disabled');
        await this.loadMfa();
      });
      return;
    }
    await this.runMfa(async () => {
      await this.security.disable(status.factorId!);
      this.mfaFeedback = t('mfa.disabled');
      await this.loadMfa();
    });
  }

  private async loadMfa(): Promise<void> {
    try {
      this.mfa = await this.security.status();
    } catch (error) {
      this.mfaError = friendlyDataError(error);
    }
    this.changeDetector.markForCheck();
  }

  private async runMfa(action: () => Promise<void>): Promise<void> {
    this.mfaBusy = true;
    this.mfaError = '';
    this.mfaFeedback = '';
    this.changeDetector.markForCheck();
    try {
      await action();
    } catch (error) {
      const message = (error as { message?: string })?.message ?? '';
      this.mfaError = /invalid|expired|code/i.test(message) && !/6 dígitos/.test(message) ? t('mfa.badCode') : friendlyDataError(error);
    } finally {
      this.mfaBusy = false;
      this.changeDetector.markForCheck();
    }
  }

  // ---------- RF-62: constancia ----------

  async downloadCertificate(): Promise<void> {
    this.certBusy = true;
    this.certError = '';
    this.certFeedback = '';
    this.changeDetector.markForCheck();
    try {
      const certificate = await this.platform.issueCertificate();
      await downloadCertificatePdf(certificate, `${location.origin}/verificar/${certificate.code}`);
      this.certFeedback = t('cert.done', { code: certificate.code });
    } catch (error) {
      this.certError = friendlyDataError(error);
    } finally {
      this.certBusy = false;
      this.changeDetector.markForCheck();
    }
  }
}
