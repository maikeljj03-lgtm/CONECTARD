import { Injectable, inject } from '@angular/core';
import type { ReportMedia } from '../models/report.model';
import { MEDIA_LIMITS, type ProcessedMedia } from '../utils/media';
import { AuthService } from './auth.service';

const BUCKET = 'report-media';

export interface MediaUploadResult {
  uploaded: ReportMedia[];
  /** Índices (según el orden recibido) de los archivos que no se pudieron subir. */
  failed: number[];
  /** Primer error, para mostrarlo al usuario. */
  firstError: unknown;
}

/** Fotos y videos de los reportes (RF-10, RF-11). */
@Injectable({ providedIn: 'root' })
export class ReportMediaService {
  private readonly auth = inject(AuthService);

  /**
   * Sube los archivos ya procesados a report-media/<reportId>/ y los registra.
   * Sigue con los demás si uno falla, para no perder todo por un archivo.
   */
  async upload(reportId: string, items: ProcessedMedia[], startPosition = 0): Promise<MediaUploadResult> {
    const client = await this.auth.supabase();
    const result: MediaUploadResult = { uploaded: [], failed: [], firstError: null };

    for (const [index, item] of items.entries()) {
      const position = startPosition + index;
      if (position >= MEDIA_LIMITS.maxItems) {
        result.failed.push(index);
        continue;
      }
      // Nombre aleatorio: no revela el nombre original del archivo ni quién lo subió.
      const path = `${reportId}/${position}-${crypto.randomUUID()}.${item.extension}`;
      try {
        const { error: uploadError } = await client.storage.from(BUCKET).upload(path, item.blob, {
          contentType: item.mimeType,
          upsert: false,
          cacheControl: '31536000',
        });
        if (uploadError) throw uploadError;

        const { data, error } = await client
          .from('report_media')
          .insert({
            report_id: reportId,
            path,
            kind: item.kind,
            mime_type: item.mimeType,
            size_bytes: item.blob.size,
            width: item.width,
            height: item.height,
            duration_seconds: item.durationSeconds,
            position,
          })
          .select('*')
          .single();
        if (error) {
          await client.storage.from(BUCKET).remove([path]);
          throw error;
        }
        result.uploaded.push(data as ReportMedia);
      } catch (error) {
        result.failed.push(index);
        result.firstError ??= error;
      }
    }
    return result;
  }

  async listForReport(reportId: string): Promise<ReportMedia[]> {
    const client = await this.auth.supabase();
    const { data, error } = await client
      .from('report_media')
      .select('*')
      .eq('report_id', reportId)
      .order('position', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ReportMedia[];
  }

  /** URL pública inmediata (para portadas en listas); null si aún no se cargó la configuración. */
  coverUrl(path: string | null | undefined): string | null {
    return path ? this.auth.publicStorageUrl(BUCKET, path) : null;
  }

  /** URL pública de un archivo (el bucket es público porque los reportes lo son). */
  async publicUrl(path: string): Promise<string> {
    const client = await this.auth.supabase();
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
}
