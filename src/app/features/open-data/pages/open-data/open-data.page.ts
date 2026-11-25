import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS } from '../../../../core/constants/catalogs';
import { AuthService } from '../../../../core/services/auth.service';
import { PlatformService, type PublicStats } from '../../../../core/services/platform.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';

interface Endpoint {
  method: 'GET';
  path: string;
  description: string;
  example: string;
}

/** Datos abiertos (RF-57): cifras en vivo y documentación de la API pública. */
@Component({
  selector: 'app-open-data',
  templateUrl: './open-data.page.html',
  styleUrls: ['./open-data.page.scss'],
  standalone: false,
})
export class OpenDataPage implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly statusLabels = REPORT_STATUS_LABELS;
  signedIn = false;
  stats: PublicStats | null = null;
  loading = true;
  error = '';
  baseUrl = '';
  copied = '';
  endpoints: Endpoint[] = [];

  async ngOnInit(): Promise<void> {
    this.signedIn = !!this.auth.getCachedCurrentUser();
    try {
      this.baseUrl = await this.auth.functionUrl('public-api');
      this.endpoints = [
        { method: 'GET', path: '/v1/reports', description: 'Reportes más recientes primero. Filtros: category, status, province, municipality, since (fecha), limit (1-100) y offset.', example: `${this.baseUrl}/v1/reports?category=basura&status=resuelto&limit=20` },
        { method: 'GET', path: '/v1/reports/{id}', description: 'Un reporte por su identificador.', example: `${this.baseUrl}/v1/reports/<id>` },
        { method: 'GET', path: '/v1/stats', description: 'Totales por estado, categoría y provincia, resueltos en 30 días, mediana de resolución y satisfacción promedio.', example: `${this.baseUrl}/v1/stats` },
        { method: 'GET', path: '/v1/openapi.json', description: 'Especificación OpenAPI 3.1 (para Swagger, Postman o generar clientes).', example: `${this.baseUrl}/v1/openapi.json` },
      ];
      this.stats = await this.platform.publicStats();
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  get categories(): { label: string; n: number; share: number }[] {
    const stats = this.stats;
    if (!stats) return [];
    const total = Math.max(1, stats.reports_total);
    return REPORT_CATEGORIES.map((category) => ({ label: category.label, n: stats.by_category[category.value] ?? 0, share: Math.round(((stats.by_category[category.value] ?? 0) / total) * 100) }))
      .sort((a, b) => b.n - a.n);
  }

  get statuses(): { key: string; label: string; n: number }[] {
    const stats = this.stats;
    if (!stats) return [];
    return Object.keys(this.statusLabels).map((key) => ({ key, label: this.statusLabels[key], n: stats.by_status[key] ?? 0 }));
  }

  async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied = text;
      setTimeout(() => {
        this.copied = '';
        this.changeDetector.markForCheck();
      }, 1800);
    } catch {
      this.copied = '';
    }
    this.changeDetector.markForCheck();
  }
}
