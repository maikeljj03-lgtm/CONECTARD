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
  /** Fotos de evidencia de solución (RF-17). */
  evidence_count?: number;
  /** Fecha del último cambio de estado. */
  status_updated_at?: string;
  /** "Me afecta" (RF-24), comentarios (RF-25) y voluntarios sumados (RF-26). */
  support_count?: number;
  comment_count?: number;
  volunteer_count?: number;
  /** Solo con sesión: si la persona ya apoyó, se sumó o es la autora. */
  supported_by_me?: boolean | null;
  joined_by_me?: boolean | null;
  is_mine?: boolean | null;
  created_at: string;
  /** Institución responsable, asignada sola según zona y categoría (RF-42). */
  assigned_institution_name?: string | null;
  /** Solo para la institución asignada. */
  assigned_to_me?: boolean | null;
  /** Si la moderación lo unió a otro reporte igual, el id de ese reporte (RF-45). */
  merged_into?: string | null;
  /** RF-58: creado por una persona o por un sensor. */
  source?: 'ciudadano' | 'sensor';
  /** RF-59: tipo de terreno según el catastro cargado. */
  land_status?: 'publico' | 'privado' | 'protegido' | 'desconocido';
  /** RF-63: calificación que el autor dio a la solución (1-5). */
  survey_rating?: number | null;
}

/** Reporte parecido y cercano, sugerido antes de crear uno nuevo (RF-45). */
export interface SimilarReport {
  id: string;
  title: string;
  status: ReportStatus;
  category: string;
  sector: string | null;
  municipality: string | null;
  distance_m: number;
  similarity: number;
  support_count: number;
  cover_path: string | null;
  supported_by_me: boolean;
  is_mine: boolean;
  created_at: string;
}

/** Cambios que el autor puede hacer en su reporte (RF-15). */
export interface ReportEdit {
  title: string;
  description: string;
  category: ReportCategoryValue;
  address: string | null;
  sector: string | null;
  is_anonymous: boolean;
}

/** Fila de la vista public_report_history (RF-16). Nunca revela al autor. */
export interface ReportStatusChange {
  id: number;
  report_id: string;
  from_status: ReportStatus | null;
  to_status: ReportStatus;
  note: string | null;
  actor_role: 'institution' | 'administrator' | null;
  actor_name: string | null;
  created_at: string;
}

/** Foto de evidencia de solución, el "Después" (RF-17). */
export interface ReportEvidence {
  id: string;
  report_id: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
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
  /** RF-46: huella de la foto y si traía datos de cámara (los calcula el teléfono). */
  fingerprint?: string | null;
  camera_data?: boolean | null;
}

/** Filtros del listado y del mapa (RF-20, RF-22). */
export interface PublicReportFilters {
  category?: string | null;
  status?: ReportStatus | null;
  province?: string | null;
  municipality?: string | null;
  sector?: string | null;
  /** Fecha ISO: solo reportes desde esa fecha. */
  since?: string | null;
  /** Fecha ISO: solo reportes hasta esa fecha (incluida). */
  until?: string | null;
  search?: string | null;
  /** Orden: más recientes (por defecto) o más apoyados (RF-23). */
  sort?: 'recent' | 'support';
  limit?: number;
}
