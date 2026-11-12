import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, inject } from '@angular/core';
import { ROLE_LABELS } from '../../../core/constants/catalogs';
import type { ResourceDonation, ResourceRequest, ResourceStatus, ResourceUsage } from '../../../core/models/community.model';
import type { UserRole } from '../../../core/models/profile.model';
import { ReportMediaService } from '../../../core/services/report-media.service';
import { ResourcesService, resourceProgress } from '../../../core/services/resources.service';
import { friendlyDataError } from '../../../core/utils/data-errors';
import type { ProcessedMedia } from '../../../core/utils/media';

type Panel = 'donacion' | 'uso' | null;

/**
 * Insumos de un reporte (RF-29) y transparencia de donaciones y su uso (RF-30).
 * Cualquiera ve qué se pidió, qué se recibió (y de quién, si el donante quiso) y en qué se usó.
 * Pide insumos una organización o institución; registra los movimientos quien hizo la solicitud.
 */
@Component({
  selector: 'app-report-resources',
  templateUrl: './report-resources.component.html',
  styleUrls: ['./report-resources.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportResourcesComponent implements OnChanges {
  private readonly resources = inject(ResourcesService);
  private readonly media = inject(ReportMediaService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  @Input({ required: true }) reportId!: string;
  @Input() role: UserRole | null = null;
  /** El reporte sigue abierto (se pueden pedir insumos nuevos). */
  @Input() open = true;

  readonly roleLabels = ROLE_LABELS;
  readonly today = toDateInput(new Date());

  requests: ResourceRequest[] = [];
  donations: ResourceDonation[] = [];
  usages: ResourceUsage[] = [];
  loading = true;
  error = '';
  expandedId: string | null = null;
  panel: Panel = null;
  saving = false;
  formError = '';

  // Formularios (controlados a mano: son pequeños y viven dentro de cada tarjeta).
  showNew = false;
  newItem = { item: '', quantity: '', unit: 'unidades', description: '' };
  donation = { donor_name: '', quantity: '', note: '', received_on: this.today };
  usage = { quantity: '', description: '', used_on: this.today };
  usagePhoto: ProcessedMedia | null = null;
  photoProcessing = false;

  get canRequest(): boolean {
    return this.open && (this.role === 'organization' || this.role === 'institution' || this.role === 'administrator');
  }

  async ngOnChanges(): Promise<void> {
    await this.load();
  }

  canManage(request: ResourceRequest): boolean {
    return !!request.is_mine || this.role === 'administrator';
  }

  progress(request: ResourceRequest) {
    return resourceProgress(request);
  }

  donationsOf(request: ResourceRequest): ResourceDonation[] {
    return this.donations.filter((item) => item.request_id === request.id);
  }

  usagesOf(request: ResourceRequest): ResourceUsage[] {
    return this.usages.filter((item) => item.request_id === request.id);
  }

  photoUrl(usage: ResourceUsage): string | null {
    return this.media.coverUrl(usage.photo_path);
  }

  /** Número legible: sin decimales si es entero. */
  number(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
  }

  amount(value: number, unit: string): string {
    return `${this.number(value)} ${unit}`;
  }

  statusLabel(status: ResourceStatus): string {
    return { abierta: 'Abierta', cerrada: 'Completada', cancelada: 'Cancelada' }[status];
  }

  toggle(request: ResourceRequest): void {
    this.expandedId = this.expandedId === request.id ? null : request.id;
    this.panel = null;
    this.formError = '';
  }

  openPanel(panel: Panel): void {
    this.panel = this.panel === panel ? null : panel;
    this.formError = '';
    this.donation = { donor_name: '', quantity: '', note: '', received_on: this.today };
    this.usage = { quantity: '', description: '', used_on: this.today };
    this.usagePhoto = null;
  }

  async createRequest(): Promise<void> {
    const quantity = Number(this.newItem.quantity);
    if (this.newItem.item.trim().length < 2) return this.fail('Escribe qué material se necesita.');
    if (!(quantity > 0)) return this.fail('Indica una cantidad mayor que cero.');
    if (!this.newItem.unit.trim()) return this.fail('Indica la unidad (sacos, galones, unidades…).');
    await this.run(async () => {
      await this.resources.createRequest(this.reportId, {
        item: this.newItem.item,
        quantity,
        unit: this.newItem.unit,
        description: this.newItem.description || null,
      });
      this.showNew = false;
      this.newItem = { item: '', quantity: '', unit: 'unidades', description: '' };
    });
  }

  async addDonation(request: ResourceRequest): Promise<void> {
    const quantity = Number(this.donation.quantity);
    if (!(quantity > 0)) return this.fail('Indica cuánto se recibió.');
    if (!this.donation.received_on || this.donation.received_on > this.today) return this.fail('La fecha no puede ser futura.');
    await this.run(async () => {
      await this.resources.addDonation(request.id, {
        donor_name: this.donation.donor_name || null,
        quantity,
        note: this.donation.note || null,
        received_on: this.donation.received_on,
      });
      this.panel = null;
    });
  }

  async addUsage(request: ResourceRequest): Promise<void> {
    const quantity = Number(this.usage.quantity);
    if (!(quantity > 0)) return this.fail('Indica cuánto se usó.');
    if (quantity > request.received - request.used) {
      return this.fail(`Solo quedan ${this.amount(request.received - request.used, request.unit)} por usar de lo recibido.`);
    }
    if (this.usage.description.trim().length < 5) return this.fail('Describe en qué se usó (al menos 5 caracteres).');
    if (!this.usage.used_on || this.usage.used_on > this.today) return this.fail('La fecha no puede ser futura.');
    if (this.photoProcessing) return this.fail('Espera a que termine de procesarse la foto.');
    await this.run(async () => {
      await this.resources.addUsage(this.reportId, request.id, {
        quantity,
        description: this.usage.description,
        used_on: this.usage.used_on,
      }, this.usagePhoto);
      this.panel = null;
    });
  }

  async setStatus(request: ResourceRequest, status: ResourceStatus): Promise<void> {
    const question = status === 'cancelada' ? '¿Cancelar esta solicitud? Ya no se podrán registrar donaciones.' : '¿Marcar la solicitud como completada?';
    if (!window.confirm(question)) return;
    await this.run(() => this.resources.setRequestStatus(request.id, status));
  }

  onPhoto(items: ProcessedMedia[]): void {
    this.usagePhoto = items[0] ?? null;
  }

  private fail(message: string): void {
    this.formError = message;
    this.changeDetector.markForCheck();
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.saving = true;
    this.formError = '';
    this.changeDetector.markForCheck();
    try {
      await action();
      await this.load();
    } catch (error) {
      this.formError = friendlyDataError(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  private async load(): Promise<void> {
    if (!this.reportId) return;
    this.loading = true;
    this.error = '';
    try {
      this.requests = await this.resources.listForReport(this.reportId);
      const ids = this.requests.map((request) => request.id);
      [this.donations, this.usages] = await Promise.all([this.resources.listDonations(ids), this.resources.listUsages(ids)]);
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }
}

function toDateInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
