import { Injectable } from '@angular/core';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

interface SupabaseRuntimeConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  signupOtpEnabled?: boolean;
}

export interface SignUpProfile {
  fullName: string;
  requestedRole: 'citizen' | 'volunteer' | 'organization' | 'institution';
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private clientPromise?: Promise<SupabaseClient>;
  private currentUserCache: User | null = null;
  private hasCurrentUserCache = false;
  private signupOtpEnabled = false;
  private supabaseUrl = '';
  private supabasePublishableKey = '';

  private readonly fetchWithTimeout: typeof fetch = async (input, init = {}) => {
    const controller = new AbortController();
    const sourceSignal = init.signal;
    const relayAbort = () => controller.abort(sourceSignal?.reason);
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

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

  async initialize(): Promise<void> {
    const client = await this.getClient();
    await client.auth.getSession();
  }

  async signIn(email: string, password: string) {
    const client = await this.getClient();
    return client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  }

  async validatePasswordAndSendLoginOtp(email: string, password: string) {
    const client = await this.getClient();
    // Validate in a non-persistent client: a session is created only after OTP verification.
    const passwordClient = createClient(this.supabaseUrl, this.supabasePublishableKey, {
      global: { fetch: this.fetchWithTimeout },
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const { error: passwordError } = await passwordClient.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (passwordError) return { error: passwordError };
    await passwordClient.auth.signOut({ scope: 'local' });
    return client.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/login`,
      },
    });
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

  async signInWithGoogle(forRegistration = false) {
    const client = await this.getClient();
    return client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: new URL(forRegistration ? '/auth/login' : '/landing', window.location.origin).toString(),
        queryParams: { prompt: 'select_account' },
      },
    });
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
