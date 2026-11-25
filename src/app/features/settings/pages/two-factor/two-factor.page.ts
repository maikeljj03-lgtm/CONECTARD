import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { t } from '../../../../core/i18n/i18n';
import { AuthService } from '../../../../core/services/auth.service';
import { RolesService } from '../../../../core/services/roles.service';
import { SecurityService } from '../../../../core/services/security.service';
import { isSafeReturnUrl } from '../../../../core/utils/return-url';

/** Segundo paso al entrar (RF-53): pide el código de la app autenticadora y vuelve a donde iba. */
@Component({
  selector: 'app-two-factor',
  templateUrl: './two-factor.page.html',
  styleUrls: ['./two-factor.page.scss'],
  standalone: false,
})
export class TwoFactorPage implements OnInit {
  private readonly security = inject(SecurityService);
  private readonly auth = inject(AuthService);
  private readonly roles = inject(RolesService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly changeDetector = inject(ChangeDetectorRef);

  code = '';
  busy = false;
  error = '';
  private factorId: string | null = null;

  async ngOnInit(): Promise<void> {
    try {
      const status = await this.security.status();
      if (!status.needsCode) {
        await this.continue();
        return;
      }
      this.factorId = status.factorId;
    } catch {
      this.error = t('voice.error');
    }
    this.changeDetector.markForCheck();
  }

  async verify(): Promise<void> {
    if (!this.factorId || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      await this.security.verifyCode(this.factorId, this.code);
      this.roles.clearCache();
      await this.continue();
    } catch (error) {
      const message = (error as { message?: string })?.message ?? '';
      this.error = message.includes('6 dígitos') ? message : t('mfa.badCode');
      this.code = '';
    } finally {
      this.busy = false;
      this.changeDetector.markForCheck();
    }
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    this.roles.clearCache();
    await this.router.navigateByUrl('/landing', { replaceUrl: true });
  }

  private async continue(): Promise<void> {
    const back = this.route.snapshot.queryParamMap.get('volver');
    await this.router.navigateByUrl(isSafeReturnUrl(back) ? back : '/inicio', { replaceUrl: true });
  }
}
