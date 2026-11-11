import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, ViewEncapsulation, inject,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import * as L from 'leaflet';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS } from '../../../../core/constants/catalogs';
import { DR_MAP_VIEW, DR_PROVINCES } from '../../../../core/constants/geography';
import type { PublicReport, PublicReportFilters, ReportStatus } from '../../../../core/models/report.model';
import { AuthService } from '../../../../core/services/auth.service';
import { ReportMediaService } from '../../../../core/services/report-media.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { distanceKm, type LatLng } from '../../../../core/utils/geo';
import { STATUS_COLORS } from '../../../../shared/components/community-scene/community-scene.component';

type Period = '7' | '30' | '90' | '';
type Sort = 'recientes' | 'cercanos';

/**
 * Explorar: mapa y lista de reportes reales con filtros (RF-18, RF-20, RF-21, RF-22, RF-23).
 * Pública: cualquiera puede ver los reportes (matriz de roles).
 */
@Component({
  selector: 'app-explore',
  templateUrl: './explore.page.html',
  styleUrls: ['./explore.page.scss'],
  // Los marcadores de Leaflet se crean fuera de Angular; estilos limitados por .explore-content.
  encapsulation: ViewEncapsulation.None,
  standalone: false,
})
export class ExplorePage implements OnInit, AfterViewInit, OnDestroy {
  private readonly reportsService = inject(ReportsService);
  private readonly media = inject(ReportMediaService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly changeDetector = inject(ChangeDetectorRef);

  @ViewChild('mapEl') private mapEl?: ElementRef<HTMLDivElement>;
  private map?: L.Map;
  private markers?: L.LayerGroup;
  private readonly markerById = new Map<string, L.Marker>();
  private locationMarker?: L.CircleMarker;
  private resizeObserver?: ResizeObserver;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private request = 0;

  readonly categories = REPORT_CATEGORIES;
  readonly provinces = DR_PROVINCES;
  readonly statusLabels = REPORT_STATUS_LABELS;
  readonly statusColors = STATUS_COLORS;
  readonly statuses: ReportStatus[] = ['reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado'];

  signedIn = false;
  reports: PublicReport[] = [];
  loading = true;
  error = '';
  selected: PublicReport | null = null;
  location: LatLng | null = null;
  locationError = '';
  /** En el teléfono se alterna entre mapa y lista. */
  mobileView: 'mapa' | 'lista' = 'mapa';
  filtersOpen = false;

  search = '';
  category = '';
  status: ReportStatus | '' = '';
  province = '';
  municipality = '';
  period: Period = '';
  sort: Sort = 'recientes';

  get activeFilterCount(): number {
    return [this.category, this.status, this.province, this.municipality, this.period].filter(Boolean).length;
  }

  get sortedReports(): PublicReport[] {
    if (this.sort === 'cercanos' && this.location) {
      const here = this.location;
      return [...this.reports].sort((a, b) => distanceKm(here, toLatLng(a)) - distanceKm(here, toLatLng(b)));
    }
    return this.reports;
  }

  async ngOnInit(): Promise<void> {
    this.signedIn = !!this.auth.getCachedCurrentUser();
    const params = this.route.snapshot.queryParamMap;
    this.category = params.get('categoria') ?? '';
    this.province = params.get('provincia') ?? '';
    await this.load();
    const focus = params.get('reporte');
    if (focus) {
      const report = this.reports.find((item) => item.id === focus) ?? (await this.reportsService.getPublic(focus).catch(() => null));
      if (report) this.focus(report, true);
    }
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.resizeObserver?.disconnect();
    this.map?.remove();
  }

  // ---------- Filtros ----------

  onSearch(value: string): void {
    this.search = value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(), 350);
  }

  setFilter<K extends 'category' | 'status' | 'province' | 'municipality' | 'period'>(key: K, value: string): void {
    (this as unknown as Record<string, string>)[key] = value;
    if (key === 'municipality') {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => void this.load(), 350);
      return;
    }
    void this.load();
  }

  clearFilters(): void {
    this.search = '';
    this.category = '';
    this.status = '';
    this.province = '';
    this.municipality = '';
    this.period = '';
    void this.load();
  }

  setSort(sort: Sort): void {
    this.sort = sort;
    if (sort === 'cercanos' && !this.location) this.locate();
  }

  categoryLabel(value: string): string {
    return this.categories.find((item) => item.value === value)?.label ?? value;
  }

  // ---------- Datos ----------

  coverOf(report: PublicReport): string | null {
    return this.media.coverUrl(report.cover_path);
  }

  distanceTo(report: PublicReport): number | null {
    return this.location ? distanceKm(this.location, toLatLng(report)) : null;
  }

  private async load(): Promise<void> {
    const request = ++this.request;
    this.loading = true;
    this.error = '';
    this.changeDetector.markForCheck();
    const filters: PublicReportFilters = {
      search: this.search,
      category: this.category || null,
      status: this.status || null,
      province: this.province || null,
      municipality: this.municipality || null,
      since: this.period ? new Date(Date.now() - Number(this.period) * 86_400_000).toISOString() : null,
      limit: 300,
    };
    try {
      const reports = await this.reportsService.listPublic(filters);
      if (request !== this.request) return;
      this.reports = reports;
      this.renderMarkers();
    } catch (error) {
      if (request === this.request) this.error = friendlyDataError(error);
    } finally {
      if (request === this.request) {
        this.loading = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  // ---------- Mapa ----------

  open(report: PublicReport): void {
    this.focus(report, false);
  }

  /** Centra el mapa en el reporte y abre su vista previa (RF-21). */
  focus(report: PublicReport, fromLink: boolean): void {
    this.selected = report;
    const position = L.latLng(report.latitude, report.longitude);
    this.map?.flyTo(position, Math.max(this.map.getZoom(), fromLink ? 14 : 13), { duration: .6 });
    this.highlight(report.id);
    void this.router.navigate([], { queryParams: { reporte: report.id }, queryParamsHandling: 'merge', replaceUrl: true });
    this.changeDetector.markForCheck();
  }

  closePreview(): void {
    this.selected = null;
    this.highlight(null);
    void this.router.navigate([], { queryParams: { reporte: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  resetView(): void {
    this.map?.flyToBounds(L.latLngBounds(DR_MAP_VIEW), { padding: [16, 16], duration: .6 });
  }

  locate(): void {
    if (!navigator.geolocation) {
      this.locationError = 'Tu navegador no permite obtener la ubicación.';
      return;
    }
    this.locationError = '';
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => this.zone.run(() => {
        this.location = { lat: coords.latitude, lng: coords.longitude };
        if (this.map) {
          this.locationMarker?.remove();
          this.locationMarker = L.circleMarker([coords.latitude, coords.longitude], {
            radius: 8, color: '#ffffff', weight: 3, fillColor: '#13282b', fillOpacity: 1,
          }).addTo(this.map).bindTooltip('Tú');
          this.map.flyTo([coords.latitude, coords.longitude], 13, { duration: .6 });
        }
        this.changeDetector.markForCheck();
      }),
      () => this.zone.run(() => {
        this.locationError = 'No pudimos obtener tu ubicación. Revisa el permiso del navegador.';
        if (this.sort === 'cercanos') this.sort = 'recientes';
        this.changeDetector.markForCheck();
      }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  showMobile(view: 'mapa' | 'lista'): void {
    this.mobileView = view;
    if (view === 'mapa') setTimeout(() => this.map?.invalidateSize(), 0);
  }

  private initMap(): void {
    const element = this.mapEl?.nativeElement;
    if (!element) return;
    const bounds = L.latLngBounds(DR_MAP_VIEW);
    this.map = L.map(element, { zoomControl: false, minZoom: 6, maxZoom: 18, maxBounds: bounds.pad(0.15) });
    this.map.setView(bounds.getCenter(), 8);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'crd-map-tiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }).addTo(this.map);
    this.markers = L.layerGroup().addTo(this.map);
    this.renderMarkers();

    let framed = false;
    const frame = () => {
      this.map?.invalidateSize();
      if (!framed && element.clientWidth > 0 && element.clientHeight > 0) {
        framed = true;
        if (!this.selected) this.map?.fitBounds(bounds, { padding: [16, 16] });
      }
    };
    this.resizeObserver = new ResizeObserver(frame);
    this.resizeObserver.observe(element);
    requestAnimationFrame(frame);
  }

  /** Marcadores por estado (RF-18). Se dibujan con DOM seguro: nada del reporte se inserta como HTML. */
  private renderMarkers(): void {
    if (!this.markers) return;
    this.markers.clearLayers();
    this.markerById.clear();
    for (const report of this.reports) {
      const color = STATUS_COLORS[report.status] ?? STATUS_COLORS['reportado'];
      const icon = L.divIcon({
        className: 'explore-marker',
        html: `<span style="--marker:${color}"></span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const marker = L.marker([report.latitude, report.longitude], { icon, title: report.title, keyboard: true })
        .on('click', () => this.zone.run(() => this.focus(report, false)))
        .addTo(this.markers);
      this.markerById.set(report.id, marker);
    }
    this.highlight(this.selected?.id ?? null);
  }

  private highlight(id: string | null): void {
    for (const [reportId, marker] of this.markerById) {
      marker.getElement()?.classList.toggle('is-selected', reportId === id);
    }
  }
}

function toLatLng(report: PublicReport): LatLng {
  return { lat: report.latitude, lng: report.longitude };
}
