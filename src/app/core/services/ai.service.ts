import { Injectable, inject } from '@angular/core';
import { FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import type { ReportCategoryValue } from '../constants/catalogs';
import { analysisCopy } from '../utils/media';
import { AuthService } from './auth.service';

/** Sugerencia a partir de la foto (RF-44). La persona decide si la usa. */
export interface PhotoSuggestion {
  isPublicProblem: boolean;
  category: ReportCategoryValue;
  categoryLabel: string;
  confidence: 'alta' | 'media' | 'baja';
  title: string;
  reason: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Error con un mensaje listo para mostrar. unavailable = la función no está activada en este proyecto. */
export class AiError extends Error {
  constructor(message: string, readonly unavailable = false) {
    super(message);
  }
}

/**
 * Inteligencia artificial de ConectaRD (RF-44 y RF-47). Llama a las funciones de Supabase
 * classify-report-photo usa Claude y assistant-chat usa Gemini, siempre desde funciones
 * de Supabase y con sus claves guardadas como secretos del servidor.
 * Si las funciones no están desplegadas o no tienen la clave, la app simplemente no muestra estas ayudas.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly auth = inject(AuthService);
  /** Se apaga después de saber que la función no está activada (para no intentarlo en cada foto). */
  private photoUnavailable = false;

  get photoSuggestionsEnabled(): boolean {
    return !this.photoUnavailable;
  }

  /** Sugiere categoría y título a partir de una foto ya comprimida. null si no hay sugerencia. */
  async suggestFromPhoto(image: Blob): Promise<PhotoSuggestion | null> {
    if (this.photoUnavailable) return null;
    const copy = await analysisCopy(image);
    try {
      const result = await this.invoke<{ suggestion: PhotoSuggestion | null }>('classify-report-photo', { image: copy.data, mediaType: copy.mediaType });
      return result.suggestion ?? null;
    } catch (error) {
      if (error instanceof AiError && error.unavailable) this.photoUnavailable = true;
      throw error;
    }
  }

  /** Envía la conversación al asistente y devuelve su respuesta. */
  async chat(messages: ChatTurn[]): Promise<{ reply: string; remaining: number | null }> {
    const result = await this.invoke<{ reply: string; remaining?: number }>('assistant-chat', { messages });
    return { reply: result.reply, remaining: typeof result.remaining === 'number' ? result.remaining : null };
  }

  private async invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const client = await this.auth.supabase();
    const { data, error } = await client.functions.invoke<T>(name, { body });
    if (!error && data) return data;
    if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
      const response = error.context instanceof Response ? error.context : undefined;
      const status = response?.status ?? 0;
      let message = '';
      try {
        const payload = (await response?.json()) as { error?: string; message?: string } | undefined;
        message = payload?.error ?? payload?.message ?? '';
      } catch {
        message = '';
      }
      // Supabase puede enviar el 404 desde el runtime de funciones o desde el relay.
      if (status === 404 || /requested function was not found/i.test(message)) {
        throw new AiError('El asistente aún no está publicado en Supabase. El administrador debe desplegar la función assistant-chat.', true);
      }
      // 503: falta configurar la clave del proveedor en los secretos del proyecto.
      if (status === 503 && /activad/i.test(message)) {
        throw new AiError('Esta ayuda todavía no está activada.', true);
      }
      throw new AiError(message || 'No se pudo completar ahora. Inténtalo de nuevo.');
    }
    // Sin conexión o la función no respondió: se puede volver a intentar más tarde.
    throw new AiError('No pudimos conectar con el servidor. Revisa tu conexión.');
  }
}
