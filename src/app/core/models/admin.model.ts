import type { RequestedRole, UserRole, VerificationStatus } from './profile.model';
import type { ReportStatus } from './report.model';

// Consola de administración (RF-39 a RF-43, RF-52).

/** Fila de admin_users_page(). */
export interface AdminUserRow {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: UserRole;
  requested_role: RequestedRole;
  verification_status: VerificationStatus;
  province: string | null;
  is_blocked: boolean;
  reports_count: number;
  points: number;
  created_at: string;
  last_sign_in_at: string | null;
  total_count: number;
}

export type UserStateFilter = '' | 'activos' | 'bloqueados' | 'pendientes';
export type UserSort = 'recientes' | 'nombre' | 'puntos' | 'reportes' | 'actividad';

/** Resultado de admin_user_detail(). */
export interface AdminUserDetail {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: UserRole;
  requested_role: RequestedRole;
  verification_status: VerificationStatus;
  province: string | null;
  municipality: string | null;
  sector: string | null;
  bio: string | null;
  is_blocked: boolean;
  blocked_reason: string | null;
  blocked_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  stats: {
    reports: number;
    resolved: number;
    rejected: number;
    comments: number;
    supports: number;
    events_attended: number;
    points: number;
    flags_received: number;
    flags_made: number;
  };
  recent_reports: { id: string; title: string; status: ReportStatus; is_anonymous: boolean; created_at: string }[];
}

/** Fila de admin_reports_page() (incluye al autor real de los anónimos). */
export interface AdminReportRow {
  id: string;
  title: string;
  category: string;
  status: ReportStatus;
  province: string | null;
  municipality: string | null;
  sector: string | null;
  is_anonymous: boolean;
  author_id: string;
  author_name: string | null;
  author_email: string;
  support_count: number;
  comment_count: number;
  pending_flags: number;
  created_at: string;
  status_updated_at: string;
  total_count: number;
}

export type AuditAction =
  | 'cambiar_rol' | 'bloquear' | 'desbloquear' | 'revisar_verificacion' | 'revisar_voluntario'
  | 'estado_reporte' | 'eliminar_comentario' | 'resolver_denuncias' | 'cancelar_jornada';

export const AUDIT_LABELS: Record<AuditAction, string> = {
  cambiar_rol: 'Cambió el rol',
  bloquear: 'Bloqueó una cuenta',
  desbloquear: 'Desbloqueó una cuenta',
  revisar_verificacion: 'Revisó una verificación',
  revisar_voluntario: 'Revisó un voluntariado',
  estado_reporte: 'Cambió el estado de un reporte',
  eliminar_comentario: 'Eliminó un comentario',
  resolver_denuncias: 'Resolvió denuncias',
  cancelar_jornada: 'Canceló una jornada',
};

export const AUDIT_ICONS: Record<AuditAction, string> = {
  cambiar_rol: 'user',
  bloquear: 'lock',
  desbloquear: 'shield-check',
  revisar_verificacion: 'landmark',
  revisar_voluntario: 'heart',
  estado_reporte: 'history',
  eliminar_comentario: 'message',
  resolver_denuncias: 'flag',
  cancelar_jornada: 'calendar',
};

/** Fila de admin_audit_entries(). */
export interface AuditEntry {
  id: number;
  actor_name: string;
  action: AuditAction;
  target_type: 'usuario' | 'reporte' | 'comentario' | 'verificacion' | 'jornada' | 'denuncia';
  target_id: string | null;
  target_label: string | null;
  details: Record<string, unknown>;
  created_at: string;
  total_count: number;
}

/** Resultado de admin_dashboard(). */
export interface AdminDashboard {
  users: {
    total: number;
    new_7d: number;
    new_30d: number;
    blocked: number;
    by_role: Partial<Record<UserRole, number>>;
    active_volunteers_30d: number;
  };
  reports: {
    total: number;
    new_7d: number;
    by_status: Partial<Record<ReportStatus, number>>;
    by_category: { category: string; n: number }[];
    top_provinces: { province: string; n: number; resolved: number }[];
    daily: { day: string; created: number; resolved: number }[];
    avg_resolution_hours: number | null;
    median_resolution_hours: number | null;
    anonymous_share: number;
  };
  queues: { verifications: number; volunteers: number; flags: number; stale_reports: number };
  community: { comments_7d: number; supports_7d: number; events_upcoming: number; attendances_30d: number };
  sla: { institution: string; province: string | null; reports: number; resolved: number; first_response_hours: number | null; resolution_hours: number | null }[];
  recent_audit: { actor_name: string; action: AuditAction; target_type: string; target_label: string | null; details: Record<string, unknown>; created_at: string }[];
}

/** "3 h", "2.5 días"… para tiempos de respuesta. */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(Number(hours))) return '—';
  const h = Number(hours);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} días`;
}
