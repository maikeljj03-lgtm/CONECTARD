// Catálogos de la app. Los valores coinciden con los CHECK de la base de datos.
// Las etiquetas se traducen al idioma elegido (RF-56).
import { t } from '../i18n/i18n';

/** Categorías de reportes (RF-09). */
export const REPORT_CATEGORIES = [
  { value: 'basura', label: t('cat.basura'), icon: 'trash' },
  { value: 'baches', label: t('cat.baches'), icon: 'alert' },
  { value: 'alumbrado', label: t('cat.alumbrado'), icon: 'lightbulb' },
  { value: 'agua', label: t('cat.agua'), icon: 'droplet' },
  { value: 'areas_verdes', label: t('cat.areas_verdes'), icon: 'leaf' },
  { value: 'seguridad', label: t('cat.seguridad'), icon: 'shield' },
  { value: 'educacion', label: t('cat.educacion'), icon: 'book' },
  { value: 'otros', label: t('cat.otros'), icon: 'more' },
] as const;

export type ReportCategoryValue = typeof REPORT_CATEGORIES[number]['value'];

/** Estados del ciclo de vida (RF-16). */
export const REPORT_STATUS_LABELS: Record<string, string> = {
  reportado: t('status.reportado'),
  en_revision: t('status.en_revision'),
  en_proceso: t('status.en_proceso'),
  resuelto: t('status.resuelto'),
  rechazado: t('status.rechazado'),
};

/** Roles (RF-03). */
export const ROLE_LABELS: Record<string, string> = {
  citizen: t('role.citizen'),
  volunteer: t('role.volunteer'),
  organization: t('role.organization'),
  institution: t('role.institution'),
  administrator: t('role.administrator'),
};

/** Tipos de organización para la verificación (RF-06). */
export const ORGANIZATION_TYPES = [
  { value: 'ong', label: 'ONG' },
  { value: 'fundacion', label: 'Fundación' },
  { value: 'asociacion_comunitaria', label: 'Asociación comunitaria' },
  { value: 'junta_de_vecinos', label: 'Junta de vecinos' },
  { value: 'centro_educativo', label: 'Centro educativo' },
  { value: 'ayuntamiento', label: 'Ayuntamiento' },
  { value: 'junta_distrital', label: 'Junta distrital' },
  { value: 'ministerio_o_direccion', label: 'Ministerio o dirección general' },
  { value: 'otra', label: 'Otra' },
] as const;

/** Tipos que corresponden a una institución pública (el resto son organizaciones). */
export const INSTITUTION_TYPES: readonly string[] = ['ayuntamiento', 'junta_distrital', 'ministerio_o_direccion'];
