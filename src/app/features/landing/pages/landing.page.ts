import { AfterViewInit, Component, ElementRef, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import type { User } from '@supabase/supabase-js';
import { IonContent } from '@ionic/angular';
import * as L from 'leaflet';
import { AuthService } from '../../../core/auth/auth.service';

type ReportCategory = 'Basura' | 'Baches' | 'Iluminación' | 'Agua' | 'Áreas verdes' | 'Otros';
type ReportFilter = 'Todas' | ReportCategory;

interface CommunityReport {
  title: string;
  category: ReportCategory;
  area: string;
  age: string;
  status: 'Pendiente' | 'En proceso' | 'Resuelto';
  lat: number;
  lng: number;
  photo: string;
  photoAlt: string;
}

@Component({
  selector: 'app-landing',
  templateUrl: './landing.page.html',
  styleUrls: ['./landing.page.scss'],
  standalone: false,
})
export class LandingPage implements OnInit, AfterViewInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  user: User | null = null;
  loading = true;
  activeSection = 'inicio';
  @ViewChild(IonContent) private ionContent?: IonContent;
  searchTerm = '';
  selectedCategory: ReportFilter = 'Todas';
  @ViewChild('reportMap') private reportMap?: ElementRef<HTMLDivElement>;
  @ViewChild('mapShell') private mapShell?: ElementRef<HTMLDivElement>;
  private map?: L.Map;
  private reportMarkers?: L.LayerGroup;
  private readonly markersByTitle = new Map<string, L.Marker>();
  private locationMarker?: L.CircleMarker;
  private mapResizeObserver?: ResizeObserver;
  mapFeedback = '';
  private readonly dominicanRepublicBounds = L.latLngBounds([17.45, -72.05], [20.05, -68.2]);
  readonly currentYear = new Date().getFullYear();

  readonly categories: ReportFilter[] = ['Todas', 'Basura', 'Baches', 'Iluminación', 'Agua', 'Áreas verdes'];

  readonly impactMetrics = [
    { icon: '▤', value: '1,248', label: 'Reportes' },
    { icon: '✓', value: '892', label: 'Resueltos' },
    { icon: '♧', value: '342', label: 'Voluntarios' },
    { icon: '⌂', value: '56', label: 'Comunidades' },
  ];

  readonly reports: CommunityReport[] = [
    { title: 'Acumulación de basura', category: 'Basura', area: 'Calle Duarte', age: 'Hace 2 h', status: 'En proceso', lat: 18.4861, lng: -69.9312, photo: 'https://images.unsplash.com/photo-1631451705997-00e7502d6689?auto=format&fit=crop&w=720&q=80', photoAlt: 'Imagen ilustrativa de basura en una calle' },
    { title: 'Bache en la calle', category: 'Baches', area: 'Villa Duarte', age: 'Hace 4 h', status: 'Pendiente', lat: 18.488, lng: -69.868, photo: 'https://images.unsplash.com/photo-1658087309834-8693a4fb2969?auto=format&fit=crop&w=720&q=80', photoAlt: 'Imagen ilustrativa de pavimento deteriorado' },
    { title: 'Falta de iluminación', category: 'Iluminación', area: 'Los Alcarrizos', age: 'Hace 6 h', status: 'Resuelto', lat: 18.516, lng: -70.017, photo: 'https://images.unsplash.com/photo-1755039467000-92877d90202d?auto=format&fit=crop&w=720&q=80', photoAlt: 'Imagen nocturna ilustrativa de una ciudad' },
    { title: 'Fuga de agua', category: 'Agua', area: 'Santo Domingo', age: 'Hace 7 h', status: 'Pendiente', lat: 18.49, lng: -69.856, photo: 'https://images.unsplash.com/photo-1538865813716-e8205468e2ff?auto=format&fit=crop&w=720&q=80', photoAlt: 'Imagen ilustrativa de agua en movimiento' },
    { title: 'Parque en mal estado', category: 'Áreas verdes', area: 'Los Alcarrizos', age: 'Hace 8 h', status: 'En proceso', lat: 18.475, lng: -69.92, photo: 'https://images.unsplash.com/photo-1762538843563-6698996da277?auto=format&fit=crop&w=720&q=80', photoAlt: 'Imagen ilustrativa de un parque verde' },
  ];

  readonly categoryStats = [
    { name: 'Basura', value: 28, color: 'teal' },
    { name: 'Baches', value: 22, color: 'blue' },
    { name: 'Iluminación', value: 18, color: 'mint' },
    { name: 'Agua', value: 12, color: 'ice' },
    { name: 'Áreas verdes', value: 11, color: 'gray' },
    { name: 'Otros', value: 9, color: 'slate' },
  ];

  readonly upcomingEvents = [
    { title: 'Jornada de limpieza comunitaria', meta: 'Santo Domingo · Fecha por anunciar' },
    { title: 'Taller de reciclaje', meta: 'Actividad comunitaria · Fecha por anunciar' },
    { title: 'Reforestación del barrio', meta: 'Participación abierta · Fecha por anunciar' },
  ];

  readonly recentActivity = [
    { initials: 'ML', name: 'María López', description: 'comentó en un reporte', detail: '“Ya fue reparado, ¡gracias!” · Hace 5 min' },
    { initials: 'CP', name: 'Carlos Peña', description: 'se unió como voluntario', detail: 'Villa Duarte · Hace 20 min' },
    { initials: '✓', name: 'Falta de iluminación', description: 'fue marcada como resuelta', detail: 'Los Alcarrizos · Hace 1 h' },
  ];

  readonly steps = [
    { number: '01', icon: '▤', title: 'Reporta el problema', description: 'Describe y ubica lo que pasa en tu comunidad.', photo: 'https://images.unsplash.com/photo-1658087309834-8693a4fb2969?auto=format&fit=crop&w=640&q=75', alt: 'Calle urbana, foto ilustrativa' },
    { number: '02', icon: '♧', title: 'Conecta con la comunidad', description: 'Otros ciudadanos y organizaciones se unen.', photo: 'https://images.unsplash.com/photo-1746573955815-332ade24959a?auto=format&fit=crop&w=640&q=75', alt: 'Voluntariado comunitario, foto ilustrativa' },
    { number: '03', icon: '▣', title: 'Participa en eventos', description: 'Únete a actividades y jornadas locales.', photo: 'https://images.unsplash.com/photo-1762538843563-6698996da277?auto=format&fit=crop&w=640&q=75', alt: 'Parque verde, foto ilustrativa' },
    { number: '04', icon: '✓', title: 'Resuelve en comunidad', description: 'Damos seguimiento hasta encontrar una solución.', photo: 'https://images.unsplash.com/photo-1673985870997-0e2aaae8cbb2?auto=format&fit=crop&w=640&q=75', alt: 'Vista de Santo Domingo, foto ilustrativa' },
  ];

  get filteredReports(): CommunityReport[] {
    const query = this.searchTerm.trim().toLocaleLowerCase();
    return this.reports.filter((report) => {
      const matchesCategory = this.selectedCategory === 'Todas' || report.category === this.selectedCategory;
      const matchesQuery = !query || `${report.title} ${report.category} ${report.area}`.toLocaleLowerCase().includes(query);
      return matchesCategory && matchesQuery;
    });
  }

  ngOnInit(): void {
    this.user = this.auth.getCachedCurrentUser();
    this.loading = false;
    if (!this.user) void this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  ngAfterViewInit(): void {
    if (!this.user || !this.reportMap) return;
    this.map = L.map(this.reportMap.nativeElement, {
      scrollWheelZoom: false,
      zoomControl: false,
      minZoom: 7,
      maxZoom: 12,
      zoomSnap: 0.5,
      maxBounds: this.dominicanRepublicBounds,
      maxBoundsViscosity: 1,
    });
    this.resetMap();
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(this.map);
    this.reportMarkers = L.layerGroup().addTo(this.map);
    this.renderMapMarkers();
    this.mapResizeObserver = new ResizeObserver(() => {
      this.map?.invalidateSize({ pan: false, debounceMoveend: true });
    });
    this.mapResizeObserver.observe(this.reportMap.nativeElement);
    requestAnimationFrame(() => this.map?.invalidateSize({ pan: false }));
  }

  ngOnDestroy(): void {
    this.mapResizeObserver?.disconnect();
    this.map?.remove();
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  updateSearch(event: Event): void {
    this.searchTerm = (event.target as HTMLInputElement).value;
    this.renderMapMarkers();
  }

  selectCategory(category: ReportFilter): void {
    this.selectedCategory = category;
    this.renderMapMarkers();
  }

  zoomMap(amount: number): void {
    if (amount > 0) this.map?.zoomIn();
    else this.map?.zoomOut();
  }

  resetMap(): void {
    this.map?.fitBounds(this.dominicanRepublicBounds, { padding: [18, 18], maxZoom: 8 });
    this.mapFeedback = 'Vista completa de República Dominicana.';
  }

  focusReport(report: CommunityReport): void {
    const marker = this.markersByTitle.get(report.title);
    if (!this.map || !marker) return;
    const position = marker.getLatLng();
    this.map.flyTo(position, 11, { duration: 0.7 });
    window.setTimeout(() => marker.openPopup(), 750);
    this.mapFeedback = `${report.title} · ${report.area}`;
  }

  locateMe(): void {
    if (!navigator.geolocation) {
      this.mapFeedback = 'Este navegador no permite consultar tu ubicación.';
      return;
    }
    this.mapFeedback = 'Buscando tu ubicación…';
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position = L.latLng(coords.latitude, coords.longitude);
        if (!this.dominicanRepublicBounds.contains(position)) {
          this.mapFeedback = 'Tu ubicación está fuera de República Dominicana.';
          return;
        }
        this.locationMarker?.remove();
        this.locationMarker = L.circleMarker(position, {
          radius: 8,
          color: '#ffffff',
          weight: 3,
          fillColor: '#3978ff',
          fillOpacity: 1,
        }).addTo(this.map!);
        this.locationMarker.bindTooltip('Tu ubicación');
        this.map?.flyTo(position, 11, { duration: 0.7 });
        this.mapFeedback = 'Mostrando tu ubicación aproximada.';
      },
      () => {
        this.mapFeedback = 'No se pudo obtener tu ubicación. Revisa el permiso del navegador.';
      },
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

  private renderMapMarkers(): void {
    if (!this.reportMarkers) return;
    this.reportMarkers.clearLayers();
    this.markersByTitle.clear();
    const icon = L.divIcon({ className: 'dr-report-marker', html: '<span></span>', iconSize: [22, 28], iconAnchor: [11, 27] });
    for (const report of this.filteredReports) {
      const marker = L.marker([report.lat, report.lng], { icon })
        .bindPopup(`<strong>${report.title}</strong><br>${report.area} · ${report.status}`)
        .addTo(this.reportMarkers);
      this.markersByTitle.set(report.title, marker);
    }
  }

  navigateTo(event: Event, sectionId: string): void {
    event.preventDefault();
    void this.scrollTo(sectionId);
  }

  async scrollTo(sectionId: string): Promise<void> {
    const target = document.getElementById(sectionId);
    if (!target) return;
    this.activeSection = sectionId;
    const scrollElement = await this.ionContent?.getScrollElement();
    if (!scrollElement || !this.ionContent) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const top = target.getBoundingClientRect().top
      - scrollElement.getBoundingClientRect().top
      + scrollElement.scrollTop
      - 70;
    await this.ionContent.scrollToPoint(0, Math.max(top, 0), 450);
  }

  get displayName(): string {
    const name = this.user?.user_metadata?.['full_name'];
    return typeof name === 'string' && name.trim() ? name.trim().split(' ')[0] : 'Vecino/a';
  }
}
