import { Injectable, inject } from '@angular/core';
import { isInsideDominicanRepublic } from '../constants/geography';
import type { MyReport, NewReport, PublicReport, PublicReportFilters, ReportStatus } from '../models/report.model';
import { AuthService } from './auth.service';

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

  /** Cómo ve el público un reporte (sirve para comprobar el anonimato). */
  async getPublic(id: string): Promise<PublicReport | null> {
    const client = await this.auth.supabase();
    const { data, error } = await client.from('public_reports').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as PublicReport | null;
  }

  /** Reportes públicos con filtros (RF-20, RF-22). Nunca incluye el autor de un reporte anónimo. */
  async listPublic(filters: PublicReportFilters = {}): Promise<PublicReport[]> {
    const client = await this.auth.supabase();
    let query = client.from('public_reports').select('*');
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.province) query = query.eq('province', filters.province);
    if (filters.municipality) query = query.ilike('municipality', `%${escapeLike(filters.municipality)}%`);
    if (filters.since) query = query.gte('created_at', filters.since);
    const search = filters.search?.trim();
    if (search) {
      // Busca en título, descripción, sector, municipio y referencia (RF-22).
      const term = escapeLike(search).replace(/[,()]/g, ' ');
      query = query.or(['title', 'description', 'sector', 'municipality', 'address'].map((column) => `${column}.ilike.%${term}%`).join(','));
    }
    const { data, error } = await query.order('created_at', { ascending: false }).limit(filters.limit ?? 200);
    if (error) throw error;
    return (data ?? []) as PublicReport[];
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
