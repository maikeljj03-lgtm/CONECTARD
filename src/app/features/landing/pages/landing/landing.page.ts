import { AfterViewInit, Component, ElementRef, inject, NgZone, OnDestroy, OnInit, ViewChild, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { User } from '@supabase/supabase-js';
import { IonContent } from '@ionic/angular';
import * as L from 'leaflet';
import { AuthService } from '../../../../core/services/auth.service';
import { DR_MAP_VIEW } from '../../../../core/constants/geography';
import {
  CategoryFilter, FAQS, LANDING_CATEGORIES, LIFECYCLE, NAV_ITEMS, ROLES, SAMPLE_REPORTS, SECTION_IDS, STATUS_COLORS,
  type ReportCategory, type ReportStatus, type SampleReport,
} from '../../landing.content';

@Component({
  selector: 'app-landing',
  templateUrl: './landing.page.html',
  styleUrls: ['./landing.page.scss'],
  // Sin encapsulación: los marcadores y ventanas del mapa (Leaflet) se crean fuera
  // de Angular. Los estilos ya están limitados por la clase raíz .landing-content.
  encapsulation: ViewEncapsulation.None,
  standalone: false,
})
export class LandingPage implements OnInit, AfterViewInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly zone = inject(NgZone);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  @ViewChild(IonContent) private ionContent?: IonContent;
  @ViewChild('reportMap') private reportMap?: ElementRef<HTMLDivElement>;
  @ViewChild('mapShell') private mapShell?: ElementRef<HTMLDivElement>;

  user: User | null = null;
  activeSection = 'inicio';
  scrolled = false;
  menuOpen = false;
  searchTerm = '';
  selectedCategory: CategoryFilter = 'Todas';
  selectedReportId: number | null = null;
  mapFeedback = '';
  toast = '';
  readonly currentYear = new Date().getFullYear();
  readonly statusColors = STATUS_COLORS;

  private map?: L.Map;
  private reportMarkers?: L.LayerGroup;
  private readonly markersById = new Map<number, L.Marker>();
  private locationMarker?: L.CircleMarker;
  private mapResizeObserver?: ResizeObserver;
  private sectionObserver?: IntersectionObserver;
  private revealObserver?: IntersectionObserver;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private readonly dominicanRepublicBounds = L.latLngBounds(DR_MAP_VIEW);

  readonly navItems = NAV_ITEMS;
  readonly categories = LANDING_CATEGORIES;
  readonly categoryFilters: CategoryFilter[] = ['Todas', ...LANDING_CATEGORIES.map((category) => category.name)];
  readonly reports = SAMPLE_REPORTS;
  readonly lifecycle = LIFECYCLE;
  readonly roles = ROLES;
  readonly faqs = FAQS;

  get filteredReports(): SampleReport[] {
    const query = this.searchTerm.trim().toLocaleLowerCase();
    return this.reports.filter((report) => {
      const matchesCategory = this.selectedCategory === 'Todas' || report.category === this.selectedCategory;
      const matchesQuery = !query || `${report.title} ${report.category} ${report.sector} ${report.municipality}`.toLocaleLowerCase().includes(query);
      return matchesCategory && matchesQuery;
    });
  }

  get displayName(): string {
    const name = this.user?.user_metadata?.['full_name'];
    return typeof name === 'string' && name.trim() ? name.trim().split(/\s+/)[0] : 'Vecino/a';
  }

  get initials(): string {
    const name = this.user?.user_metadata?.['full_name'];
    const source = typeof name === 'string' && name.trim() ? name.trim() : (this.user?.email ?? '?');
    return source.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  }

  categoryIcon(category: ReportCategory): string {
    return this.categories.find((item) => item.name === category)?.icon ?? 'more';
  }

  statusClass(status: ReportStatus): string {
    return 'status--' + status.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '-');
  }

  ngOnInit(): void {
    this.user = this.auth.getCachedCurrentUser();
  }

  ngAfterViewInit(): void {
    this.initMap();
    this.observeSections();
    // Enlaces directos a una sección: /landing#mapa
    const fragment = this.route.snapshot.fragment;
    if (fragment && SECTION_IDS.includes(fragment)) {
      setTimeout(() => void this.scrollTo(fragment, 0), 300);
    }
  }

  ngOnDestroy(): void {
    this.mapResizeObserver?.disconnect();
    this.sectionObserver?.disconnect();
    this.revealObserver?.disconnect();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.map?.remove();
  }

  // ---------- Sesión ----------
  async signOut(): Promise<void> {
    this.menuOpen = false;
    const { error } = await this.auth.signOut();
    if (error) {
      this.showToast('No se pudo cerrar la sesión. Inténtalo de nuevo.');
      return;
    }
    this.user = null;
    this.showToast('Cerraste sesión. ¡Vuelve pronto!');
  }

  startReport(): void {
    if (!this.user) {
      void this.router.navigateByUrl('/auth/register');
      return;
    }
    void this.router.navigateByUrl('/reportes/nuevo');
  }

  // ---------- Navegación ----------
  onScroll(event: CustomEvent<{ scrollTop: number }>): void {
    const scrolled = event.detail.scrollTop > 12;
    if (scrolled !== this.scrolled) this.scrolled = scrolled;
    this.scheduleRevealCheck();
  }

  // Respaldo del IntersectionObserver: muestra lo que ya está en pantalla,
  // así ningún bloque puede quedarse oculto.
  private revealFrame = 0;
  private scheduleRevealCheck(): void {
    if (this.revealFrame) return;
    this.revealFrame = requestAnimationFrame(() => {
      this.revealFrame = 0;
      const limit = window.innerHeight * .94;
      this.host.nativeElement.querySelectorAll('[data-reveal]:not(.is-visible)').forEach((element) => {
        if (element.getBoundingClientRect().top < limit) element.classList.add('is-visible');
      });
    });
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  navigateTo(event: Event, sectionId: string): void {
    event.preventDefault();
    void this.scrollTo(sectionId);
  }

  async scrollTo(sectionId: string, duration = 500): Promise<void> {
    this.menuOpen = false;
    const target = document.getElementById(sectionId);
    if (!target) return;
    this.activeSection = sectionId;
    this.scrolled = sectionId !== 'inicio';
    const scrollElement = await this.ionContent?.getScrollElement();
    if (!scrollElement || !this.ionContent) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const top = target.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop - 72;
    await this.ionContent.scrollToPoint(0, Math.max(top, 0), duration);
    this.scheduleRevealCheck();
  }

  private observeSections(): void {
    const root = this.host.nativeElement;
    if (typeof IntersectionObserver === 'undefined') {
      root.querySelectorAll('[data-reveal]').forEach((element) => element.classList.add('is-visible'));
      return;
    }

    this.sectionObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) this.zone.run(() => (this.activeSection = visible.target.id));
    }, { rootMargin: '-35% 0px -55% 0px', threshold: [0, .25, .5] });
    SECTION_IDS.forEach((id) => {
      const section = document.getElementById(id);
      if (section) this.sectionObserver?.observe(section);
    });

    this.revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        this.revealObserver?.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: .12 });
    root.querySelectorAll('[data-reveal]').forEach((element) => this.revealObserver?.observe(element));
    this.scheduleRevealCheck();
  }

  // ---------- Mapa ----------
  updateSearch(event: Event): void {
    this.searchTerm = (event.target as HTMLInputElement).value;
    this.renderMapMarkers();
  }

  selectCategory(category: CategoryFilter): void {
    this.selectedCategory = category;
    this.selectedReportId = null;
    this.renderMapMarkers();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectCategory('Todas');
  }

  filterByCategory(category: ReportCategory): void {
    this.selectCategory(category);
    void this.scrollTo('mapa');
  }

  zoomMap(direction: 1 | -1): void {
    if (direction > 0) this.map?.zoomIn();
    else this.map?.zoomOut();
  }

  resetMap(): void {
    this.map?.fitBounds(this.dominicanRepublicBounds, { padding: [16, 16], maxZoom: 8 });
    this.selectedReportId = null;
    this.mapFeedback = '';
  }

  focusReport(report: SampleReport): void {
    const marker = this.markersById.get(report.id);
    if (!this.map || !marker) return;
    this.selectedReportId = report.id;
    this.map.flyTo(marker.getLatLng(), 12, { duration: .7 });
    window.setTimeout(() => marker.openPopup(), 720);
  }

  locateMe(): void {
    if (!navigator.geolocation) {
      this.mapFeedback = 'Este navegador no permite consultar tu ubicación.';
      return;
    }
    this.mapFeedback = 'Buscando tu ubicación…';
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => this.zone.run(() => {
        const position = L.latLng(coords.latitude, coords.longitude);
        if (!this.map) return;
        if (!this.dominicanRepublicBounds.contains(position)) {
          this.mapFeedback = 'Tu ubicación está fuera de República Dominicana.';
          return;
        }
        this.locationMarker?.remove();
        this.locationMarker = L.circleMarker(position, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#5b8def', fillOpacity: 1 }).addTo(this.map);
        this.locationMarker.bindTooltip('Tu ubicación');
        this.map.flyTo(position, 12, { duration: .7 });
        this.mapFeedback = 'Mostrando tu ubicación aproximada.';
      }),
      () => this.zone.run(() => (this.mapFeedback = 'No se pudo obtener tu ubicación. Revisa el permiso del navegador.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async toggleMapFullscreen(): Promise<void> {
    const shell = this.mapShell?.nativeElement;
    if (!shell) return;
    try {
      if (document.fullscreenElement === shell) await document.exitFullscreen();
      else await shell.requestFullscreen();
      requestAnimationFrame(() => this.map?.invalidateSize({ pan: false }));
    } catch {
      this.mapFeedback = 'No se pudo abrir el mapa a pantalla completa.';
    }
  }

  private initMap(): void {
    if (!this.reportMap) return;
    this.map = L.map(this.reportMap.nativeElement, {
      scrollWheelZoom: false,
      zoomControl: false,
      minZoom: 6,
      maxZoom: 16,
      zoomSnap: .5,
      maxBounds: this.dominicanRepublicBounds.pad(.15),
      maxBoundsViscosity: 1,
      attributionControl: true,
    });
    this.resetMap();
    // Teselas de OpenStreetMap; el CSS (.crd-map-tiles) suaviza sus colores.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'crd-map-tiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }).addTo(this.map);
    this.reportMarkers = L.layerGroup().addTo(this.map);
    this.renderMapMarkers();
    this.mapResizeObserver = new ResizeObserver(() => this.map?.invalidateSize({ pan: false, debounceMoveend: true }));
    this.mapResizeObserver.observe(this.reportMap.nativeElement);
    requestAnimationFrame(() => this.map?.invalidateSize({ pan: false }));
  }

  private renderMapMarkers(): void {
    if (!this.reportMarkers) return;
    this.reportMarkers.clearLayers();
    this.markersById.clear();
    for (const report of this.filteredReports) {
      const icon = L.divIcon({
        className: 'crd-marker',
        html: `<span style="--marker:${STATUS_COLORS[report.status]}"></span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -12],
      });
      const popup = document.createElement('div');
      popup.className = 'crd-popup';
      const category = document.createElement('small');
      category.textContent = report.category;
      const title = document.createElement('strong');
      title.textContent = report.title;
      const meta = document.createElement('span');
      meta.textContent = `${report.sector}, ${report.municipality} · ${report.status}`;
      popup.append(category, title, meta);

      const marker = L.marker([report.lat, report.lng], { icon, title: report.title, keyboard: true })
        .bindPopup(popup, { closeButton: false, maxWidth: 240 })
        .on('click', () => this.zone.run(() => (this.selectedReportId = report.id)))
        .addTo(this.reportMarkers);
      this.markersById.set(report.id, marker);
    }
  }

  private showToast(message: string): void {
    this.toast = message;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = ''), 4200);
  }
}
