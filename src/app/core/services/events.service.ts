import { Injectable, inject } from '@angular/core';
import type { CommunityEvent, EventInput, EventRosterEntry, EventStatus } from '../models/community.model';
import { AuthService } from './auth.service';

/** Jornadas comunitarias (RF-27) y pase de lista con código QR (RF-28). */
@Injectable({ providedIn: 'root' })
export class EventsService {
  private readonly auth = inject(AuthService);

  /** Próximas jornadas (o las pasadas, con `past`; o todas las mías, con `mine`). */
  async list(options: { past?: boolean; province?: string | null; mine?: boolean } = {}): Promise<CommunityEvent[]> {
    const client = await this.auth.supabase();
    const now = new Date().toISOString();
    let query = client.from('public_events').select('*');
    // "Las mías" incluye las pasadas (para ver a cuáles asistí).
    if (!options.mine) query = options.past ? query.lt('ends_at', now) : query.gte('ends_at', now);
    if (options.province) query = query.eq('province', options.province);
    if (options.mine) query = query.or('is_organizer.eq.true,is_registered.eq.true');
    const { data, error } = await query.order('starts_at', { ascending: !options.past }).limit(100);
    if (error) throw error;
    return (data ?? []) as CommunityEvent[];
  }

  async get(id: string): Promise<CommunityEvent | null> {
    const client = await this.auth.supabase();
    const { data, error } = await client.from('public_events').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as CommunityEvent | null;
  }

  /** Jornadas que atienden un reporte. */
  async listForReport(reportId: string): Promise<CommunityEvent[]> {
    const client = await this.auth.supabase();
    const { data: links, error } = await client.from('event_reports').select('event_id').eq('report_id', reportId);
    if (error) throw error;
    const ids = (links ?? []).map((link) => (link as { event_id: string }).event_id);
    if (!ids.length) return [];
    const { data, error: eventsError } = await client.from('public_events').select('*').in('id', ids).order('starts_at', { ascending: false });
    if (eventsError) throw eventsError;
    return (data ?? []) as CommunityEvent[];
  }

  /** Ids de los reportes que atiende una jornada. */
  async reportIds(eventId: string): Promise<string[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client.from('event_reports').select('report_id').eq('event_id', eventId);
    if (error) throw error;
    return (data ?? []).map((link) => (link as { report_id: string }).report_id);
  }

  async create(input: EventInput, reportIds: string[]): Promise<string> {
    const client = await this.auth.supabase();
    const { data, error } = await client.from('community_events').insert(clean(input)).select('id').single();
    if (error) throw error;
    const id = (data as { id: string }).id;
    await this.setReports(id, reportIds, []);
    return id;
  }

  async update(id: string, input: EventInput, reportIds: string[], previousReportIds: string[]): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.from('community_events').update(clean(input)).eq('id', id);
    if (error) throw error;
    await this.setReports(id, reportIds, previousReportIds);
  }

  async setStatus(id: string, status: EventStatus): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.from('community_events').update({ status }).eq('id', id);
    if (error) throw error;
  }

  /** Inscribirse o cancelar la inscripción. Devuelve true si quedó inscrito. */
  async toggleRegistration(id: string): Promise<boolean> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('toggle_event_registration', { target_event: id });
    if (error) throw error;
    return data as boolean;
  }

  /** El voluntario confirma su asistencia con el código del QR. */
  async checkIn(id: string, code: string): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('check_in_event', { target_event: id, code });
    if (error) throw error;
  }

  /** Código del QR (solo quien organiza). `regenerate` invalida el anterior. */
  async checkinCode(id: string, regenerate = false): Promise<string> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('event_checkin_code', { target_event: id, regenerate });
    if (error) throw error;
    return data as string;
  }

  async roster(id: string): Promise<EventRosterEntry[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client.rpc('event_roster', { target_event: id });
    if (error) throw error;
    return (data ?? []) as EventRosterEntry[];
  }

  async setAttendance(id: string, userId: string, present: boolean): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('set_event_attendance', { target_event: id, attendee: userId, present });
    if (error) throw error;
  }

  private async setReports(eventId: string, next: string[], previous: string[]): Promise<void> {
    const client = await this.auth.supabase();
    const toAdd = next.filter((id) => !previous.includes(id));
    const toRemove = previous.filter((id) => !next.includes(id));
    if (toAdd.length) {
      const { error } = await client.from('event_reports').insert(toAdd.map((report_id) => ({ event_id: eventId, report_id })));
      if (error) throw error;
    }
    if (toRemove.length) {
      const { error } = await client.from('event_reports').delete().eq('event_id', eventId).in('report_id', toRemove);
      if (error) throw error;
    }
  }
}

function clean(input: EventInput): EventInput {
  const text = (value: string | null) => (value && value.trim() ? value.trim() : null);
  return {
    ...input,
    title: input.title.trim(),
    description: input.description.trim(),
    location_name: input.location_name.trim(),
    province: text(input.province),
    municipality: text(input.municipality),
  };
}
