import { Injectable, inject } from '@angular/core';
import type { NewVerificationRequest, VerificationRequest, VerificationRequestWithProfile } from '../models/verification.model';
import { AuthService } from './auth.service';

const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTS = 5;

@Injectable({ providedIn: 'root' })
export class VerificationService {
  private readonly auth = inject(AuthService);

  validateDocument(file: File): string | null {
    if (!DOCUMENT_TYPES.includes(file.type)) return `“${file.name}” debe ser PDF, JPG, PNG o WebP.`;
    if (file.size > DOCUMENT_MAX_BYTES) return `“${file.name}” pesa más de 5 MB.`;
    return null;
  }

  async getMyRequests(): Promise<VerificationRequest[]> {
    const client = await this.auth.supabase();
    const user = await this.auth.getCurrentUser();
    if (!user) return [];
    const { data, error } = await client
      .from('verification_requests')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as VerificationRequest[];
  }

  /** Sube los documentos a verification-documents/<uid>/ y crea la solicitud. */
  async submit(request: NewVerificationRequest, files: File[]): Promise<VerificationRequest> {
    if (!files.length) throw new Error('Adjunta al menos un documento oficial.');
    if (files.length > MAX_DOCUMENTS) throw new Error(`Puedes adjuntar hasta ${MAX_DOCUMENTS} documentos.`);
    for (const file of files) {
      const problem = this.validateDocument(file);
      if (problem) throw new Error(problem);
    }

    const client = await this.auth.supabase();
    const user = await this.auth.getCurrentUser();
    if (!user) throw new Error('Inicia sesión para enviar la solicitud.');

    const stamp = Date.now();
    const paths: string[] = [];
    for (const [index, file] of files.entries()) {
      const safeName = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);
      const path = `${user.id}/${stamp}-${index}-${safeName}`;
      const { error } = await client.storage.from('verification-documents').upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        if (paths.length) await client.storage.from('verification-documents').remove(paths);
        throw error;
      }
      paths.push(path);
    }

    const { data, error } = await client
      .from('verification_requests')
      .insert({
        requested_role: request.requested_role,
        organization_name: request.organization_name.trim(),
        organization_type: request.organization_type,
        rnc: request.rnc?.replace(/\D/g, '') || null,
        contact_name: request.contact_name.trim(),
        contact_phone: request.contact_phone.trim(),
        coverage_area: request.coverage_area.trim(),
        document_paths: paths,
      })
      .select('*')
      .single();
    if (error) {
      await client.storage.from('verification-documents').remove(paths);
      throw error;
    }
    return data as VerificationRequest;
  }

  // ---------- Administración ----------
  async listForReview(status: 'pending' | 'approved' | 'rejected' = 'pending'): Promise<VerificationRequestWithProfile[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client
      .from('verification_requests')
      .select('*, profiles!verification_requests_user_id_fkey(full_name, avatar_url)')
      .eq('status', status)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as VerificationRequestWithProfile[];
  }

  /** Enlace temporal (5 min) para que el administrador abra un documento privado. */
  async documentUrl(path: string): Promise<string> {
    const client = await this.auth.supabase();
    const { data, error } = await client.storage.from('verification-documents').createSignedUrl(path, 300);
    if (error) throw error;
    return data.signedUrl;
  }

  async review(requestId: string, approve: boolean, notes: string): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('review_verification_request', {
      request_id: requestId,
      approve,
      notes: notes.trim() || null,
    });
    if (error) throw error;
  }
}
