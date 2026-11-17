import { friendlyDataError } from './data-errors';

describe('Mensajes de error de Supabase', () => {
  it('muestra tal cual los mensajes propios de la base de datos (aunque sean de permiso)', () => {
    const error = { code: '42501', message: 'Para sumarte necesitas ser voluntario. Puedes solicitarlo desde tu perfil.' };
    expect(friendlyDataError(error)).toBe('Para sumarte necesitas ser voluntario. Puedes solicitarlo desde tu perfil.');
  });

  it('traduce los errores de permiso genéricos de Postgres y Storage', () => {
    expect(friendlyDataError({ code: '42501', message: 'permission denied for function toggle_report_support' })).toBe('No tienes permiso para realizar esta acción.');
    expect(friendlyDataError({ statusCode: '403', message: 'new row violates row-level security policy' })).toBe('No tienes permiso para realizar esta acción.');
  });

  it('solo habla de "solicitud pendiente" cuando el duplicado es de verificación', () => {
    expect(friendlyDataError({ code: '23505', message: 'duplicate key value violates unique constraint "verification_requests_one_pending"' })).toBe('Ya tienes una solicitud pendiente de revisión.');
    expect(friendlyDataError({ code: '23505', message: 'duplicate key value violates unique constraint "event_reports_pkey"' })).toBe('Ese registro ya existe.');
  });

  it('avisa cuando falta aplicar una migración', () => {
    expect(friendlyDataError({ code: '42703', message: 'column public_reports.search_key does not exist' })).toContain('Falta aplicar una migración');
  });
});
