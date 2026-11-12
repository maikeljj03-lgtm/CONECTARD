import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, ViewEncapsulation, inject,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import * as L from 'leaflet';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS } from '../../../../core/constants/catalogs';
import { DR_MAP_VIEW, DR_PROVINCES } from '../../../../core/constants/geography';
import type { PublicReport, ReportStatus } from '../../../../core/models/report.model';
import { AuthService } from '../../../../core/services/auth.service';
import { ReportMediaService } from '../../../../core/services/report-media.service';
import { ReportsRealtimeService, type LiveStatus, type ReportChange } from '../../../../core/services/reports-realtime.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { distanceKm, type LatLng } from '../../../../core/utils/geo';
import {
  EMPTY_FILTERS, activeFilterCount, dateLabel, fromQueryParams, matchesFilters, normalizeText, toQueryFilters, toQueryParams,
  type Period, type ReportFilterState,
} from '../../../../core/utils/report-filters';
import { STATUS_COLORS } from '../../../../shared/components/community-scene/community-scene.component';
import { clusterPoints } from '../../map/clustering';
import { HEAT_GRADIENT, HeatLayer } from '../../map/heat-layer';
import { clusterIcon, reportIcon } from '../../map/markers';

type Sort = 'recientes' | 'cercanos' | 'apoyados';
type MapMode = 'marcadores' | 'calor';
type FilterKey = Exclude<keyof ReportFilterState, 'search'>;

/** Máximo de reportes que se cargan en el mapa a la vez. */
const MAP_LIMIT = 500;
/** Con zoom mayor que este, cada reporte se ve por separado (sin agrupar). */
const CLUSTER_MAX_ZOOM = 14;
/** Distancia en píxeles para agrupar marcadores. */
const CLUSTER_RADIUS = 46;
/** Cuánto tiempo destaca un reporte recién llegado en vivo. */
const NEW_HIGHLIGHT_MS = 8000;

/**
 * Explorar: mapa y lista de reportes reales.
 * - RF-18: mapa en tiempo real; marcadores con el color del estado y el ícono de la categoría, agrupados al alejarse.
 * - RF-19: capa de mapa de calor.
 * - RF-20: filtros por provincia, municipio, sector, categoría, fecha y estado (se guardan en la dirección).
 * - RF-21: vista previa en ventana emergente al tocar un marcador.
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
  private readonly realtime = inject(ReportsRealtimeService);
  private readonly media = inject(ReportMediaService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly changeDetector = inject(ChangeDetectorRef);

  @ViewChild('mapEl') private mapEl?: ElementRef<HTMLDivElement>;
  private map?: L.Map;
  private markers?: L.LayerGroup;
  private heat?: HeatLayer;
  private readonly markerById = new Map<string, L.Marker>();
  private locationMarker?: L.CircleMarker;
  private resizeObserver?: ResizeObserver;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  private destroyed = false;
  private request = 0;
  /** Reportes recién llegados en vivo (se destacan unos segundos). */
  private readonly freshIds = new Set<string>();
  /** Municipios y sectores vistos, para sugerirlos al escribir (por provincia). */
  private readonly places = new Map<string, { municipalities: Set<string>; sectors: Set<string> }>();

  readonly categories = REPORT_CATEGORIES;
  readonly provinces = DR_PROVINCES;
  readonly statusLabels = REPORT_STATUS_LABELS;
  readonly statusColors = STATUS_COLORS;
  readonly statuses: ReportStatus[] = ['reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado'];
  readonly heatGradient = `linear-gradient(90deg, ${HEAT_GRADIENT.slice(1).map(([stop, color]) => `${color} ${stop * 100}%`).join(', ')})`;
  readonly today = toDateInput(new Date());

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
  filters: ReportFilterState = { ...EMPTY_FILTERS };
  sort: Sort = 'recientes';
  mode: MapMode = 'marcadores';
  live: LiveStatus = 'connecting';
  /** Aviso de un reporte nuevo que llegó en vivo. */
  toast: PublicReport | null = null;

  // ---------- Estado derivado ----------

  get activeFilterCount(): number {
    return activeFilterCount(this.filters);
  }

  get hasAnyFilter(): boolean {
    return this.activeFilterCount > 0 || !!this.filters.search.trim();
  }

  get dateLabel(): string {
    return dateLabel(this.filters);
  }

  /** Filtros activos como etiquetas que se pueden quitar una a una. */
  get activeChips(): { key: FilterKey | 'search' | 'date'; label: string }[] {
    const f = this.filters;
    const chips: { key: FilterKey | 'search' | 'date'; label: string }[] = [];
    if (f.search.trim()) chips.push({ key: 'search', label: `“${f.search.trim()}”` });
    if (f.category) chips.push({ key: 'category', label: this.categoryLabel(f.category) });
    if (f.status) chips.push({ key: 'status', label: this.statusLabels[f.status] });
    if (f.province) chips.push({ key: 'province', label: f.province });
    if (f.municipality.trim()) chips.push({ key: 'municipality', label: `Municipio: ${f.municipality.trim()}` });
    if (f.sector.trim()) chips.push({ key: 'sector', label: `Sector: ${f.sector.trim()}` });
    if (this.dateLabel) chips.push({ key: 'date', label: this.dateLabel });
    return chips;
  }

  /** Orden del listado (RF-23): más recientes, más cercanos o más apoyados ("Me afecta"). */
  get sortedReports(): PublicReport[] {
    if (this.sort === 'apoyados') {
      return [...this.reports].sort((a, b) => (b.support_count ?? 0) - (a.support_count ?? 0) || b.created_at.localeCompare(a.created_at));
    }
    if (this.sort === 'cercanos' && this.location) {
      const here = this.location;
      return [...this.reports].sort((a, b) => distanceKm(here, toLatLng(a)) - distanceKm(here, toLatLng(b)));
    }
    return this.reports;
  }

  /** Reportes que cuentan para el mapa de calor: problemas sin resolver, salvo que se filtre otro estado. */
  get heatReports(): PublicReport[] {
    if (this.filters.status) return this.reports;
    return this.reports.filter((report) => report.status !== 'resuelto' && report.status !== 'rechazado');
  }

  get municipalitySuggestions(): string[] {
    return this.suggestions('municipalities');
  }

  get sectorSuggestions(): string[] {
    return this.suggestions('sectors');
  }

  isFresh(report: PublicReport): boolean {
    return this.freshIds.has(report.id);
  }

  // ---------- Ciclo de vida ----------

  async ngOnInit(): Promise<void> {
    this.signedIn = !!this.auth.getCachedCurrentUser();
    const params = this.route.snapshot.queryParamMap;
    this.filters = fromQueryParams((key) => params.get(key));
    const sort = params.get('orden');
    if (sort === 'apoyados' || sort === 'cercanos') this.sort = sort;
    this.mode = params.get('vista') === 'calor' ? 'calor' : 'marcadores';
    this.filtersOpen = !!(this.filters.municipality || this.filters.sector || this.filters.period || this.filters.province);
    await this.load();
    const focus = params.get('reporte');
    if (focus) {
      const report = this.reports.find((item) => item.id === focus) ?? (await this.reportsService.getPublic(focus).catch(() => null));
      if (report) this.focus(report, true);
    }
    void this.startLive();
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.unsubscribe?.();
    this.resizeObserver?.disconnect();
    this.heat?.remove();
    this.map?.remove();
  }

  // ---------- Filtros (RF-20) ----------

  onSearch(value: string): void {
    this.filters = { ...this.filters, search: value };
    this.debouncedLoad();
  }

  setFilter(key: FilterKey, value: string): void {
    this.filters = { ...this.filters, [key]: value } as ReportFilterState;
    // Al cambiar de provincia, el municipio y el sector anteriores dejan de tener sentido.
    if (key === 'province') this.filters = { ...this.filters, municipality: '', sector: '' };
    if (key === 'period' && value !== 'rango') this.filters = { ...this.filters, from: '', to: '' };
    if (key === 'municipality' || key === 'sector') {
      this.debouncedLoad();
      return;
    }
    // Rango incompleto o al revés: se espera a que la persona termine de elegir.
    if ((key === 'from' || key === 'to') && this.filters.from && this.filters.to && this.filters.from > this.filters.to) {
      this.error = 'La fecha “desde” debe ser anterior a la fecha “hasta”.';
      return;
    }
    void this.load();
  }

  setPeriod(value: string): void {
    this.setFilter('period', value as Period);
  }

  removeChip(key: FilterKey | 'search' | 'date'): void {
    if (key === 'search') this.filters = { ...this.filters, search: '' };
    else if (key === 'date') this.filters = { ...this.filters, period: '', from: '', to: '' };
    else this.filters = { ...this.filters, [key]: '' } as ReportFilterState;
    void this.load();
  }

  clearFilters(): void {
    this.filters = { ...EMPTY_FILTERS };
    void this.load();
  }

  setSort(sort: Sort): void {
    this.sort = sort;
    void this.router.navigate([], { queryParams: { orden: sort === 'recientes' ? null : sort }, queryParamsHandling: 'merge', replaceUrl: true });
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

  private debouncedLoad(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(), 350);
  }

  private async load(): Promise<void> {
    const request = ++this.request;
    this.loading = true;
    this.error = '';
    this.syncUrl();
    this.changeDetector.markForCheck();
    try {
      const reports = await this.reportsService.listPublic(toQueryFilters(this.filters, MAP_LIMIT));
      if (request !== this.request) return;
      this.reports = reports;
      this.rememberPlaces(reports);
      this.refreshMap();
    } catch (error) {
      if (request === this.request) this.error = friendlyDataError(error);
    } finally {
      if (request === this.request) {
        this.loading = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  /** Guarda los filtros y la vista en la dirección: el enlace se puede compartir. */
  private syncUrl(): void {
    void this.router.navigate([], {
      queryParams: { ...toQueryParams(this.filters), vista: this.mode === 'calor' ? 'calor' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private rememberPlaces(reports: PublicReport[]): void {
    for (const report of reports) {
      const key = report.province ?? '';
      const entry = this.places.get(key) ?? { municipalities: new Set<string>(), sectors: new Set<string>() };
      if (report.municipality?.trim()) entry.municipalities.add(report.municipality.trim());
      if (report.sector?.trim()) entry.sectors.add(report.sector.trim());
      this.places.set(key, entry);
    }
  }

  private suggestions(kind: 'municipalities' | 'sectors'): string[] {
    const sources = this.filters.province ? [this.places.get(this.filters.province)] : [...this.places.values()];
    const values = new Map<string, string>();
    for (const source of sources) for (const value of source?.[kind] ?? []) values.set(normalizeText(value), value);
    return [...values.values()].sort((a, b) => a.localeCompare(b, 'es')).slice(0, 60);
  }

  // ---------- Tiempo real (RF-18) ----------

  private async startLive(): Promise<void> {
    try {
      const unsubscribe = await this.realtime.subscribe(
        (change) => this.zone.run(() => void this.applyChange(change)),
        (status) => this.zone.run(() => {
          this.live = status;
          this.changeDetector.markForCheck();
        }),
      );
      if (this.destroyed) unsubscribe();
      else this.unsubscribe = unsubscribe;
    } catch {
      this.live = 'offline';
      this.changeDetector.markForCheck();
    }
  }

  /** Aplica un cambio recibido en vivo: añade, actualiza o quita el reporte sin recargar todo. */
  private async applyChange(change: ReportChange): Promise<void> {
    const existing = this.reports.findIndex((report) => report.id === change.id);
    if (change.change === 'deleted') {
      if (existing >= 0) this.removeReport(change.id);
      return;
    }
    const report = await this.reportsService.getPublic(change.id).catch(() => null);
    if (!report || !matchesFilters(report, this.filters)) {
      // Ya no existe o dejó de coincidir con los filtros (p. ej. cambió de estado).
      if (existing >= 0) this.removeReport(change.id);
      return;
    }
    const index = this.reports.findIndex((item) => item.id === report.id);
    if (index >= 0) {
      this.reports = this.reports.map((item) => (item.id === report.id ? report : item));
      if (this.selected?.id === report.id) this.selected = report;
    } else {
      this.reports = [report, ...this.reports]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, MAP_LIMIT);
      if (change.change === 'created') this.announce(report);
    }
    this.rememberPlaces([report]);
    this.refreshMap();
    this.changeDetector.markForCheck();
  }

  private removeReport(id: string): void {
    this.reports = this.reports.filter((report) => report.id !== id);
    if (this.selected?.id === id) this.closePreview();
    this.refreshMap();
    this.changeDetector.markForCheck();
  }

  private announce(report: PublicReport): void {
    this.freshIds.add(report.id);
    this.toast = report;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.zone.run(() => {
      this.toast = null;
      this.changeDetector.markForCheck();
    }), NEW_HIGHLIGHT_MS);
    setTimeout(() => this.zone.run(() => {
      this.freshIds.delete(report.id);
      this.refreshMap();
      this.changeDetector.markForCheck();
    }), NEW_HIGHLIGHT_MS);
  }

  openToast(): void {
    if (!this.toast) return;
    const report = this.toast;
    this.toast = null;
    this.focus(report, false);
  }

  // ---------- Mapa (RF-18, RF-19, RF-21) ----------

  open(report: PublicReport): void {
    this.focus(report, false);
  }

  /** Centra el mapa en el reporte y abre su vista previa (RF-21). */
  focus(report: PublicReport, fromLink: boolean): void {
    this.selected = report;
    if (this.map) {
      // Lo bastante cerca para que el reporte se vea fuera de su grupo.
      const zoom = Math.max(this.map.getZoom(), fromLink ? CLUSTER_MAX_ZOOM + 2 : CLUSTER_MAX_ZOOM + 1);
      this.map.flyTo([report.latitude, report.longitude], zoom, { duration: .6 });
    }
    this.highlight(report.id);
    void this.router.navigate([], { queryParams: { reporte: report.id }, queryParamsHandling: 'merge', replaceUrl: true });
    this.changeDetector.markForCheck();
  }

  closePreview(): void {
    this.selected = null;
    this.highlight(null);
    void this.router.navigate([], { queryParams: { reporte: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  setMode(mode: MapMode): void {
    this.mode = mode;
    this.syncUrl();
    this.refreshMap();
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
    this.heat = new HeatLayer().addTo(this.map);
    this.markers = L.layerGroup().addTo(this.map);
    // Los grupos dependen del zoom: se recalculan al terminar de acercar o alejar.
    this.map.on('zoomend', () => this.renderMarkers());
    this.refreshMap();

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

  /** Redibuja la capa visible: marcadores o mapa de calor. */
  private refreshMap(): void {
    const heat = this.mode === 'calor';
    this.heat?.setPoints(this.heatReports.map((report) => ({ lat: report.latitude, lng: report.longitude, weight: 1 })));
    this.heat?.setVisible(heat);
    this.renderMarkers();
  }

  /**
   * Marcadores (RF-18): color = estado, ícono = categoría. Al alejarse, los cercanos se agrupan
   * en un círculo con el número de reportes y un anillo con el reparto por estado.
   * En el mapa de calor solo se ven al acercarse mucho, para poder abrir cada reporte.
   */
  private renderMarkers(): void {
    const map = this.map;
    if (!this.markers || !map) return;
    this.markers.clearLayers();
    this.markerById.clear();
    const zoom = map.getZoom();
    if (this.mode === 'calor' && zoom <= CLUSTER_MAX_ZOOM) return;

    const shouldCluster = zoom <= CLUSTER_MAX_ZOOM;
    const points = this.reports.map((report) => {
      const point = map.project([report.latitude, report.longitude], zoom);
      return { item: report, x: point.x, y: point.y };
    });
    const groups = shouldCluster ? clusterPoints(points, CLUSTER_RADIUS) : points.map((point) => ({ items: [point.item], x: point.x, y: point.y }));

    for (const group of groups) {
      if (group.items.length === 1) {
        const report = group.items[0];
        const marker = L.marker([report.latitude, report.longitude], {
          icon: reportIcon(report, this.freshIds.has(report.id)),
          title: report.title,
          alt: `${report.title}: ${this.statusLabels[report.status]}`,
          keyboard: true,
          riseOnHover: true,
        })
          .on('click', () => this.zone.run(() => this.focus(report, false)))
          .addTo(this.markers);
        this.markerById.set(report.id, marker);
        continue;
      }
      const center = map.unproject([group.x, group.y], zoom);
      const count = group.items.length;
      L.marker(center, {
        icon: clusterIcon(group.items),
        title: `${count} reportes en esta zona. Acerca el mapa para verlos.`,
        keyboard: true,
        riseOnHover: true,
      })
        .on('click', () => {
          const area = L.latLngBounds(group.items.map((report) => [report.latitude, report.longitude] as L.LatLngTuple));
          map.flyToBounds(area, { padding: [60, 60], maxZoom: CLUSTER_MAX_ZOOM + 2, duration: .6 });
        })
        .addTo(this.markers);
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

function toDateInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
