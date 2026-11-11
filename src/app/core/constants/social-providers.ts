// Redes sociales para entrar o registrarse (RF-01).
// El "id" es el nombre del proveedor en Supabase Auth.
// Solo se muestran las que estén activadas en Supabase (Authentication → Sign In / Providers).
// Facebook y X se retiraron por decisión del equipo. Instagram no existe en Supabase.

export type SocialProvider = 'google' | 'apple' | 'azure' | 'linkedin_oidc';

export interface SocialProviderInfo {
  id: SocialProvider;
  label: string;
  /** "primary": siempre a la vista. "more": dentro de "Más opciones". */
  group: 'primary' | 'more';
}

export const SOCIAL_PROVIDERS: readonly SocialProviderInfo[] = [
  { id: 'google', label: 'Google', group: 'primary' },
  { id: 'apple', label: 'Apple', group: 'more' },
  { id: 'azure', label: 'Microsoft', group: 'more' },
  { id: 'linkedin_oidc', label: 'LinkedIn', group: 'more' },
];

export function socialProviderLabel(id: SocialProvider): string {
  return SOCIAL_PROVIDERS.find((provider) => provider.id === id)?.label ?? 'La red social';
}
