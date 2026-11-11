// Catálogos de la app. Los valores coinciden con los CHECK de la base de datos.

/** Categorías de reportes (RF-09). */
export const REPORT_CATEGORIES = [
  { value: 'basura', label: 'Basura y limpieza', icon: 'trash' },
  { value: 'baches', label: 'Baches y vías', icon: 'alert' },
  { value: 'alumbrado', label: 'Alumbrado', icon: 'lightbulb' },
  { value: 'agua', label: 'Agua y alcantarillado', icon: 'droplet' },
  { value: 'areas_verdes', label: 'Áreas verdes', icon: 'leaf' },
  { value: 'seguridad', label: 'Seguridad', icon: 'shield' },
  { value: 'educacion', label: 'Educación', icon: 'book' },
  { value: 'otros', label: 'Otros', icon: 'more' },
] as const;

export type ReportCategoryValue = typeof REPORT_CATEGORIES[number]['value'];

/** Estados del ciclo de vida (RF-16). */
export const REPORT_STATUS_LABELS: Record<string, string> = {
  reportado: 'Reportado',
  en_revision: 'En revisión',
  en_proceso: 'En proceso',
  resuelto: 'Resuelto',
  rechazado: 'Rechazado',
};

/** Roles (RF-03). */
export const ROLE_LABELS: Record<string, string> = {
  citizen: 'Ciudadano',
  volunteer: 'Voluntario',
  organization: 'Organización / ONG',
  institution: 'Institución pública',
  administrator: 'Administrador',
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
