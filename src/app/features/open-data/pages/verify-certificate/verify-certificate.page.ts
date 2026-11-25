import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { PlatformService, type Certificate } from '../../../../core/services/platform.service';
import { activityPeriod, hoursLabel } from '../../../../core/utils/certificate-pdf';
import { friendlyDataError } from '../../../../core/utils/data-errors';

export const CERTIFICATE_CODE = /^CRD-[0-9A-F]{5}-[0-9A-F]{5}$/;

/** Normaliza lo que escribe la persona: mayúsculas, sin espacios y con los guiones en su lugar. */
export function normalizeCertificateCode(value: string): string {
  const raw = value.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const body = raw.startsWith('CRD') ? raw.slice(3) : raw;
  return body.length === 10 ? `CRD-${body.slice(0, 5)}-${body.slice(5)}` : value.trim().toUpperCase();
}

/** Verificación pública de una constancia de voluntariado (RF-62). */
@Component({
  selector: 'app-verify-certificate',
  templateUrl: './verify-certificate.page.html',
  styleUrls: ['../open-data/open-data.page.scss', './verify-certificate.page.scss'],
  standalone: false,
})
export class VerifyCertificatePage implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);

  signedIn = false;
  code = '';
  searched = false;
  loading = false;
  error = '';
  result: Certificate | null = null;
  readonly hoursLabel = hoursLabel;
  readonly period = activityPeriod;

  async ngOnInit(): Promise<void> {
    this.signedIn = !!this.auth.getCachedCurrentUser();
    const code = this.route.snapshot.paramMap.get('codigo');
    if (code) {
      this.code = normalizeCertificateCode(code);
      await this.verify(false);
    }
  }

  async verify(updateUrl = true): Promise<void> {
    const code = normalizeCertificateCode(this.code);
    this.code = code;
    this.error = '';
    this.result = null;
    if (!CERTIFICATE_CODE.test(code)) {
      this.searched = false;
      this.error = 'El código tiene la forma CRD-XXXXX-XXXXX (letras de la A a la F y números).';
      return;
    }
    this.loading = true;
    this.changeDetector.markForCheck();
    try {
      this.result = await this.platform.verifyCertificate(code);
      this.searched = true;
      if (updateUrl) await this.router.navigate(['/verificar', code], { replaceUrl: true });
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }
}
