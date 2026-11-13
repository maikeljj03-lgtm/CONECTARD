import { Injectable } from '@angular/core';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { SocialProvider } from '../constants/social-providers';
import type { RequestedRole } from '../models/profile.model';

/** Correo que está esperando el código de acceso (lo leen el guard y la pantalla del código). */
export const PENDING_LOGIN_EMAIL = 'conectard.pending-login-email';

/** Dispositivos donde cada cuenta ya confirmó un código: userId → fecha de vencimiento (ms). */
const TRUSTED_DEVICES_KEY = 'conectard.trusted-devices';
const TRUST_DAYS = 90;

interface SupabaseRuntimeConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  signupOtpEnabled?: boolean;
}

/** Respuesta pública de GET /auth/v1/settings (solo lo que usamos). */
interface AuthSettings {
  external?: Record<string, boolean>;
}

export interface SignUpProfile {
  fullName: string;
  requestedRole: RequestedRole;
  /** Fecha ISO en que aceptó términos y privacidad (RF-50). */
  termsAcceptedAt: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private clientPromise?: Promise<SupabaseClient>;
  private passwordClient?: SupabaseClient;
  private currentUserCache: User | null = null;
  private hasCurrentUserCache = false;
  private signupOtpEnabled = false;
  private supabaseUrl = '';
  private supabasePublishableKey = '';
  private enabledProvidersPromise?: Promise<Set<string> | null>;

  private readonly fetchWithTimeout: typeof fetch = async (input, init = {}) => {
    const controller = new AbortController();
    const sourceSignal = init.signal;
    const relayAbort = () => controller.abort(sourceSignal?.reason);
    const requestUrl = input instanceof Request ? input.url : String(input);
    // Videos/fotos pueden tardar más que las peticiones normales; no abortar
    // una subida de 20 MB después del límite de 10 s usado para APIs pequeñas.
    const isStorageUpload = /\/storage\/v1\/object\//i.test(requestUrl);
    const timeoutId = setTimeout(() => controller.abort(new DOMException(
      isStorageUpload ? 'La subida del archivo tardó demasiado.' : 'La solicitud tardó demasiado.',
      'TimeoutError',
    )), isStorageUpload ? 180_000 : 10_000);

    if (sourceSignal?.aborted) {
      relayAbort();
    } else {
      sourceSignal?.addEventListener('abort', relayAbort, { once: true });
    }

    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
      sourceSignal?.removeEventListener('abort', relayAbort);
    }
  };

  private getClient(): Promise<SupabaseClient> {
    this.clientPromise ??= this.loadClient().catch((error: unknown) => {
      this.clientPromise = undefined;
      throw error;
    });
    return this.clientPromise;
  }

  private async loadClient(): Promise<SupabaseClient> {
    const configUrl = new URL('assets/supabase-config.json', document.baseURI);
    const response = await this.fetchWithTimeout(configUrl);
    if (!response.ok) {
      throw new Error('No se pudo cargar la configuración de Supabase. Inicia la app con npm start.');
    }

    const config = (await response.json()) as SupabaseRuntimeConfig;
    if (!config.supabaseUrl || !config.supabasePublishableKey) {
      throw new Error('La configuración de Supabase está incompleta. Revisa el archivo .env.');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(config.supabaseUrl);
    } catch {
      throw new Error('La URL de Supabase no es válida. Revisa NEXT_PUBLIC_SUPABASE_URL.');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
      throw new Error('La URL de Supabase debe usar HTTP(S) y no incluir credenciales.');
    }
    if (/YOUR_PROJECT_REF|YOUR_SUPABASE_URL|example\.supabase\.co/i.test(config.supabaseUrl)
      || /REPLACE_WITH_YOUR_KEY|YOUR_SUPABASE_KEY|PUBLISHABLE_KEY_HERE/i.test(config.supabasePublishableKey)) {
      throw new Error('Supabase todavía tiene valores de ejemplo. Completa la URL y publishable key de tu proyecto.');
    }

    this.signupOtpEnabled = config.signupOtpEnabled === true;
    this.supabaseUrl = config.supabaseUrl;
    this.supabasePublishableKey = config.supabasePublishableKey;

    const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      global: { fetch: this.fetchWithTimeout },
      auth: {
        flowType: 'pkce',
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
    client.auth.onAuthStateChange((_event, session) => {
      this.currentUserCache = session?.user ?? null;
      this.hasCurrentUserCache = true;
    });
    return client;
  }

  /**
   * URL pública de un archivo de un bucket público, sin llamar a la red.
   * Devuelve null si la configuración aún no se cargó.
   */
  publicStorageUrl(bucket: string, path: string): string | null {
    if (!this.supabaseUrl) return null;
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `${this.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${encoded}`;
  }

  /** Cliente de Supabase compartido (para servicios de datos: perfiles, reportes, etc.). */
  supabase(): Promise<SupabaseClient> {
    return this.getClient();
  }

  async initialize(): Promise<void> {
    const client = await this.getClient();
    await client.auth.getSession();
  }

  async signIn(email: string, password: string) {
    const client = await this.getClient();
    return client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  }

  /**
   * Inicio de sesión con correo y contraseña.
   * - Dispositivo ya confirmado para esa cuenta: entra directo (needsOtp = false).
   * - Dispositivo nuevo: valida la contraseña y envía un código al correo (needsOtp = true).
   */
  async signInWithPasswordOnDevice(email: string, password: string): Promise<{ error: unknown; needsOtp: boolean }> {
    const client = await this.getClient();
    // Reuse an isolated, non-persistent client for password checks. Creating one
    // on every login attempt causes duplicate GoTrueClient instances in the tab.
    this.passwordClient ??= createClient(this.supabaseUrl, this.supabasePublishableKey, {
      global: { fetch: this.fetchWithTimeout },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
        storageKey: 'conectard-password-validation',
      },
    });
    const passwordClient = this.passwordClient;
    const normalized = email.trim().toLowerCase();
    const { data, error: passwordError } = await passwordClient.auth.signInWithPassword({ email: normalized, password });
    if (passwordError) return { error: passwordError, needsOtp: false };
    const userId = data.user?.id;
    await passwordClient.auth.signOut({ scope: 'local' });

    if (userId && this.isDeviceTrusted(userId)) {
      const { error } = await client.auth.signInWithPassword({ email: normalized, password });
      return { error, needsOtp: false };
    }
    const { error } = await this.sendLoginOtp(normalized);
    return { error, needsOtp: true };
  }

  /** Cierra la sesión local y envía un código para confirmar el dispositivo (p. ej. tras entrar con Google). */
  async startDeviceVerification(email: string) {
    const client = await this.getClient();
    await client.auth.signOut({ scope: 'local' });
    this.currentUserCache = null;
    this.hasCurrentUserCache = true;
    return this.sendLoginOtp(email.trim().toLowerCase());
  }

  private async sendLoginOtp(email: string) {
    const client = await this.getClient();
    return client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/login` },
    });
  }

  // ---------- Dispositivos de confianza ----------
  // Nota: es una comodidad de la interfaz, no un control del servidor. La verificación
  // en dos pasos real (RF-53, para administradores e instituciones) debe usar Supabase MFA.

  isDeviceTrusted(userId: string): boolean {
    const expiresAt = this.readTrustedDevices()[userId];
    return typeof expiresAt === 'number' && expiresAt > Date.now();
  }

  trustDevice(userId: string): void {
    const devices = this.readTrustedDevices();
    devices[userId] = Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000;
    try { localStorage.setItem(TRUSTED_DEVICES_KEY, JSON.stringify(devices)); } catch { /* almacenamiento no disponible */ }
  }

  private readTrustedDevices(): Record<string, number> {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(TRUSTED_DEVICES_KEY) ?? '{}');
      return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {};
    } catch {
      return {};
    }
  }

  async resendLoginOtp(email: string) {
    const client = await this.getClient();
    return client.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/login`,
      },
    });
  }

  async verifyLoginOtp(email: string, token: string) {
    const client = await this.getClient();
    return client.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'email',
    });
  }

  /** Registro / inicio de sesión con una red social (RF-01). Al volver, Supabase redirige a /landing. */
  async signInWithProvider(provider: SocialProvider) {
    const client = await this.getClient();
    return client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: new URL('/landing', window.location.origin).toString(),
        ...providerOptions(provider),
      },
    });
  }

  /**
   * Redes sociales activadas en el panel de Supabase (Authentication → Providers).
   * Devuelve null si no se pudo consultar; en ese caso la app muestra todas.
   */
  getEnabledProviders(): Promise<Set<string> | null> {
    this.enabledProvidersPromise ??= (async () => {
      try {
        await this.getClient();
        const response = await this.fetchWithTimeout(new URL('/auth/v1/settings', this.supabaseUrl), {
          headers: { apikey: this.supabasePublishableKey },
        });
        if (!response.ok) return null;
        const settings = (await response.json()) as AuthSettings;
        return new Set(Object.entries(settings.external ?? {}).filter(([, enabled]) => enabled).map(([name]) => name));
      } catch {
        return null;
      }
    })();
    return this.enabledProvidersPromise;
  }

  async signUp(email: string, password: string, profile: SignUpProfile) {
    const client = await this.getClient();
    return client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/login`,
        data: {
          full_name: profile.fullName,
          requested_role: profile.requestedRole,
          terms_accepted_at: profile.termsAcceptedAt,
        },
      },
    });
  }

  async isSignupOtpEnabled(): Promise<boolean> {
    await this.getClient();
    return this.signupOtpEnabled;
  }

  async verifySignupOtp(email: string, token: string) {
    const client = await this.getClient();
    return client.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'email',
    });
  }

  async resendSignupOtp(email: string) {
    const client = await this.getClient();
    return client.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/login` },
    });
  }

  async resendSignupConfirmation(email: string) {
    const client = await this.getClient();
    return client.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
    });
  }

  async sendPasswordReset(email: string) {
    const client = await this.getClient();
    return client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
  }

  async updatePassword(password: string) {
    const client = await this.getClient();
    return client.auth.updateUser({ password });
  }

  async getCurrentUser(): Promise<User | null> {
    if (this.hasCurrentUserCache) return this.currentUserCache;
    const client = await this.getClient();
    // The PKCE callback has already been validated by Supabase during
    // initialize(). Read that persisted session instead of issuing a second
    // network request to /auth/v1/user just to decide which screen to show.
    const { data, error } = await client.auth.getSession();
    if (error) return null;
    this.currentUserCache = data.session?.user ?? null;
    this.hasCurrentUserCache = true;
    return this.currentUserCache;
  }

  cacheAuthenticatedUser(user: User): void {
    this.currentUserCache = user;
    this.hasCurrentUserCache = true;
  }

  getCachedCurrentUser(): User | null {
    return this.hasCurrentUserCache ? this.currentUserCache : null;
  }

  async signOut(scope: 'global' | 'local' | 'others' = 'global') {
    const client = await this.getClient();
    const result = await client.auth.signOut({ scope });
    if (!result.error) {
      this.currentUserCache = null;
      this.hasCurrentUserCache = true;
    }
    return result;
  }
}

/** Opciones específicas de cada red social al iniciar el acceso. */
function providerOptions(provider: SocialProvider): { scopes?: string; queryParams?: Record<string, string> } {
  switch (provider) {
    case 'google':
      return { queryParams: { prompt: 'select_account' } }; // deja elegir la cuenta
    case 'azure':
      return { scopes: 'email' }; // el correo es necesario para crear el perfil
    default:
      return {}; // Apple y LinkedIn ya entregan lo necesario por defecto
  }
}
