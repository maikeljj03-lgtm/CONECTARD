import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';

export interface TotpEnrollment {
  factorId: string;
  /** Imagen del código QR (SVG en data URL) que devuelve Supabase. */
  qrCode: string;
  secret: string;
}

export interface MfaStatus {
  /** Tiene un factor TOTP verificado (2FA activa). */
  enabled: boolean;
  factorId: string | null;
  /** La sesión actual ya pasó el segundo paso (aal2). */
  verifiedSession: boolean;
  /** La cuenta tiene 2FA y esta sesión todavía no lo verificó: hay que pedir el código. */
  needsCode: boolean;
}

/**
 * Verificación en dos pasos con una app autenticadora (RF-53), usando el MFA de Supabase Auth.
 * La base de datos exige la sesión verificada (aal2) para los permisos de administración e institución
 * de quien lo activó (public.mfa_satisfied).
 */
@Injectable({ providedIn: 'root' })
export class SecurityService {
  private readonly auth = inject(AuthService);

  async status(): Promise<MfaStatus> {
    const client = await this.auth.supabase();
    const [factors, level] = await Promise.all([client.auth.mfa.listFactors(), client.auth.mfa.getAuthenticatorAssuranceLevel()]);
    if (factors.error) throw factors.error;
    if (level.error) throw level.error;
    const verified = factors.data.totp.find((factor) => factor.status === 'verified') ?? null;
    const current = level.data.currentLevel;
    return {
      enabled: !!verified,
      factorId: verified?.id ?? null,
      verifiedSession: current === 'aal2',
      needsCode: !!verified && current !== 'aal2',
    };
  }

  /** Empieza a activar la 2FA: devuelve el QR y la clave para la app autenticadora. */
  async startEnrollment(): Promise<TotpEnrollment> {
    const client = await this.auth.supabase();
    // Si quedó un intento sin terminar, se borra para empezar limpio.
    const existing = await client.auth.mfa.listFactors();
    for (const factor of existing.data?.all ?? []) {
      if (factor.factor_type === 'totp' && factor.status !== 'verified') await client.auth.mfa.unenroll({ factorId: factor.id });
    }
    const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `ConectaRD ${new Date().toISOString().slice(0, 10)}` });
    if (error) throw error;
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  }

  /** Confirma un código de 6 dígitos (para terminar de activarla o para pasar el segundo paso al entrar). */
  async verifyCode(factorId: string, code: string): Promise<void> {
    const client = await this.auth.supabase();
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) throw new Error('Escribe los 6 dígitos del código.');
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: clean });
    if (error) throw error;
  }

  /** Desactiva la 2FA (Supabase exige que esta sesión ya esté verificada con el código). */
  async disable(factorId: string): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    // La sesión vuelve a un nivel sin 2FA.
    await client.auth.refreshSession();
  }
}
