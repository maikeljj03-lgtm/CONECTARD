import { Injectable, inject } from '@angular/core';
import type {
  AdminDashboard, AdminInstitution, AdminReportRow, AdminUserDetail, AdminUserRow, AssignmentFilter, AuditAction, AuditEntry,
  MediaFlag, UserSort, UserStateFilter,
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
    assignment?: AssignmentFilter; duplicatesOnly?: boolean; suspiciousOnly?: boolean;
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
      assignment_filter: options.assignment || null,
      duplicates_only: options.duplicatesOnly ?? false,
      suspicious_only: options.suspiciousOnly ?? false,
    });
    if (error) throw error;
    return ((data ?? []) as AdminReportRow[]).map((row) => ({ ...row, total_count: Number(row.total_count) }));
  }

  // ---------- RF-42: asignación a instituciones ----------

  async institutions(): Promise<AdminInstitution[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('admin_institutions');
    if (error) throw error;
    return (data ?? []) as AdminInstitution[];
  }

  /** Asigna a mano (institutionId) o devuelve a la asignación automática (null). Devuelve la institución final. */
  async assignReport(reportId: string, institutionId: string | null): Promise<string | null> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('admin_assign_report', { target_report: reportId, institution: institutionId });
    if (error) throw error;
    return (data as string | null) ?? null;
  }

  /** Zona y categorías de una institución (categorías vacías = todas). Devuelve sus reportes abiertos. */
  async setInstitutionScope(id: string, province: string, municipality: string | null, categories: string[]): Promise<number> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('admin_set_institution_scope', {
      target_user: id,
      new_province: province,
      new_municipality: municipality?.trim() || null,
      categories: categories.length ? categories : null,
    });
    if (error) throw error;
    return Number(data ?? 0);
  }

  // ---------- RF-45 y RF-46: duplicados y fotos sospechosas ----------

  /** Une el reporte con el original (merge) o descarta la marca de duplicado. */
  async resolveDuplicate(reportId: string, merge: boolean, intoReportId: string | null = null): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('admin_resolve_duplicate', { target_report: reportId, do_merge: merge, into_report: intoReportId });
    if (error) throw error;
  }

  async mediaFlags(reportId: string): Promise<MediaFlag[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client.from('media_flags').select('*').eq('report_id', reportId).order('created_at');
    if (error) throw error;
    const flags = (data ?? []) as MediaFlag[];
    const mediaIds = [...new Set(flags.flatMap((flag) => [flag.media_id, flag.matched_media_id]).filter((id): id is string => !!id))];
    const reportIds = [...new Set(flags.map((flag) => flag.matched_report_id).filter((id): id is string => !!id))];
    const [media, reports] = await Promise.all([
      mediaIds.length ? client.from('report_media').select('id, path').in('id', mediaIds) : Promise.resolve({ data: [], error: null }),
      reportIds.length ? client.from('public_reports').select('id, title').in('id', reportIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (media.error) throw media.error;
    if (reports.error) throw reports.error;
    const paths = new Map(((media.data ?? []) as { id: string; path: string }[]).map((row) => [row.id, row.path]));
    const titles = new Map(((reports.data ?? []) as { id: string; title: string }[]).map((row) => [row.id, row.title]));
    return flags.map((flag) => ({
      ...flag,
      media_path: paths.get(flag.media_id) ?? null,
      matched_path: flag.matched_media_id ? paths.get(flag.matched_media_id) ?? null : null,
      matched_report_title: flag.matched_report_id ? titles.get(flag.matched_report_id) ?? null : null,
    }));
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
