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
  created_at: string;
}
