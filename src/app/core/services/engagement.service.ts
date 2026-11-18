import { Injectable, inject } from '@angular/core';
import type {
  FlagQueueItem, FlagReason, FlagTarget, Progress, RankingAudience, RankingPeriod, RankingRow,
} from '../models/engagement.model';
import { AuthService } from './auth.service';

/** Gamificación (RF-37, RF-38), denuncias (RF-32) y preferencias del usuario. */
@Injectable({ providedIn: 'root' })
export class EngagementService {
  private readonly auth = inject(AuthService);

  async myProgress(): Promise<Progress> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('my_progress');
    if (error) throw error;
    return data as Progress;
  }

  async leaderboard(period: RankingPeriod, audience: RankingAudience, province: string | null, limit = 50): Promise<RankingRow[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('leaderboard', { period, audience, only_province: province || null, max_rows: limit });
    if (error) throw error;
    return (data ?? []) as RankingRow[];
  }

  /** Denunciar un reporte, un comentario o una jornada. */
  async flag(kind: FlagTarget, targetId: string, reason: FlagReason, details: string | null): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('flag_content', {
      kind,
      target: targetId,
      flag_reason: reason,
      flag_details: details?.trim() || null,
    });
    if (error) throw error;
  }

  async flagQueue(status: 'pendiente' | 'atendida' | 'descartada' = 'pendiente'): Promise<FlagQueueItem[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('admin_flag_queue', { only_status: status });
    if (error) throw error;
    return (data ?? []) as FlagQueueItem[];
  }

  /** accept = true retira el contenido (y exige motivo); false descarta las denuncias. */
  async resolveFlags(kind: FlagTarget, targetId: string, accept: boolean, note: string | null): Promise<number> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('resolve_flags', { kind, target: targetId, accept, note: note?.trim() || null });
    if (error) throw error;
    return data as number;
  }

  /** Preferencias: aparecer en el ranking y recibir el resumen semanal por correo. */
  async updatePreferences(changes: { show_in_ranking?: boolean; weekly_digest?: boolean }): Promise<void> {
    const client = await this.auth.supabase();
    const user = await this.auth.getCurrentUser();
    if (!user) throw new Error('Inicia sesión para cambiar tus preferencias.');
    const { error } = await client.from('profiles').update(changes).eq('id', user.id);
    if (error) throw error;
  }
}
