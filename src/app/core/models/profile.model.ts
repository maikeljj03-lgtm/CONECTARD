/** Rol con el que la app concede permisos (columna profiles.role). */
export type UserRole = 'citizen' | 'volunteer' | 'organization' | 'institution' | 'administrator';

/** Rol que una persona puede solicitar al registrarse (nunca "administrator"). */
export type RequestedRole = Exclude<UserRole, 'administrator'>;

export type VerificationStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

/** Fila de la tabla public.profiles. */
export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  province: string | null;
  municipality: string | null;
  sector: string | null;
  bio: string | null;
  role: UserRole;
  requested_role: RequestedRole;
  verification_status: VerificationStatus;
  /** Motivo de la última revisión de rol (por ejemplo, por qué se rechazó el voluntariado). */
  role_review_notes?: string | null;
  role_reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** Campos que el propio usuario puede editar (RF-05). */
export type ProfileUpdate = Pick<Profile, 'full_name' | 'province' | 'municipality' | 'sector' | 'bio'>;

/** Cuenta vista por el administrador (incluye el correo). */
export interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: UserRole;
  requested_role: RequestedRole;
  verification_status: VerificationStatus;
  created_at: string;
}
