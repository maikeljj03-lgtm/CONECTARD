import { Injectable, inject } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { AuthService } from './auth.service';

export type ReportChangeKind = 'created' | 'updated' | 'deleted';

export interface ReportChange {
  id: string;
  change: ReportChangeKind;
}

export type LiveStatus = 'connecting' | 'live' | 'offline';

/** Nombre del canal y del evento; deben coincidir con notify_report_change en SQL. */
const CHANNEL = 'public-reports';
const EVENT = 'report_changed';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: ReportChangeKind[] = ['created', 'updated', 'deleted'];

/**
 * Avisos en vivo de reportes nuevos o cambiados (RF-18).
 * El aviso solo trae el id; quien lo recibe vuelve a leer el reporte desde la vista pública,
 * así nunca llega por aquí un dato que el público no deba ver.
 */
@Injectable({ providedIn: 'root' })
export class ReportsRealtimeService {
  private readonly auth = inject(AuthService);

  /** Se suscribe a los cambios. Devuelve la función para cancelar la suscripción. */
  async subscribe(onChange: (change: ReportChange) => void, onStatus: (status: LiveStatus) => void): Promise<() => void> {
    onStatus('connecting');
    const client = await this.auth.supabase();
    const channel: RealtimeChannel = client
      .channel(CHANNEL, { config: { private: false } })
      .on('broadcast', { event: EVENT }, ({ payload }) => {
        const change = parseChange(payload);
        if (change) onChange(change);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') onStatus('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus('offline');
      });
    return () => void client.removeChannel(channel);
  }
}

/** Acepta solo avisos con la forma esperada (id UUID y tipo de cambio conocido). */
export function parseChange(payload: unknown): ReportChange | null {
  const value = payload as { id?: unknown; change?: unknown } | null;
  if (!value || typeof value.id !== 'string' || !UUID.test(value.id)) return null;
  if (typeof value.change !== 'string' || !(KINDS as string[]).includes(value.change)) return null;
  return { id: value.id, change: value.change as ReportChangeKind };
}
