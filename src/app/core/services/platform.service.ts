import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';

/** Alerta por radio de distancia (RF-61). La ubicación se guarda cifrada en la base de datos. */
export interface AlertSubscription {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  radius_m: AlertRadius;
  categories: string[] | null;
  active: boolean;
  created_at: string;
}

export type AlertRadius = 500 | 1000 | 2000 | 5000 | 10000;
export const ALERT_RADII: AlertRadius[] = [500, 1000, 2000, 5000, 10000];
export const MAX_ALERTS = 5;

/** Constancia de voluntariado (RF-62). */
export interface Certificate {
  id?: string;
  code: string;
  full_name: string;
  hours: number;
  events: number;
  reports_helped: number;
  first_activity: string | null;
  last_activity: string | null;
  issued_at: string;
}

/** Estadísticas abiertas (RF-57). */
export interface PublicStats {
  generated_at: string;
  reports_total: number;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
  by_province: Record<string, number>;
  resolved_last_30_days: number;
  median_resolution_hours: number | null;
  average_satisfaction: number | null;
  sensor_reports: number;
}

/** Funciones del módulo 8 para la persona: alertas, constancias, encuestas y datos abiertos. */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  private readonly auth = inject(AuthService);

  // ---------- RF-61: alertas ----------

  async myAlerts(): Promise<AlertSubscription[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('my_alert_subscriptions');
    if (error) throw error;
    return (data ?? []) as AlertSubscription[];
  }

  async saveAlert(alert: { id: string | null; label: string; latitude: number; longitude: number; radius_m: AlertRadius; categories: string[]; active: boolean }): Promise<string> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('save_alert_subscription', {
      subscription_id: alert.id,
      alert_label: alert.label.trim(),
      lat: alert.latitude,
      lon: alert.longitude,
      radius: alert.radius_m,
      alert_categories: alert.categories.length ? alert.categories : null,
      is_active: alert.active,
    });
    if (error) throw error;
    return data as string;
  }

  async deleteAlert(id: string): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('delete_alert_subscription', { subscription_id: id });
    if (error) throw error;
  }

  // ---------- RF-62: constancias ----------

  async issueCertificate(): Promise<Certificate> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('issue_volunteer_certificate');
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as Certificate;
    return { ...row, hours: Number(row.hours) };
  }

  async verifyCertificate(code: string): Promise<Certificate | null> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('verify_certificate', { certificate_code: code.trim() });
    if (error) throw error;
    const row = (data ?? [])[0] as Certificate | undefined;
    return row ? { ...row, hours: Number(row.hours) } : null;
  }

  // ---------- RF-63: encuesta ----------

  async mySurvey(reportId: string): Promise<{ rating: number; solved: boolean; comment: string | null; created_at: string } | null> {
    const client = await this.auth.supabase();
    const { data, error } = await client.from('report_surveys').select('rating, solved, comment, created_at').eq('report_id', reportId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async submitSurvey(reportId: string, rating: number, solved: boolean, comment: string): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('submit_report_survey', {
      target_report: reportId,
      survey_rating: rating,
      was_solved: solved,
      survey_comment: comment.trim() || null,
    });
    if (error) throw error;
  }

  // ---------- RF-57: datos abiertos ----------

  async publicStats(): Promise<PublicStats> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('public_stats');
    if (error) throw error;
    return data as PublicStats;
  }
}
