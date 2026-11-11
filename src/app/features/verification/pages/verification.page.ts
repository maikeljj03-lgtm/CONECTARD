import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ORGANIZATION_TYPES } from '../../../core/data/dominican-republic';
import { friendlyDataError } from '../../../core/data/errors';
import { Profile, ProfileService } from '../../../core/data/profile.service';
import { MAX_DOCUMENTS, VerificationRequest, VerificationService } from '../../../core/data/verification.service';

const INSTITUTION_TYPES = ['ayuntamiento', 'junta_distrital', 'ministerio_o_direccion'];

@Component({
  selector: 'app-verification',
  templateUrl: './verification.page.html',
  standalone: false,
})
export class VerificationPage implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly profiles = inject(ProfileService);
  private readonly verification = inject(VerificationService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly organizationTypes = ORGANIZATION_TYPES;
  readonly maxDocuments = MAX_DOCUMENTS;

  profile: Profile | null = null;
  requests: VerificationRequest[] = [];
  files: File[] = [];
  loading = true;
  loadError = '';
  sending = false;
  message = '';
  submitted = false;

  readonly form = this.formBuilder.nonNullable.group({
    requested_role: ['organization' as 'organization' | 'institution', Validators.required],
    organization_name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    organization_type: ['ong', Validators.required],
    rnc: ['', [Validators.pattern(/^(\d[\s-]?){9}$|^(\d[\s-]?){11}$/)]],
    contact_name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    contact_phone: ['', [Validators.required, Validators.pattern(/^[0-9+() -]{7,20}$/)]],
    coverage_area: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(160)]],
  });

  async ngOnInit(): Promise<void> {
    try {
      this.profile = await this.profiles.getMyProfile();
      if (this.profile.requested_role === 'institution') this.setRole('institution');
      this.requests = await this.verification.getMyRequests();
    } catch (error) {
      this.loadError = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  get pendingRequest(): VerificationRequest | undefined {
    return this.requests.find((request) => request.status === 'pending');
  }

  get alreadyVerified(): boolean {
    return !!this.profile && ['organization', 'institution', 'administrator'].includes(this.profile.role);
  }

  get visibleTypes() {
    const institution = this.form.controls.requested_role.value === 'institution';
    return this.organizationTypes.filter((type) => type.value === 'otra' || INSTITUTION_TYPES.includes(type.value) === institution);
  }

  typeLabel(value: string): string {
    return this.organizationTypes.find((type) => type.value === value)?.label ?? value;
  }

  setRole(role: 'organization' | 'institution'): void {
    this.form.controls.requested_role.setValue(role);
    this.form.controls.organization_type.setValue(role === 'institution' ? 'ayuntamiento' : 'ong');
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selected = Array.from(input.files ?? []);
    input.value = '';
    this.message = '';
    for (const file of selected) {
      const problem = this.verification.validateDocument(file);
      if (problem) {
        this.message = problem;
        continue;
      }
      if (this.files.length >= MAX_DOCUMENTS) {
        this.message = `Puedes adjuntar hasta ${MAX_DOCUMENTS} documentos.`;
        break;
      }
      if (!this.files.some((existing) => existing.name === file.name && existing.size === file.size)) this.files.push(file);
    }
  }

  removeFile(index: number): void {
    this.files.splice(index, 1);
  }

  formatSize(bytes: number): string {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async submit(): Promise<void> {
    if (this.form.invalid || !this.files.length) {
      this.form.markAllAsTouched();
      if (!this.files.length) this.message = 'Adjunta al menos un documento oficial.';
      return;
    }
    this.sending = true;
    this.message = '';
    try {
      const value = this.form.getRawValue();
      const created = await this.verification.submit({ ...value, rnc: value.rnc || null }, this.files);
      this.requests = [created, ...this.requests];
      this.files = [];
      this.submitted = true;
    } catch (error) {
      this.message = friendlyDataError(error);
    } finally {
      this.sending = false;
      this.changeDetector.markForCheck();
    }
  }
}
