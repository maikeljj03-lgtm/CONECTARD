/** Fila de la tabla public.verification_requests (RF-06). */
export interface VerificationRequest {
  id: string;
  user_id: string;
  requested_role: 'organization' | 'institution';
  organization_name: string;
  organization_type: string;
  rnc: string | null;
  contact_name: string;
  contact_phone: string;
  coverage_area: string;
  document_paths: string[];
  status: 'pending' | 'approved' | 'rejected';
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/** Solicitud con el perfil de quien la envió (vista del administrador). */
export interface VerificationRequestWithProfile extends VerificationRequest {
  profiles: { full_name: string; avatar_url: string | null } | null;
}

/** Datos que llena el usuario al solicitar la verificación. */
export type NewVerificationRequest = Pick<VerificationRequest,
  'requested_role' | 'organization_name' | 'organization_type' | 'rnc' | 'contact_name' | 'contact_phone' | 'coverage_area'>;
