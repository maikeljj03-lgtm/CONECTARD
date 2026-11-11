import { AfterViewInit, Component, ElementRef, inject, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { User } from '@supabase/supabase-js';
import { IonContent } from '@ionic/angular';
import * as L from 'leaflet';
import { AuthService } from '../../../core/auth/auth.service';

// Categorías (RF-09) y estados del ciclo de vida (RF-16) según la propuesta.
type ReportCategory = 'Basura y limpieza' | 'Baches y vías' | 'Alumbrado' | 'Agua y alcantarillado' | 'Áreas verdes' | 'Seguridad' | 'Educación' | 'Otros';
type ReportStatus = 'Reportado' | 'En revisión' | 'En proceso' | 'Resuelto' | 'Rechazado';
type CategoryFilter = 'Todas' | ReportCategory;

interface CategoryInfo { name: ReportCategory; icon: string; description: string; }

interface SampleReport {
  id: number;
  title: string;
  category: ReportCategory;
  sector: string;
  municipality: string;
  age: string;
  status: ReportStatus;
  supports: number;
  lat: number;
  lng: number;
}

const STATUS_COLORS: Record<ReportStatus, string> = {
  'Reportado': '#8a9693',
  'En revisión': '#4d7fb8',
  'En proceso': '#e9a13b',
  'Resuelto': '#00b2a9',
  'Rechazado': '#d0645a',
};

const SECTION_IDS = ['inicio', 'como-funciona', 'mapa', 'participa', 'transparencia', 'preguntas'];

@Component({
  selector: 'app-landing',
  templateUrl: './landing.page.html',
  styleUrls: ['./landing.page.scss'],
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
  private readonly dominicanRepublicBounds = L.latLngBounds([17.45, -72.05], [20.05, -68.2]);

  readonly navItems = [
    { id: 'como-funciona', label: 'Cómo funciona' },
    { id: 'mapa', label: 'Mapa' },
    { id: 'participa', label: 'Participa' },
    { id: 'transparencia', label: 'Transparencia' },
    { id: 'preguntas', label: 'Preguntas' },
  ];

  readonly categories: CategoryInfo[] = [
    { name: 'Basura y limpieza', icon: 'trash', description: 'Vertederos, acumulación, recogida' },
    { name: 'Baches y vías', icon: 'alert', description: 'Hoyos, aceras, señalización' },
    { name: 'Alumbrado', icon: 'lightbulb', description: 'Postes apagados o dañados' },
    { name: 'Agua y alcantarillado', icon: 'droplet', description: 'Fugas, cloacas, falta de agua' },
    { name: 'Áreas verdes', icon: 'leaf', description: 'Parques y espacios descuidados' },
    { name: 'Seguridad', icon: 'shield', description: 'Zonas inseguras o sin vigilancia' },
    { name: 'Educación', icon: 'book', description: 'Escuelas y necesidades educativas' },
    { name: 'Otros', icon: 'more', description: 'Lo que tu comunidad necesite' },
  ];

  readonly categoryFilters: CategoryFilter[] = ['Todas', ...this.categories.map((category) => category.name)];

  readonly reports: SampleReport[] = [
    { id: 1, title: 'Hoyo profundo frente a la escuela', category: 'Baches y vías', sector: 'Los Mina', municipality: 'Santo Domingo Este', age: 'Hace 2 h', status: 'En proceso', supports: 38, lat: 18.4975, lng: -69.8549 },
    { id: 2, title: 'Vertedero improvisado en la esquina', category: 'Basura y limpieza', sector: 'Villa Consuelo', municipality: 'Distrito Nacional', age: 'Hace 5 h', status: 'En revisión', supports: 24, lat: 18.4891, lng: -69.9012 },
    { id: 3, title: 'Tres postes de luz apagados', category: 'Alumbrado', sector: 'Los Alcarrizos', municipality: 'Los Alcarrizos', age: 'Hace 1 día', status: 'Resuelto', supports: 51, lat: 18.5165, lng: -70.0105 },
    { id: 4, title: 'Fuga de agua potable en la avenida', category: 'Agua y alcantarillado', sector: 'Los Jardines', municipality: 'Santiago de los Caballeros', age: 'Hace 3 h', status: 'Reportado', supports: 12, lat: 19.4637, lng: -70.6888 },
    { id: 5, title: 'Parque sin mantenimiento', category: 'Áreas verdes', sector: 'Centro', municipality: 'San Francisco de Macorís', age: 'Hace 2 días', status: 'En proceso', supports: 19, lat: 19.2999, lng: -70.2526 },
    { id: 6, title: 'Calle sin iluminación ni vigilancia', category: 'Seguridad', sector: 'Villa Hermosa', municipality: 'La Romana', age: 'Hace 6 h', status: 'En revisión', supports: 33, lat: 18.4296, lng: -68.9636 },
    { id: 7, title: 'Escuela necesita pupitres y pintura', category: 'Educación', sector: 'Pueblo Nuevo', municipality: 'San Juan de la Maguana', age: 'Hace 4 días', status: 'Reportado', supports: 47, lat: 18.8076, lng: -71.2297 },
    { id: 8, title: 'Cañada tapada por desechos', category: 'Basura y limpieza', sector: 'Capotillo', municipality: 'Distrito Nacional', age: 'Hace 1 día', status: 'En proceso', supports: 66, lat: 18.5052, lng: -69.9228 },
    { id: 9, title: 'Badén destruido tras las lluvias', category: 'Baches y vías', sector: 'Centro', municipality: 'Puerto Plata', age: 'Hace 3 días', status: 'Resuelto', supports: 28, lat: 19.7934, lng: -70.6884 },
    { id: 10, title: 'Contenedor en propiedad privada', category: 'Otros', sector: 'El Millón', municipality: 'Distrito Nacional', age: 'Hace 2 días', status: 'Rechazado', supports: 3, lat: 18.4568, lng: -69.9449 },
  ];

  readonly lifecycle: { status: ReportStatus; description: string }[] = [
    { status: 'Reportado', description: 'El caso entra con foto, ubicación y categoría.' },
    { status: 'En revisión', description: 'Se valida y se asigna al responsable.' },
    { status: 'En proceso', description: 'La institución o la comunidad trabaja en él.' },
    { status: 'Resuelto', description: 'Se publica la evidencia de antes y después.' },
  ];

  readonly roles = [
    {
      slug: 'ciudadano', icon: 'user', title: 'Ciudadanos', lead: 'Tu voz con seguimiento.',
      points: ['Reporta con foto y GPS, incluso de forma anónima', 'Apoya con “Me afecta” y comenta', 'Recibe avisos cuando cambia el estado'],
      cta: 'Crear cuenta',
    },
    {
      slug: 'voluntario', icon: 'heart', title: 'Voluntarios', lead: 'Tu tiempo donde más se necesita.',
      points: ['Súmate a la solución de un reporte', 'Asiste a jornadas con registro por QR', 'Obtén constancias de horas de servicio social'],
      cta: 'Quiero ser voluntario',
    },
    {
      slug: 'ong', icon: 'users', title: 'Organizaciones y ONG', lead: 'Coordina sin perder el hilo.',
      points: ['Crea eventos ligados a reportes reales', 'Solicita insumos y gestiona donaciones', 'Publica con transparencia el uso de recursos'],
      cta: 'Registrar organización',
    },
    {
      slug: 'institucion', icon: 'landmark', title: 'Instituciones públicas', lead: 'Reportes ordenados por jurisdicción.',
      points: ['Recibe casos según ubicación y categoría', 'Actualiza estados y sube evidencia', 'Mide y exporta tus tiempos de respuesta'],
      cta: 'Registrar institución',
    },
  ];

  readonly faqs = [
    { q: '¿Cuánto cuesta usar ConectaRD?', a: 'Nada. Reportar, apoyar, comentar y participar como voluntario es gratis para cualquier persona.' },
    { q: '¿Puedo reportar sin mostrar mi nombre?', a: 'Sí. Puedes publicar un reporte de forma anónima: tu identidad no se muestra públicamente, aunque la plataforma la conserva para evitar abusos, conforme a la Ley 172-13.' },
    { q: '¿Quién resuelve los reportes?', a: 'Cada reporte se dirige al ayuntamiento o institución responsable según su ubicación y categoría. Voluntarios y ONG pueden sumarse cuando la solución es comunitaria, como una jornada de limpieza.' },
    { q: '¿Cómo sé si mi reporte avanzó?', a: 'Cada caso tiene un estado público (Reportado, En revisión, En proceso, Resuelto o Rechazado) y recibirás una notificación cada vez que cambie.' },
    { q: '¿Necesito instalar una aplicación?', a: 'No. ConectaRD funciona en el navegador de tu teléfono o computadora y puedes instalarla en la pantalla de inicio como una app.' },
    { q: '¿Cómo se evitan los reportes falsos?', a: 'La comunidad puede denunciar contenido, hay moderación y filtros automáticos, y las organizaciones e instituciones pasan por una verificación con documentos oficiales.' },
  ];

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
