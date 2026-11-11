/** Provincias de República Dominicana (31 provincias + Distrito Nacional). */
export const DR_PROVINCES = [
  'Azua', 'Bahoruco', 'Barahona', 'Dajabón', 'Distrito Nacional', 'Duarte', 'El Seibo', 'Elías Piña',
  'Espaillat', 'Hato Mayor', 'Hermanas Mirabal', 'Independencia', 'La Altagracia', 'La Romana', 'La Vega',
  'María Trinidad Sánchez', 'Monseñor Nouel', 'Monte Cristi', 'Monte Plata', 'Pedernales', 'Peravia',
  'Puerto Plata', 'Samaná', 'San Cristóbal', 'San José de Ocoa', 'San Juan', 'San Pedro de Macorís',
  'Sánchez Ramírez', 'Santiago', 'Santiago Rodríguez', 'Santo Domingo', 'Valverde',
] as const;

/** Categorías de reportes (RF-09). El valor coincide con el CHECK de la tabla reports. */
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

export const REPORT_STATUS_LABELS: Record<string, string> = {
  reportado: 'Reportado',
  en_revision: 'En revisión',
  en_proceso: 'En proceso',
  resuelto: 'Resuelto',
  rechazado: 'Rechazado',
};

/** Límites aproximados del país, iguales al CHECK de la tabla reports. */
export const DR_BOUNDS = { minLat: 17.3, maxLat: 20.2, minLng: -72.1, maxLng: -68.2 };

export const ROLE_LABELS: Record<string, string> = {
  citizen: 'Ciudadano',
  volunteer: 'Voluntario',
  organization: 'Organización / ONG',
  institution: 'Institución pública',
  administrator: 'Administrador',
};

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
