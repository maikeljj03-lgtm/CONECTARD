import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { REPORT_CATEGORIES } from '../../../../core/constants/catalogs';
import { DR_PROVINCES, isInsideDominicanRepublic } from '../../../../core/constants/geography';
import type { AdminInstitution, IotDevice } from '../../../../core/models/admin.model';
import { AdminService } from '../../../../core/services/admin.service';
import { AuthService } from '../../../../core/services/auth.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { timeAgo } from '../../../../core/utils/geo';

/**
 * Sensores urbanos (RF-58): registrar sensores de una institución, ver sus últimas mediciones y
 * pausarlos. Cuando una medición pasa el límite, la base de datos crea un reporte solo.
 */
@Component({
  selector: 'app-admin-sensors',
  templateUrl: './sensors.page.html',
  styleUrls: ['./sensors.page.scss'],
  standalone: false,
})
export class AdminSensorsPage implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly categories = REPORT_CATEGORIES;
  readonly provinces = DR_PROVINCES;
  devices: IotDevice[] = [];
  institutions: AdminInstitution[] = [];
  loading = true;
  error = '';
  formOpen = false;
  saving = false;
  formError = '';
  /** Clave del sensor recién creado: se muestra una sola vez. */
  created: { name: string; token: string; example: string } | null = null;
  copied = false;

  readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(80)]],
    ownerId: ['', Validators.required],
    category: ['agua', Validators.required],
    metric: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    unit: ['', [Validators.required, Validators.maxLength(20)]],
    threshold: [null as number | null, Validators.required],
    direction: ['mayor' as 'mayor' | 'menor', Validators.required],
    latitude: [null as number | null, [Validators.required, Validators.min(17.3), Validators.max(20.2)]],
    longitude: [null as number | null, [Validators.required, Validators.min(-72.1), Validators.max(-68.2)]],
    province: [''],
    municipality: ['', Validators.maxLength(80)],
    sector: ['', Validators.maxLength(80)],
  });

  async ngOnInit(): Promise<void> {
    await Promise.all([this.load(), this.loadInstitutions()]);
  }

  ago(iso: string | null): string {
    return iso ? timeAgo(iso) : 'Nunca';
  }

  categoryLabel(value: string): string {
    return this.categories.find((item) => item.value === value)?.label ?? value;
  }

  place(device: IotDevice): string {
    return [device.sector, device.municipality, device.province].filter(Boolean).join(', ') || 'Sin zona';
  }

  limitText(device: IotDevice): string {
    return `${device.direction === 'mayor' ? 'mayor que' : 'menor que'} ${device.threshold} ${device.unit}`;
  }

  isOver(device: IotDevice): boolean {
    if (device.last_value === null) return false;
    return device.direction === 'mayor' ? device.last_value > device.threshold : device.last_value < device.threshold;
  }

  openForm(): void {
    this.formOpen = true;
    this.created = null;
    this.formError = '';
  }

  async register(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError = 'Revisa los campos: nombre, institución, medida, unidad, límite y coordenadas dentro del país.';
      return;
    }
    const value = this.form.getRawValue();
    if (!isInsideDominicanRepublic(value.latitude!, value.longitude!)) {
      this.formError = 'Las coordenadas deben estar dentro de República Dominicana.';
      return;
    }
    this.saving = true;
    this.formError = '';
    try {
      const result = await this.admin.registerIotDevice({ ...value, threshold: value.threshold!, latitude: value.latitude!, longitude: value.longitude! });
      const endpoint = `${await this.auth.projectUrl()}/rest/v1/rpc/iot_submit_reading`;
      this.created = {
        name: value.name,
        token: result.token,
        example: `curl -X POST "${endpoint}" -H "apikey: <clave pública de Supabase>" -H "Content-Type: application/json" -d '{"device_token":"${result.token}","reading":42}'`,
      };
      this.formOpen = false;
      this.form.reset({ category: 'agua', direction: 'mayor' });
      await this.load();
    } catch (error) {
      this.formError = friendlyDataError(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async copyToken(): Promise<void> {
    if (!this.created) return;
    try {
      await navigator.clipboard.writeText(this.created.token);
      this.copied = true;
    } catch {
      this.copied = false;
    }
    this.changeDetector.markForCheck();
  }

  async toggle(device: IotDevice): Promise<void> {
    try {
      await this.admin.setIotDeviceActive(device.id, !device.active);
      await this.load();
    } catch (error) {
      this.error = friendlyDataError(error);
    }
    this.changeDetector.markForCheck();
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      this.devices = await this.admin.iotDevices();
      this.error = '';
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  private async loadInstitutions(): Promise<void> {
    try {
      this.institutions = (await this.admin.institutions()).filter((item) => !item.is_blocked);
    } catch {
      this.institutions = [];
    }
    this.changeDetector.markForCheck();
  }
}
