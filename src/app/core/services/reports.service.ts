import { Injectable, inject } from '@angular/core';
import { isInsideDominicanRepublic } from '../constants/geography';
import type {
  MyReport, NewReport, PublicReport, PublicReportFilters, ReportEdit, ReportStatus, ReportStatusChange,
} from '../models/report.model';
import { normalizeText } from '../utils/report-filters';
import { AuthService } from './auth.service';

/** Columnas de public_reports que usa la app (sin las columnas de búsqueda *_key). */
export const PUBLIC_REPORT_COLUMNS = [
  'id', 'title', 'description', 'category', 'latitude', 'longitude', 'address', 'province', 'municipality', 'sector',
  'status', 'is_anonymous', 'author_name', 'author_avatar_url', 'cover_path', 'media_count', 'evidence_count',
  'status_updated_at', 'support_count', 'comment_count', 'volunteer_count', 'supported_by_me', 'joined_by_me', 'is_mine',
  'created_at',
].join(',');

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly auth = inject(AuthService);

  async create(report: NewReport): Promise<MyReport> {
    if (!isInsideDominicanRepublic(report.latitude, report.longitude)) {
      throw new Error('La ubicación debe estar dentro de República Dominicana.');
    }
    const client = await this.auth.supabase();
    const clean = (value: string | null) => (value && value.trim() ? value.trim() : null);
    const { data, error } = await client
      .from('reports')
      .insert({
        title: report.title.trim(),
        description: report.description.trim(),
        category: report.category,
        latitude: Number(report.latitude.toFixed(6)),
        longitude: Number(report.longitude.toFixed(6)),
        address: clean(report.address),
        province: clean(report.province),
        municipality: clean(report.municipality),
        sector: clean(report.sector),
        is_anonymous: report.is_anonymous,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as MyReport;
  }

  async getMyReports(): Promise<MyReport[]> {
    const client = await this.auth.supabase();
    const user = await this.auth.getCurrentUser();
    if (!user) return [];
    const { data, error } = await client
      .from('reports')
      .select('*')
      .eq('author_id', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as MyReport[];
  }

  /** Un reporte propio (o cualquiera, si es administrador). */
  async getMine(id: string): Promise<MyReport | null> {
    const client = await this.auth.supabase();
    const { data, error } = await client.from('reports').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as MyReport | null;
  }

  /** RF-15: editar el reporte propio (solo dentro del período permitido; lo comprueba la base de datos). */
  async updateOwn(id: string, changes: ReportEdit): Promise<MyReport> {
    const client = await this.auth.supabase();
    const clean = (value: string | null) => (value && value.trim() ? value.trim() : null);
    const { data, error } = await client.rpc('update_own_report', {
      report_id: id,
      new_title: changes.title.trim(),
      new_description: changes.description.trim(),
      new_category: changes.category,
      new_address: clean(changes.address),
      new_sector: clean(changes.sector),
      new_is_anonymous: changes.is_anonymous,
    });
    if (error) throw error;
    return data as MyReport;
  }

  /** RF-15: eliminar el reporte propio. Las fotos se borran antes desde ReportMediaService. */
  async deleteOwn(id: string): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('delete_own_report', { report_id: id });
    if (error) throw error;
  }

  /** RF-16: historial de estados, del más antiguo al más reciente. */
  async getHistory(id: string): Promise<ReportStatusChange[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client
      .from('public_report_history')
      .select('*')
      .eq('report_id', id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ReportStatusChange[];
  }

  /** RF-16: cambiar el estado (institución de la jurisdicción o, para moderar, el administrador). */
  async setStatus(id: string, status: ReportStatus, note: string | null): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('set_report_status', {
      report_id: id,
      new_status: status,
      note: note?.trim() || null,
    });
    if (error) throw error;
  }

  /**
   * Reportes que puede gestionar una cuenta: los de la jurisdicción de la institución
   * (su provincia y, si la indicó, su municipio) o todos para el administrador.
   */
  async listManaged(scope: { province: string | null; municipality: string | null } | 'all', status?: ReportStatus | null): Promise<PublicReport[]> {
    const client = await this.auth.supabase();
    let query = client.from('public_reports').select(PUBLIC_REPORT_COLUMNS);
    if (scope !== 'all') {
      if (!scope.province) return [];
      query = query.eq('province', scope.province);
      const municipality = scope.municipality?.trim();
      // Igualdad sin distinguir mayúsculas, como hace la base de datos (can_manage_report).
      if (municipality) query = query.ilike('municipality', escapeLike(municipality));
    }
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(300);
    if (error) throw error;
    return (data ?? []) as unknown as PublicReport[];
  }

  /** Reportes a los que la persona se sumó (RF-26): la ONG los gestiona de forma limitada. */
  async listJoined(): Promise<PublicReport[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client
      .from('public_reports')
      .select(PUBLIC_REPORT_COLUMNS)
      .eq('joined_by_me', true)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw error;
    return (data ?? []) as unknown as PublicReport[];
  }

  /** Varios reportes tal como los ve el público (con portada, fotos y evidencia). */
  async listPublicByIds(ids: string[]): Promise<PublicReport[]> {
    if (!ids.length) return [];
    const client = await this.auth.supabase();
    const { data, error } = await client.from('public_reports').select(PUBLIC_REPORT_COLUMNS).in('id', ids);
    if (error) throw error;
    return (data ?? []) as unknown as PublicReport[];
  }

  /** Cómo ve el público un reporte (sirve para comprobar el anonimato). */
  async getPublic(id: string): Promise<PublicReport | null> {
    const client = await this.auth.supabase();
    const { data, error } = await client.from('public_reports').select(PUBLIC_REPORT_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw error;
    return data as unknown as PublicReport | null;
  }

  /** Reportes públicos con filtros (RF-20, RF-22). Nunca incluye el autor de un reporte anónimo. */
  async listPublic(filters: PublicReportFilters = {}): Promise<PublicReport[]> {
    const client = await this.auth.supabase();
    let query = client.from('public_reports').select(PUBLIC_REPORT_COLUMNS);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.province) query = query.eq('province', filters.province);
    // Municipio, sector y búsqueda: texto parcial sin distinguir tildes ni mayúsculas
    // (columnas *_key de la vista, normalizadas con unaccent).
    if (filters.municipality?.trim()) query = query.ilike('municipality_key', `%${escapeLike(normalizeText(filters.municipality))}%`);
    if (filters.sector?.trim()) query = query.ilike('sector_key', `%${escapeLike(normalizeText(filters.sector))}%`);
    if (filters.since) query = query.gte('created_at', filters.since);
    if (filters.until) query = query.lte('created_at', filters.until);
    const search = filters.search?.trim();
    if (search) query = query.ilike('search_key', `%${escapeLike(normalizeText(search))}%`);
    if (filters.sort === 'support') query = query.order('support_count', { ascending: false });
    const { data, error } = await query.order('created_at', { ascending: false }).limit(filters.limit ?? 200);
    if (error) throw error;
    return (data ?? []) as unknown as PublicReport[];
  }

  /** Cifras de la comunidad: total y por estado, opcionalmente por provincia. */
  async countByStatus(province?: string | null): Promise<Record<ReportStatus | 'total', number>> {
    const client = await this.auth.supabase();
    const statuses: ReportStatus[] = ['reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado'];
    const count = async (status?: ReportStatus) => {
      let query = client.from('public_reports').select('id', { count: 'exact', head: true });
      if (province) query = query.eq('province', province);
      if (status) query = query.eq('status', status);
      const { count: total, error } = await query;
      if (error) throw error;
      return total ?? 0;
    };
    const [total, ...byStatus] = await Promise.all([count(), ...statuses.map((status) => count(status))]);
    const result = { total } as Record<ReportStatus | 'total', number>;
    statuses.forEach((status, index) => (result[status] = byStatus[index]));
    return result;
  }
}

/** Escapa los comodines de LIKE para buscar el texto tal cual. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
