import { Injectable, inject } from '@angular/core';
import type { ResourceDonation, ResourceRequest, ResourceStatus, ResourceUsage } from '../models/community.model';
import type { ProcessedMedia } from '../utils/media';
import { AuthService } from './auth.service';

const BUCKET = 'report-media';

/** Insumos que pide una organización o institución (RF-29) y su registro público (RF-30). */
@Injectable({ providedIn: 'root' })
export class ResourcesService {
  private readonly auth = inject(AuthService);

  async listForReport(reportId: string): Promise<ResourceRequest[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client
      .from('public_resource_requests')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as ResourceRequest[]).map((row) => ({ ...row, quantity: Number(row.quantity), received: Number(row.received), used: Number(row.used) }));
  }

  async listDonations(requestIds: string[]): Promise<ResourceDonation[]> {
    if (!requestIds.length) return [];
    const client = await this.auth.supabase();
    const { data, error } = await client
      .from('resource_donations')
      .select('id, request_id, donor_name, quantity, note, received_on, created_at')
      .in('request_id', requestIds)
      .order('received_on', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as ResourceDonation[]).map((row) => ({ ...row, quantity: Number(row.quantity) }));
  }

  async listUsages(requestIds: string[]): Promise<ResourceUsage[]> {
    if (!requestIds.length) return [];
    const client = await this.auth.supabase();
    const { data, error } = await client
      .from('resource_usages')
      .select('id, request_id, quantity, description, used_on, photo_path, created_at')
      .in('request_id', requestIds)
      .order('used_on', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as ResourceUsage[]).map((row) => ({ ...row, quantity: Number(row.quantity) }));
  }

  async createRequest(reportId: string, input: { item: string; quantity: number; unit: string; description: string | null }): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.from('resource_requests').insert({
      report_id: reportId,
      item: input.item.trim(),
      quantity: input.quantity,
      unit: input.unit.trim(),
      description: input.description?.trim() || null,
    });
    if (error) throw error;
  }

  async setRequestStatus(requestId: string, status: ResourceStatus): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.from('resource_requests').update({ status }).eq('id', requestId);
    if (error) throw error;
  }

  async addDonation(requestId: string, input: { donor_name: string | null; quantity: number; note: string | null; received_on: string }): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.from('resource_donations').insert({
      request_id: requestId,
      donor_name: input.donor_name?.trim() || null,
      quantity: input.quantity,
      note: input.note?.trim() || null,
      received_on: input.received_on,
    });
    if (error) throw error;
  }

  /** Registra un uso; si trae foto, la sube a report-media/<reporte>/insumos/. */
  async addUsage(
    reportId: string,
    requestId: string,
    input: { quantity: number; description: string; used_on: string },
    photo: ProcessedMedia | null,
  ): Promise<void> {
    const client = await this.auth.supabase();
    let photoPath: string | null = null;
    if (photo) {
      photoPath = `${reportId}/insumos/${crypto.randomUUID()}.${photo.extension}`;
      const { error } = await client.storage.from(BUCKET).upload(photoPath, photo.blob, { contentType: photo.mimeType, upsert: false, cacheControl: '31536000' });
      if (error) throw error;
    }
    const { error } = await client.from('resource_usages').insert({
      request_id: requestId,
      quantity: input.quantity,
      description: input.description.trim(),
      used_on: input.used_on,
      photo_path: photoPath,
    });
    if (error) {
      if (photoPath) await client.storage.from(BUCKET).remove([photoPath]);
      throw error;
    }
  }
}

/** Avance de una solicitud: porcentaje recibido y usado (0 a 100). */
export function resourceProgress(request: Pick<ResourceRequest, 'quantity' | 'received' | 'used'>): { received: number; used: number } {
  const total = request.quantity > 0 ? request.quantity : 1;
  const pct = (value: number) => Math.max(0, Math.min(100, Math.round((value / total) * 100)));
  return { received: pct(request.received), used: pct(request.used) };
}
