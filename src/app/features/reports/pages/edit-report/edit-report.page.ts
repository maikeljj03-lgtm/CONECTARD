import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { REPORT_CATEGORIES, type ReportCategoryValue } from '../../../../core/constants/catalogs';
import { REPORT_EDIT_WINDOW_HOURS, editTimeLeft, isReportEditable } from '../../../../core/constants/report-rules';
import type { MyReport, ReportMedia } from '../../../../core/models/report.model';
import { ProfileService } from '../../../../core/services/profile.service';
import { ReportMediaService } from '../../../../core/services/report-media.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { MEDIA_LIMITS, type ProcessedMedia } from '../../../../core/utils/media';

/**
 * Editar un reporte propio (RF-15): texto, categoría, referencia, anonimato y fotos.
 * La ubicación no se cambia: si está mal, se elimina el reporte y se crea de nuevo.
 */
@Component({
  selector: 'app-edit-report',
  templateUrl: './edit-report.page.html',
  styleUrls: ['./edit-report.page.scss'],
  standalone: false,
})
export class EditReportPage implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly reportsService = inject(ReportsService);
  private readonly mediaService = inject(ReportMediaService);
  private readonly profiles = inject(ProfileService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly categories = REPORT_CATEGORIES;
  readonly editHours = REPORT_EDIT_WINDOW_HOURS;

  report: MyReport | null = null;
  existingMedia: (ReportMedia & { url: string | null })[] = [];
  newMedia: ProcessedMedia[] = [];
  mediaProcessing = false;
  removingId: string | null = null;
  authorName = 'Tu nombre';
  loading = true;
  saving = false;
  /** Error que impide editar (no existe, no es tuyo o pasó el plazo). */
  blocked = '';
  message = '';

  readonly form = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(120)]],
    category: ['' as ReportCategoryValue | '', Validators.required],
    description: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(2000)]],
    address: ['', Validators.maxLength(200)],
    sector: ['', Validators.maxLength(80)],
    is_anonymous: [false],
  });

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    try {
      const [report, profile] = await Promise.all([this.reportsService.getMine(id), this.profiles.getMyProfile().catch(() => null)]);
      this.authorName = profile?.full_name || 'Tu nombre';
      if (!report || (profile && report.author_id !== profile.id)) {
        this.blocked = 'No encontramos este reporte entre los tuyos.';
      } else if (!isReportEditable(report)) {
        this.report = report;
        this.blocked = report.status !== 'reportado'
          ? 'Este reporte ya lo está atendiendo una institución, por eso no se puede editar.'
          : `Pasaron las ${this.editHours} horas para editar este reporte.`;
      } else {
        this.report = report;
        this.form.setValue({
          title: report.title,
          category: report.category,
          description: report.description,
          address: report.address ?? '',
          sector: report.sector ?? '',
          is_anonymous: report.is_anonymous,
        });
        const media = await this.mediaService.listForReport(report.id).catch(() => []);
        this.existingMedia = media.map((item) => ({ ...item, url: this.mediaService.coverUrl(item.path) }));
      }
    } catch (error) {
      this.blocked = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  get timeLeft(): string | null {
    return this.report ? editTimeLeft(this.report) : null;
  }

  get freeSlots(): number {
    return Math.max(0, MEDIA_LIMITS.maxItems - this.existingMedia.length);
  }

  get descriptionLength(): number {
    return this.form.controls.description.value.length;
  }

  get place(): string {
    const report = this.report;
    if (!report) return '';
    return [...new Set([report.sector, report.municipality, report.province].filter(Boolean))].join(', ') || 'Marcada en el mapa';
  }

  selectCategory(value: ReportCategoryValue): void {
    this.form.controls.category.setValue(value);
    this.form.controls.category.markAsDirty();
  }

  setAnonymous(value: boolean): void {
    this.form.controls.is_anonymous.setValue(value);
    this.form.controls.is_anonymous.markAsDirty();
  }

  async removeExisting(item: ReportMedia): Promise<void> {
    this.removingId = item.id;
    this.message = '';
    try {
      await this.mediaService.remove(item);
      this.existingMedia = this.existingMedia.filter((media) => media.id !== item.id);
    } catch (error) {
      this.message = friendlyDataError(error);
    } finally {
      this.removingId = null;
      this.changeDetector.markForCheck();
    }
  }

  async save(): Promise<void> {
    const report = this.report;
    if (!report) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.message = 'Revisa los campos marcados.';
      return;
    }
    if (this.mediaProcessing) {
      this.message = 'Espera a que terminen de procesarse las fotos.';
      return;
    }
    this.saving = true;
    this.message = '';
    try {
      const value = this.form.getRawValue();
      await this.reportsService.updateOwn(report.id, {
        title: value.title,
        description: value.description,
        category: value.category as ReportCategoryValue,
        address: value.address,
        sector: value.sector,
        is_anonymous: value.is_anonymous,
      });
      if (this.newMedia.length) {
        const result = await this.mediaService.upload(report.id, this.newMedia, this.existingMedia.length);
        if (result.failed.length) {
          this.message = `Los cambios se guardaron, pero ${result.failed.length === 1 ? 'un archivo no se pudo subir' : result.failed.length + ' archivos no se pudieron subir'}: ${friendlyDataError(result.firstError)}`;
          return;
        }
      }
      await this.router.navigate(['/reportes/mios'], { state: { saved: report.title } });
    } catch (error) {
      this.message = friendlyDataError(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }
}
