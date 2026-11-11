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
  created_at: string;
  updated_at: string;
}

/** Campos que el propio usuario puede editar (RF-05). */
export type ProfileUpdate = Pick<Profile, 'full_name' | 'province' | 'municipality' | 'sector' | 'bio'>;
