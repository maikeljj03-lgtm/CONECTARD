import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { SOCIAL_PROVIDERS, type SocialProvider, type SocialProviderInfo } from '../../../../core/constants/social-providers';

/**
 * Botones para entrar o registrarse con redes sociales (RF-01).
 * Muestra solo las redes activadas en Supabase: al activar una en el panel,
 * su botón aparece sin tocar código.
 */
@Component({
  selector: 'app-social-login',
  templateUrl: './social-login.component.html',
  styleUrls: ['./social-login.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SocialLoginComponent {
  /** Texto antes del nombre: "Continuar con", "Registrarme con". */
  @Input() verb = 'Continuar con';
  @Input() disabled = false;
  /** Red social que se está conectando (muestra "Conectando…"). */
  @Input() busyProvider: SocialProvider | null = null;
  /** Redes activadas en Supabase; null = no se pudo consultar (solo se muestran las principales). */
  @Input() enabledProviders: Set<string> | null = null;
  @Output() readonly selectProvider = new EventEmitter<SocialProvider>();

  moreOpen = false;

  get primary(): SocialProviderInfo[] {
    return SOCIAL_PROVIDERS.filter((provider) => provider.group === 'primary' && this.isVisible(provider));
  }

  get more(): SocialProviderInfo[] {
    return SOCIAL_PROVIDERS.filter((provider) => provider.group === 'more' && this.isVisible(provider));
  }

  /** Si no se ve ninguna red, el componente no muestra nada. */
  get hasAny(): boolean {
    return this.primary.length + this.more.length > 0;
  }

  private isVisible(provider: SocialProviderInfo): boolean {
    return this.enabledProviders ? this.enabledProviders.has(provider.id) : provider.group === 'primary';
  }
}
