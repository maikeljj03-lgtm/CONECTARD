import type { UserRole } from '../models/profile.model';

// Matriz de permisos por rol (RF-03). Es la referencia de la interfaz: muestra u oculta
// opciones. Lo que protege los datos de verdad son las políticas y funciones de la base
// de datos (supabase/migrations/20261112000000_roles_permissions.sql).

export type Permission =
  | 'report.create'
  | 'report.support'
  | 'report.comment'
  | 'event.join'
  | 'event.create'
  | 'resource.manage'
  | 'report.manage_status'
  | 'content.moderate'
  | 'verifications.review'
  | 'users.manage';

export const PERMISSION_LABELS: Record<Permission, string> = {
  'report.create': 'Crear reportes, con tu nombre o de forma anónima',
  'report.support': 'Apoyar reportes con “Me afecta”',
  'report.comment': 'Comentar reportes',
  'event.join': 'Inscribirte en jornadas y sumarte a soluciones',
  'event.create': 'Crear eventos y jornadas comunitarias',
  'resource.manage': 'Gestionar insumos y donaciones',
  'report.manage_status': 'Cambiar el estado de los reportes',
  'content.moderate': 'Moderar reportes y comentarios',
  'verifications.review': 'Revisar verificaciones y voluntarios',
  'users.manage': 'Administrar cuentas y roles',
};

const CITIZEN: Permission[] = ['report.create', 'report.support', 'report.comment'];
const VOLUNTEER: Permission[] = [...CITIZEN, 'event.join'];
const ORGANIZATION: Permission[] = [...VOLUNTEER, 'event.create', 'resource.manage'];
const INSTITUTION: Permission[] = [...CITIZEN, 'report.manage_status'];
const ADMINISTRATOR: Permission[] = Object.keys(PERMISSION_LABELS) as Permission[];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  citizen: CITIZEN,
  volunteer: VOLUNTEER,
  organization: ORGANIZATION,
  institution: INSTITUTION,
  administrator: ADMINISTRATOR,
};

export function roleCan(role: UserRole | null | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}
