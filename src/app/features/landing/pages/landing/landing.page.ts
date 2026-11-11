import { AfterViewInit, Component, ElementRef, inject, NgZone, OnDestroy, OnInit, ViewChild, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { User } from '@supabase/supabase-js';
import { IonContent } from '@ionic/angular';
import { REPORT_CATEGORIES } from '../../../../core/constants/catalogs';
import type { PublicReport } from '../../../../core/models/report.model';
import { AuthService } from '../../../../core/services/auth.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { FAQS, LANDING_CATEGORIES, LIFECYCLE, NAV_ITEMS, ROLES, SECTION_IDS, STATUS_COLORS } from '../../landing.content';

/**
 * Landing pública (RF-66): presenta ConectaRD a quien aún no tiene cuenta.
 * El mapa interactivo y la lista de reportes viven en /explorar y en el inicio con sesión (/inicio).
 */
@Component({
  selector: 'app-landing',
  templateUrl: './landing.page.html',
  styleUrls: ['./landing.page.scss'],
  // Estilos limitados por la clase raíz .landing-content.
  encapsulation: ViewEncapsulation.None,
  standalone: false,
})
export class LandingPage implements OnInit, AfterViewInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly reportsService = inject(ReportsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly zone = inject(NgZone);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  @ViewChild(IonContent) private ionContent?: IonContent;

  user: User | null = null;
  activeSection = 'inicio';
  scrolled = false;
  menuOpen = false;
  toast = '';
  /** Reportes públicos reales para la maqueta 3D. */
  sceneReports: PublicReport[] = [];
  sceneLoaded = false;
  selected: PublicReport | null = null;
  readonly currentYear = new Date().getFullYear();
  readonly statusColors = STATUS_COLORS;

  private sectionObserver?: IntersectionObserver;
  private revealObserver?: IntersectionObserver;
  private toastTimer?: ReturnType<typeof setTimeout>;

  readonly navItems = NAV_ITEMS;
  readonly categories = LANDING_CATEGORIES;
  readonly lifecycle = LIFECYCLE;
  readonly roles = ROLES;
  readonly faqs = FAQS;

  get displayName(): string {
    const name = this.user?.user_metadata?.['full_name'];
    return typeof name === 'string' && name.trim() ? name.trim().split(/\s+/)[0] : 'Vecino/a';
  }

  get initials(): string {
    const name = this.user?.user_metadata?.['full_name'];
    const source = typeof name === 'string' && name.trim() ? name.trim() : (this.user?.email ?? '?');
    return source.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  }

  ngOnInit(): void {
    this.user = this.auth.getCachedCurrentUser();
    void this.reportsService.listPublic({ limit: 60 })
      .then((reports) => (this.sceneReports = reports.filter((report) => report.status !== 'rechazado')))
      .catch(() => (this.sceneReports = []))
      .finally(() => (this.sceneLoaded = true));
  }

  ngAfterViewInit(): void {
    this.observeSections();
    // Enlaces directos a una sección: /landing#como-funciona
    const fragment = this.route.snapshot.fragment;
    if (fragment && SECTION_IDS.includes(fragment)) {
      setTimeout(() => void this.scrollTo(fragment, 0), 300);
    }
  }

  ngOnDestroy(): void {
    this.sectionObserver?.disconnect();
    this.revealObserver?.disconnect();
    if (this.toastTimer) clearTimeout(this.toastTimer);
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
    void this.router.navigateByUrl(this.user ? '/reportes/nuevo' : '/auth/register');
  }

  /** Las categorías llevan a Explorar con ese filtro aplicado. */
  filterByCategory(label: string): void {
    const category = REPORT_CATEGORIES.find((item) => item.label === label)?.value;
    void this.router.navigate(['/explorar'], { queryParams: category ? { categoria: category } : {} });
  }

  openReport(report: PublicReport): void {
    this.selected = report;
  }

  showOnMap(report: PublicReport): void {
    this.selected = null;
    void this.router.navigate(['/explorar'], { queryParams: { reporte: report.id } });
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

  private showToast(message: string): void {
    this.toast = message;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = ''), 4200);
  }
}
