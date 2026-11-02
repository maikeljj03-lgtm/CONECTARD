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

  private getClient(): Promise<SupabaseClient> {
    this.clientPromise ??= this.loadClient();
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

    return createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        flowType: 'pkce',
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }

  async signIn(email: string, password: string) {
    const client = await this.getClient();
    return client.auth.signInWithPassword({ email, password });
  }

  async signInWithGoogle() {
    const client = await this.getClient();
    return client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/home` },
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
    return client.auth.resetPasswordForEmail(email, {
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
