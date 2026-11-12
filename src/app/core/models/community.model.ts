import type { UserRole } from './profile.model';

// Módulo 4: comunidad (RF-24 a RF-30). Filas de las vistas públicas de Supabase.

/** Comentario de un reporte (vista public_report_comments). Nunca revela al autor de un reporte anónimo. */
export interface ReportComment {
  id: string;
  report_id: string;
  parent_id: string | null;
  /** null si fue eliminado. */
  body: string | null;
  is_deleted: boolean;
  /** Lo escribió quien hizo el reporte. */
  is_report_author: boolean;
  author_name: string | null;
  author_avatar_url: string | null;
  author_role: UserRole | null;
  is_mine: boolean | null;
  created_at: string;
  edited_at: string | null;
}

/** Hilo: un comentario con sus respuestas. */
export interface CommentThread extends ReportComment {
  replies: ReportComment[];
}

/** Persona u organización que se sumó a un reporte (RF-26). */
export interface ReportVolunteer {
  report_id: string;
  name: string | null;
  avatar_url: string | null;
  role: UserRole;
  is_mine: boolean | null;
  created_at: string;
}

export type EventStatus = 'programado' | 'cancelado' | 'finalizado';

/** Jornada comunitaria (vista public_events, RF-27). Sin el código del QR. */
export interface CommunityEvent {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  location_name: string;
  province: string | null;
  municipality: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity: number | null;
  status: EventStatus;
  organizer_name: string | null;
  organizer_avatar_url: string | null;
  organizer_role: UserRole;
  attendee_count: number;
  checked_in_count: number;
  report_count: number;
  is_organizer: boolean | null;
  is_registered: boolean | null;
  has_checked_in: boolean | null;
  created_at: string;
}

/** Datos para crear o editar una jornada. */
export interface EventInput {
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  location_name: string;
  province: string | null;
  municipality: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity: number | null;
}

/** Inscrito en una jornada (solo lo ve quien la organiza, RF-28). */
export interface EventRosterEntry {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
  role: UserRole;
  registered_at: string;
  checked_in_at: string | null;
}

export type ResourceStatus = 'abierta' | 'cerrada' | 'cancelada';

/** Solicitud de insumos (vista public_resource_requests, RF-29). */
export interface ResourceRequest {
  id: string;
  report_id: string;
  item: string;
  quantity: number;
  unit: string;
  description: string | null;
  status: ResourceStatus;
  requester_name: string | null;
  requester_role: UserRole;
  received: number;
  used: number;
  is_mine: boolean | null;
  created_at: string;
}

/** Donación recibida (RF-30). */
export interface ResourceDonation {
  id: string;
  request_id: string;
  donor_name: string | null;
  quantity: number;
  note: string | null;
  received_on: string;
  created_at: string;
}

/** Uso registrado de lo recibido (RF-30). */
export interface ResourceUsage {
  id: string;
  request_id: string;
  quantity: number;
  description: string;
  used_on: string;
  photo_path: string | null;
  created_at: string;
}
