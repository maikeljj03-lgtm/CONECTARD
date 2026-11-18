import { Injectable, inject } from '@angular/core';
import type {
  AdminDashboard, AdminReportRow, AdminUserDetail, AdminUserRow, AuditAction, AuditEntry, UserSort, UserStateFilter,
} from '../models/admin.model';
import type { UserRole } from '../models/profile.model';
import type { ReportStatus } from '../models/report.model';
import { AuthService } from './auth.service';

/** Consola de administración: métricas, usuarios, reportes, bloqueo y auditoría (RF-39 a RF-43, RF-52). */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly auth = inject(AuthService);

  async dashboard(): Promise<AdminDashboard> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('admin_dashboard');
    if (error) throw error;
    return data as AdminDashboard;
  }

  async users(options: { search: string; role: UserRole | ''; state: UserStateFilter; sort: UserSort; limit: number; offset: number }): Promise<AdminUserRow[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('admin_users_page', {
      search: options.search.trim() || null,
      role_filter: options.role || null,
      state_filter: options.state || null,
      sort_by: options.sort,
      max_rows: options.limit,
      skip: options.offset,
    });
    if (error) throw error;
    return ((data ?? []) as AdminUserRow[]).map((row) => ({ ...row, total_count: Number(row.total_count) }));
  }

  async userDetail(id: string): Promise<AdminUserDetail> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('admin_user_detail', { target_user: id });
    if (error) throw error;
    return data as AdminUserDetail;
  }

  async setBlocked(id: string, block: boolean, reason: string | null): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('admin_set_user_block', { target_user: id, block, reason: reason?.trim() || null });
    if (error) throw error;
  }

  async setRole(id: string, role: UserRole, notes: string | null): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('admin_set_user_role', { target_user: id, new_role: role, notes: notes?.trim() || null });
    if (error) throw error;
  }

  async reports(options: {
    search: string; status: ReportStatus | ''; category: string; province: string; flaggedOnly: boolean; limit: number; offset: number;
  }): Promise<AdminReportRow[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('admin_reports_page', {
      search: options.search.trim() || null,
      status_filter: options.status || null,
      category_filter: options.category || null,
      province_filter: options.province || null,
      flagged_only: options.flaggedOnly,
      max_rows: options.limit,
      skip: options.offset,
    });
    if (error) throw error;
    return ((data ?? []) as AdminReportRow[]).map((row) => ({ ...row, total_count: Number(row.total_count) }));
  }

  async audit(options: { action: AuditAction | ''; target: string | null; limit: number; offset: number }): Promise<AuditEntry[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('admin_audit_entries', {
      only_action: options.action || null,
      target: options.target,
      max_rows: options.limit,
      skip: options.offset,
    });
    if (error) throw error;
    return ((data ?? []) as AuditEntry[]).map((row) => ({ ...row, total_count: Number(row.total_count) }));
  }

  /** ¿La cuenta actual está bloqueada? (para avisarle en la app). */
  async amIBlocked(): Promise<boolean> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('current_user_blocked');
    if (error) return false;
    return data === true;
  }
}
