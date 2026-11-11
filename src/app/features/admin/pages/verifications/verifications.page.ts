import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ORGANIZATION_TYPES, ROLE_LABELS } from '../../../../core/constants/catalogs';
import type { VerificationRequestWithProfile } from '../../../../core/models/verification.model';
import { ProfileService } from '../../../../core/services/profile.service';
import { VerificationService } from '../../../../core/services/verification.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';

type Tab = 'pending' | 'approved' | 'rejected';

@Component({
  selector: 'app-admin-verifications',
  templateUrl: './verifications.page.html',
  standalone: false,
})
export class AdminVerificationsPage implements OnInit {
  private readonly profiles = inject(ProfileService);
  private readonly verification = inject(VerificationService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly roleLabels = ROLE_LABELS;
  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'pending', label: 'Pendientes' },
    { id: 'approved', label: 'Aprobadas' },
    { id: 'rejected', label: 'Rechazadas' },
  ];

  isAdmin = false;
  loading = true;
  listLoading = false;
  error = '';
  tab: Tab = 'pending';
  requests: VerificationRequestWithProfile[] = [];
  notes: Record<string, string> = {};
  busyId = '';
  feedback = '';

  async ngOnInit(): Promise<void> {
    try {
      const profile = await this.profiles.getMyProfile();
      this.isAdmin = profile.role === 'administrator';
      if (this.isAdmin) await this.load();
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  typeLabel(value: string): string {
    return ORGANIZATION_TYPES.find((type) => type.value === value)?.label ?? value;
  }

  documentName(path: string): string {
    return path.split('/').pop()?.replace(/^\d+-\d+-/, '') ?? path;
  }

  async selectTab(tab: Tab): Promise<void> {
    this.tab = tab;
    this.feedback = '';
    await this.load();
  }

  async openDocument(path: string): Promise<void> {
    // Se abre la pestaña antes de la espera para que el navegador no la bloquee.
    // (Con 'noopener' window.open devuelve null, por eso se corta el vínculo a mano.)
    const preview = window.open('', '_blank');
    if (preview) preview.opener = null;
    try {
      const url = await this.verification.documentUrl(path);
      if (preview) preview.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch (error) {
      preview?.close();
      this.error = friendlyDataError(error);
      this.changeDetector.markForCheck();
    }
  }

  async review(request: VerificationRequestWithProfile, approve: boolean): Promise<void> {
    const notes = this.notes[request.id] ?? '';
    if (!approve && !notes.trim()) {
      this.error = 'Escribe el motivo del rechazo para que la organización sepa qué corregir.';
      return;
    }
    this.busyId = request.id;
    this.error = '';
    this.feedback = '';
    try {
      await this.verification.review(request.id, approve, notes);
      this.requests = this.requests.filter((item) => item.id !== request.id);
      this.feedback = approve
        ? `“${request.organization_name}” fue aprobada. La cuenta ya tiene el rol de ${this.roleLabels[request.requested_role].toLowerCase()}.`
        : `“${request.organization_name}” fue rechazada.`;
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.busyId = '';
      this.changeDetector.markForCheck();
    }
  }

  private async load(): Promise<void> {
    this.listLoading = true;
    this.error = '';
    this.changeDetector.markForCheck();
    try {
      this.requests = await this.verification.listForReview(this.tab);
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.listLoading = false;
      this.changeDetector.markForCheck();
    }
  }
}
