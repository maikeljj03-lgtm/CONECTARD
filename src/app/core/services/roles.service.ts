import { Injectable, inject } from '@angular/core';
import { roleCan, type Permission } from '../constants/permissions';
import type { AdminUser, Profile, UserRole } from '../models/profile.model';
import { AuthService } from './auth.service';

/** Roles y permisos (RF-03): consultar el rol actual, solicitar voluntariado y administrar roles. */
@Injectable({ providedIn: 'root' })
export class RolesService {
  private readonly auth = inject(AuthService);
  /** Rol del usuario actual, guardado por id para no consultarlo en cada pantalla. */
  private cache: { userId: string; role: UserRole } | null = null;

  /** Rol de quien tiene la sesión iniciada, o null si no hay sesión. */
  async currentRole(refresh = false): Promise<UserRole | null> {
    const user = await this.auth.getCurrentUser();
    if (!user) {
      this.cache = null;
      return null;
    }
    if (!refresh && this.cache?.userId === user.id) return this.cache.role;
    const client = await this.auth.supabase();
    const { data, error } = await client.from('profiles').select('role').eq('id', user.id).single();
    if (error) throw error;
    this.cache = { userId: user.id, role: (data as { role: UserRole }).role };
    return this.cache.role;
  }

  async can(permission: Permission): Promise<boolean> {
    try {
      return roleCan(await this.currentRole(), permission);
    } catch {
      return false;
    }
  }

  clearCache(): void {
    this.cache = null;
  }

  // ---------- Usuario ----------

  /** Un ciudadano pide ser voluntario; queda pendiente de revisión. */
  async requestVolunteer(): Promise<Profile> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('request_volunteer_role');
    if (error) throw error;
    return data as Profile;
  }

  // ---------- Administrador ----------

  /** Ciudadanos que pidieron ser voluntarios y esperan revisión. */
  async listVolunteerRequests(): Promise<Profile[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('requested_role', 'volunteer')
      .eq('verification_status', 'pending')
      .eq('role', 'citizen')
      .order('updated_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Profile[];
  }

  async reviewVolunteer(userId: string, approve: boolean, notes: string): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('review_volunteer_request', {
      target_user: userId,
      approve,
      notes: notes.trim() || null,
    });
    if (error) throw error;
  }

  async listUsers(search: string, role: UserRole | ''): Promise<AdminUser[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('admin_list_users', {
      search: search.trim() || null,
      role_filter: role || null,
      max_rows: 200,
    });
    if (error) throw error;
    return (data ?? []) as AdminUser[];
  }

  async setUserRole(userId: string, role: UserRole, notes = ''): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('admin_set_user_role', {
      target_user: userId,
      new_role: role,
      notes: notes.trim() || null,
    });
    if (error) throw error;
  }
}
