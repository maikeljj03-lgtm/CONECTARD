import { Injectable, inject } from '@angular/core';
import { isInsideDominicanRepublic } from '../constants/geography';
import type { MyReport, NewReport, PublicReport } from '../models/report.model';
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

  async listPublic(limit = 100): Promise<PublicReport[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client
      .from('public_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as PublicReport[];
  }
}
