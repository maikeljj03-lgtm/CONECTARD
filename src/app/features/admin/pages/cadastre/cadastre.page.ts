import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import type { CadastralImportResult, CadastralSummary } from '../../../../core/models/admin.model';
import { AdminService } from '../../../../core/services/admin.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';

const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Revisa el archivo antes de enviarlo: debe ser un FeatureCollection de GeoJSON. */
export function readGeoJson(text: string): { collection: { type: 'FeatureCollection'; features: unknown[] } } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'El archivo no es un JSON válido.' };
  }
  const collection = value as { type?: unknown; features?: unknown };
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    return { error: 'El archivo debe ser un FeatureCollection de GeoJSON (con una lista "features").' };
  }
  if (!collection.features.length) return { error: 'El archivo no tiene zonas.' };
  if (collection.features.length > 5000) return { error: 'El archivo tiene más de 5000 zonas: divídelo en partes.' };
  return { collection: collection as { type: 'FeatureCollection'; features: unknown[] } };
}

/**
 * Catastro (RF-59): la administración importa las zonas oficiales (GeoJSON) y cada reporte queda
 * marcado como terreno público, privado o área protegida. Así la institución sabe a quién corresponde.
 */
@Component({
  selector: 'app-admin-cadastre',
  templateUrl: './cadastre.page.html',
  styleUrls: ['./cadastre.page.scss'],
  standalone: false,
})
export class AdminCadastrePage implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  summary: CadastralSummary | null = null;
  loading = true;
  error = '';
  fileName = '';
  private collection: { type: 'FeatureCollection'; features: unknown[] } | null = null;
  source = '';
  replace = false;
  importing = false;
  result: CadastralImportResult | null = null;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  get featureCount(): number {
    return this.collection?.features.length ?? 0;
  }

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.error = '';
    this.result = null;
    this.collection = null;
    this.fileName = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      this.error = 'El archivo pesa más de 15 MB: divídelo en partes.';
      return;
    }
    const parsed = readGeoJson(await file.text());
    if ('error' in parsed) {
      this.error = parsed.error;
    } else {
      this.collection = parsed.collection;
      this.fileName = file.name;
    }
    this.changeDetector.markForCheck();
  }

  async import(): Promise<void> {
    if (!this.collection) return;
    if (!this.source.trim()) {
      this.error = 'Indica de dónde salen los datos (por ejemplo, "Catastro Nacional, 2027").';
      return;
    }
    this.importing = true;
    this.error = '';
    try {
      this.result = await this.admin.importCadastralZones(this.collection, this.source, this.replace);
      this.collection = null;
      this.fileName = '';
      await this.load();
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.importing = false;
      this.changeDetector.markForCheck();
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      this.summary = await this.admin.cadastralSummary();
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }
}
