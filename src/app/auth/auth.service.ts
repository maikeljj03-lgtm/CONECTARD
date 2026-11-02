import { Injectable } from '@angular/core';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

interface SupabaseRuntimeConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export interface SignUpProfile {
  fullName: string;
  requestedRole: 'citizen' | 'volunteer' | 'organization' | 'institution';
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private clientPromise?: Promise<SupabaseClient>;

  private readonly fetchWithTimeout: typeof fetch = async (input, init = {}) => {
    const controller = new AbortController();
    const sourceSignal = init.signal;
    const relayAbort = () => controller.abort(sourceSignal?.reason);
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

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
    const response = await fetch(configUrl);
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

    return createClient(config.supabaseUrl, config.supabasePublishableKey, {
      global: { fetch: this.fetchWithTimeout },
      auth: {
        flowType: 'pkce',
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }

  async initialize(): Promise<void> {
    await this.getClient();
  }

  async signIn(email: string, password: string) {
    const client = await this.getClient();
    return client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  }

  async signInWithGoogle() {
    const client = await this.getClient();
    return client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: new URL('/home', window.location.origin).toString(),
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
    const client = await this.getClient();
    const { data, error } = await client.auth.getUser();
    if (error) return null;
    return data.user;
  }

  async signOut() {
    const client = await this.getClient();
    return client.auth.signOut();
  }
}
