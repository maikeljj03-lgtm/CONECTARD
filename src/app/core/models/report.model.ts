import type { ReportCategoryValue } from '../constants/catalogs';

/** Estados del ciclo de vida (RF-16). Coinciden con el CHECK de public.reports. */
export type ReportStatus = 'reportado' | 'en_revision' | 'en_proceso' | 'resuelto' | 'rechazado';

/** Datos para crear un reporte. */
export interface NewReport {
  title: string;
  description: string;
  category: ReportCategoryValue;
  latitude: number;
  longitude: number;
  address: string | null;
  province: string | null;
  municipality: string | null;
  sector: string | null;
  is_anonymous: boolean;
}

/** Fila de la tabla reports (solo la ven el autor y los administradores). */
export interface MyReport extends NewReport {
  id: string;
  author_id: string;
  status: ReportStatus;
  created_at: string;
}

/** Fila de la vista public_reports: nunca incluye author_id; author_name es null si es anónimo. */
export interface PublicReport extends Omit<NewReport, 'is_anonymous'> {
  id: string;
  status: ReportStatus;
  is_anonymous: boolean;
  author_name: string | null;
  author_avatar_url: string | null;
  /** Ruta de la primera foto en el almacenamiento report-media (null si no tiene). */
  cover_path?: string | null;
  media_count?: number;
  created_at: string;
}

/** Foto o video de un reporte (tabla report_media). */
export interface ReportMedia {
  id: string;
  report_id: string;
  path: string;
  kind: 'image' | 'video';
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  position: number;
  created_at: string;
}

/** Filtros del listado y del mapa (RF-20, RF-22). */
export interface PublicReportFilters {
  category?: string | null;
  status?: ReportStatus | null;
  province?: string | null;
  municipality?: string | null;
  /** Fecha ISO: solo reportes desde esa fecha. */
  since?: string | null;
  search?: string | null;
  limit?: number;
}
