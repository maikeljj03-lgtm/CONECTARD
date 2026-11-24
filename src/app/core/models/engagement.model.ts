import type { UserRole } from './profile.model';

// Módulo 5: notificaciones (RF-34, RF-36), gamificación (RF-37, RF-38) y denuncias (RF-32).

export type NotificationKind =
  | 'estado' | 'comentario' | 'respuesta' | 'voluntario' | 'jornada' | 'jornada_cancelada'
  | 'verificacion' | 'rol' | 'medalla' | 'denuncia' | 'moderacion' | 'asignacion';

/** Fila de public.notifications (cada quien solo ve las suyas). */
export interface AppNotification {
  id: number;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** Ícono de cada tipo de notificación. */
export const NOTIFICATION_ICONS: Record<NotificationKind, string> = {
  estado: 'history',
  comentario: 'message',
  respuesta: 'message',
  voluntario: 'hand',
  jornada: 'calendar',
  jornada_cancelada: 'calendar',
  verificacion: 'shield-check',
  rol: 'user',
  medalla: 'sparkles',
  denuncia: 'alert',
  moderacion: 'shield',
  asignacion: 'inbox',
};

export type PointAction =
  | 'reporte' | 'reporte_resuelto' | 'apoyo' | 'comentario' | 'voluntariado' | 'asistencia' | 'jornada_organizada' | 'solucion';

/** Cómo se ganan los puntos (debe coincidir con los disparadores de la base de datos). */
export const POINT_RULES: { action: PointAction; points: number; label: string }[] = [
  { action: 'reporte', points: 10, label: 'Crear un reporte (se pierden si lo rechazan)' },
  { action: 'reporte_resuelto', points: 20, label: 'Tu reporte se resuelve' },
  { action: 'asistencia', points: 25, label: 'Asistir a una jornada (con el QR)' },
  { action: 'jornada_organizada', points: 15, label: 'Organizar una jornada con asistentes' },
  { action: 'solucion', points: 15, label: 'Resolver un reporte (instituciones y ONG)' },
  { action: 'voluntariado', points: 5, label: 'Sumarte como voluntario a un reporte' },
  { action: 'comentario', points: 2, label: 'Comentar en un reporte (una vez por reporte)' },
  { action: 'apoyo', points: 1, label: 'Marcar “Me afecta”' },
];

export type BadgeId =
  | 'primer_reporte' | 'reportero' | 'problema_resuelto' | 'barrio_mejor' | 'solidario' | 'voz_comunidad'
  | 'manos_a_la_obra' | 'voluntario_constante' | 'organizador' | 'solucionador';

/** Medallas (mismas reglas que award_badges en la base de datos). */
export const BADGES: { id: BadgeId; name: string; description: string; icon: string; action: PointAction; needed: number }[] = [
  { id: 'primer_reporte', name: 'Primer reporte', description: 'Publicaste tu primer reporte', icon: 'camera', action: 'reporte', needed: 1 },
  { id: 'reportero', name: 'Reportero comunitario', description: '10 reportes publicados', icon: 'file-text', action: 'reporte', needed: 10 },
  { id: 'problema_resuelto', name: 'Problema resuelto', description: 'Uno de tus reportes se resolvió', icon: 'check-circle', action: 'reporte_resuelto', needed: 1 },
  { id: 'barrio_mejor', name: 'Mi barrio mejora', description: '5 reportes tuyos resueltos', icon: 'home', action: 'reporte_resuelto', needed: 5 },
  { id: 'solidario', name: 'Vecino solidario', description: 'Apoyaste 25 reportes', icon: 'thumbs-up', action: 'apoyo', needed: 25 },
  { id: 'voz_comunidad', name: 'Voz de la comunidad', description: 'Comentaste en 10 reportes', icon: 'message', action: 'comentario', needed: 10 },
  { id: 'manos_a_la_obra', name: 'Manos a la obra', description: 'Asististe a tu primera jornada', icon: 'hand', action: 'asistencia', needed: 1 },
  { id: 'voluntario_constante', name: 'Voluntario constante', description: 'Asististe a 5 jornadas', icon: 'heart', action: 'asistencia', needed: 5 },
  { id: 'organizador', name: 'Organizador de jornadas', description: 'Organizaste una jornada con asistentes', icon: 'calendar', action: 'jornada_organizada', needed: 1 },
  { id: 'solucionador', name: 'Solucionador', description: 'Resolviste 5 reportes', icon: 'shield-check', action: 'solucion', needed: 5 },
];

/** Resultado de my_progress(). */
export interface Progress {
  points: number;
  month_points: number;
  level: number;
  level_name: string;
  level_floor: number;
  next_level_points: number | null;
  actions: Partial<Record<PointAction, number>>;
  badges: { badge: BadgeId; earned_at: string }[];
}

/** Porcentaje de avance hacia el siguiente nivel (100 en el máximo). */
export function levelProgress(progress: Pick<Progress, 'points' | 'level_floor' | 'next_level_points'>): number {
  if (progress.next_level_points === null) return 100;
  const span = progress.next_level_points - progress.level_floor;
  if (span <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(((progress.points - progress.level_floor) / span) * 100)));
}

export type RankingPeriod = 'mes' | 'anio' | 'todo';
export type RankingAudience = 'personas' | 'organizaciones';

/** Fila de leaderboard(). */
export interface RankingRow {
  rank_position: number;
  name: string;
  avatar_url: string | null;
  role: UserRole;
  province: string | null;
  points: number;
  level_name: string;
  is_me: boolean | null;
}

export type FlagTarget = 'report' | 'comment' | 'event';
export type FlagReason = 'spam' | 'ofensivo' | 'falso' | 'datos_personales' | 'otro';

export const FLAG_REASONS: { value: FlagReason; label: string; hint: string }[] = [
  { value: 'spam', label: 'Spam o publicidad', hint: 'Anuncios, enlaces sospechosos o mensajes repetidos.' },
  { value: 'ofensivo', label: 'Ofensivo o violento', hint: 'Insultos, amenazas o discriminación.' },
  { value: 'falso', label: 'Falso o engañoso', hint: 'El problema no existe o la información es falsa.' },
  { value: 'datos_personales', label: 'Expone datos personales', hint: 'Teléfonos, direcciones o rostros de personas sin permiso.' },
  { value: 'otro', label: 'Otro motivo', hint: 'Cuéntanos qué pasa.' },
];

/** Fila de admin_flag_queue(). */
export interface FlagQueueItem {
  target_type: FlagTarget;
  target_id: string;
  report_id: string | null;
  flags: number;
  reasons: FlagReason[];
  details: string[];
  preview: string | null;
  first_at: string;
  last_at: string;
}
