import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS, ROLE_LABELS } from '../../../../core/constants/catalogs';
import { DR_PROVINCES } from '../../../../core/constants/geography';
import type { Profile } from '../../../../core/models/profile.model';
import type { MyReport } from '../../../../core/models/report.model';
import type { VerificationRequest } from '../../../../core/models/verification.model';
import { ProfileService } from '../../../../core/services/profile.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { VerificationService } from '../../../../core/services/verification.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  standalone: false,
})
export class ProfilePage implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly profiles = inject(ProfileService);
  private readonly reports = inject(ReportsService);
  private readonly verification = inject(VerificationService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly provinces = DR_PROVINCES;
  readonly roleLabels = ROLE_LABELS;
  readonly statusLabels = REPORT_STATUS_LABELS;

  profile: Profile | null = null;
  myReports: MyReport[] = [];
  lastRequest: VerificationRequest | null = null;
  loading = true;
  loadError = '';
  saving = false;
  uploading = false;
  message = '';
  notice = '';

  readonly form = this.formBuilder.nonNullable.group({
    full_name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    province: [''],
    municipality: ['', [Validators.maxLength(80)]],
    sector: ['', [Validators.maxLength(80)]],
    bio: ['', [Validators.maxLength(280)]],
  });

  async ngOnInit(): Promise<void> {
    try {
      this.profile = await this.profiles.getMyProfile();
      this.fillForm(this.profile);
      // Lo demás no bloquea la página si aún no se aplicaron sus migraciones.
      const [reports, requests] = await Promise.allSettled([this.reports.getMyReports(), this.verification.getMyRequests()]);
      if (reports.status === 'fulfilled') this.myReports = reports.value;
      if (requests.status === 'fulfilled') this.lastRequest = requests.value[0] ?? null;
    } catch (error) {
      this.loadError = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  get initials(): string {
    const name = this.profile?.full_name?.trim() || '?';
    return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  }

  get bioLength(): number {
    return this.form.controls.bio.value.length;
  }

  /** ¿Puede solicitar verificación? Cuentas que pidieron ser ONG/institución y aún no lo son. */
  get canRequestVerification(): boolean {
    const profile = this.profile;
    if (!profile || ['organization', 'institution', 'administrator'].includes(profile.role)) return false;
    return this.lastRequest?.status !== 'pending';
  }

  categoryLabel(value: string): string {
    return REPORT_CATEGORIES.find((category) => category.value === value)?.label ?? value;
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving = true;
    this.message = '';
    this.notice = '';
    try {
      const value = this.form.getRawValue();
      this.profile = await this.profiles.updateMyProfile({
        full_name: value.full_name,
        province: value.province || null,
        municipality: value.municipality,
        sector: value.sector,
        bio: value.bio,
      });
      this.fillForm(this.profile);
      this.form.markAsPristine();
      this.notice = 'Perfil actualizado.';
    } catch (error) {
      this.message = friendlyDataError(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async onAvatarSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const problem = this.profiles.validateAvatar(file);
    if (problem) {
      this.message = problem;
      return;
    }
    this.uploading = true;
    this.message = '';
    this.notice = '';
    try {
      this.profile = await this.profiles.uploadAvatar(file);
      this.notice = 'Foto actualizada.';
    } catch (error) {
      this.message = friendlyDataError(error);
    } finally {
      this.uploading = false;
      this.changeDetector.markForCheck();
    }
  }

  private fillForm(profile: Profile): void {
    this.form.reset({
      full_name: profile.full_name ?? '',
      province: profile.province ?? '',
      municipality: profile.municipality ?? '',
      sector: profile.sector ?? '',
      bio: profile.bio ?? '',
    });
  }
}
