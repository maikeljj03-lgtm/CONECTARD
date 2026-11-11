import type { RequestedRole } from '../../core/models/profile.model';

export const AUTH_MODES = ['login', 'register', 'verify-email', 'verify-login', 'forgot-password', 'reset-password'] as const;
export type AuthMode = typeof AUTH_MODES[number];
export const PENDING_SIGNUP_EMAIL = 'conectard.pending-signup-email';

export interface RoleOption {
  value: RequestedRole;
  slug: string;
  icon: string;
  title: string;
  description: string;
  badge?: string;
  note?: string;
}

export const ROLE_OPTIONS: RoleOption[] = [
  { value: 'citizen', slug: 'ciudadano', icon: 'user', title: 'Ciudadano', description: 'Reporta problemas, apoya los de tus vecinos y sigue su solución.' },
  {
    value: 'volunteer', slug: 'voluntario', icon: 'heart', title: 'Voluntario', description: 'Súmate a soluciones y jornadas. Ideal para horas de servicio social.',
    badge: 'Con revisión', note: 'Empezarás como ciudadano mientras revisamos tu solicitud de voluntariado.',
  },
  {
    value: 'organization', slug: 'ong', icon: 'users', title: 'Organización / ONG', description: 'Coordina eventos, insumos y donaciones para tu comunidad.',
    badge: 'Verificación', note: 'Después del registro te pediremos documentos de la organización. Hasta verificarla, la cuenta funciona como ciudadano.',
  },
  {
    value: 'institution', slug: 'institucion', icon: 'landmark', title: 'Institución pública', description: 'Recibe los reportes de tu jurisdicción y muestra resultados.',
    badge: 'Verificación', note: 'Después del registro te pediremos documentación oficial. Hasta verificarla, la cuenta funciona como ciudadano.',
  },
];

export const PASSWORD_LABELS = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Fuerte'];
