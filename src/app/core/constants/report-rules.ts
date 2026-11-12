import type { UserRole } from '../models/profile.model';
import type { ReportStatus } from '../models/report.model';

// Reglas del módulo 2 (RF-15, RF-16, RF-17). La base de datos las vuelve a comprobar en
// supabase/migrations/20261114000000_report_lifecycle.sql; aquí solo deciden qué mostrar.

/** Horas que tiene el autor para editar o eliminar su reporte (report_edit_window en SQL). */
export const REPORT_EDIT_WINDOW_HOURS = 24;

/** Orden normal del ciclo de vida (sin "Rechazado", que es una salida). */
export const REPORT_LIFECYCLE: readonly ReportStatus[] = ['reportado', 'en_revision', 'en_proceso', 'resuelto'];

/** Lo que significa cada estado, para quien lo cambia. */
export const STATUS_DESCRIPTIONS: Record<ReportStatus, string> = {
  reportado: 'Recibido, aún nadie lo ha revisado.',
  en_revision: 'La institución lo está evaluando.',
  en_proceso: 'Ya se está trabajando en la solución.',
  resuelto: 'El problema se solucionó (con foto de evidencia).',
  rechazado: 'No procede: duplicado, falso o fuera de lugar.',
};

interface EditableReport {
  status: ReportStatus;
  created_at: string;
}

/** Hasta cuándo se puede editar, o null si ya no se puede (por estado). */
export function editableUntil(report: EditableReport): Date | null {
  if (report.status !== 'reportado') return null;
  return new Date(new Date(report.created_at).getTime() + REPORT_EDIT_WINDOW_HOURS * 3_600_000);
}

export function isReportEditable(report: EditableReport, now: Date = new Date()): boolean {
  const until = editableUntil(report);
  return !!until && until.getTime() > now.getTime();
}

/** "Quedan 5 h", "Quedan 40 min"... o null si ya no se puede editar. */
export function editTimeLeft(report: EditableReport, now: Date = new Date()): string | null {
  const until = editableUntil(report);
  if (!until) return null;
  const minutes = Math.floor((until.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return null;
  if (minutes < 60) return `Quedan ${minutes} min`;
  return `Quedan ${Math.floor(minutes / 60)} h`;
}

/**
 * Estados a los que puede pasar un reporte según quién lo cambia (RF-16).
 * - Institución (en su jurisdicción): cualquier estado menos volver a "Reportado".
 * - Organización (solo en los reportes en los que participa): "En proceso" o "Resuelto".
 * - Administrador: solo modera (rechazar, o restaurar uno rechazado).
 */
export function allowedNextStatuses(role: UserRole | null | undefined, current: ReportStatus): ReportStatus[] {
  if (role === 'institution') {
    return (['en_revision', 'en_proceso', 'resuelto', 'rechazado'] as ReportStatus[]).filter((status) => status !== current);
  }
  if (role === 'organization') {
    if (current === 'resuelto' || current === 'rechazado') return [];
    return (['en_proceso', 'resuelto'] as ReportStatus[]).filter((status) => status !== current);
  }
  if (role === 'administrator') {
    return current === 'rechazado' ? ['reportado'] : ['rechazado'];
  }
  return [];
}

/** Estados que exigen una nota: el rechazo siempre lleva motivo. */
export function statusNeedsNote(status: ReportStatus): boolean {
  return status === 'rechazado';
}

/** "Resuelto" exige evidencia (al menos una foto del después). */
export function statusNeedsEvidence(status: ReportStatus): boolean {
  return status === 'resuelto';
}
