import { roleCan, ROLE_PERMISSIONS, PERMISSION_LABELS, type Permission } from './permissions';

describe('Permisos por rol (RF-03)', () => {
  it('el ciudadano reporta, apoya y comenta, pero no administra', () => {
    expect(roleCan('citizen', 'report.create')).toBe(true);
    expect(roleCan('citizen', 'report.support')).toBe(true);
    expect(roleCan('citizen', 'event.join')).toBe(false);
    expect(roleCan('citizen', 'users.manage')).toBe(false);
  });

  it('el voluntario puede sumarse a jornadas, pero no crearlas', () => {
    expect(roleCan('volunteer', 'event.join')).toBe(true);
    expect(roleCan('volunteer', 'event.create')).toBe(false);
  });

  it('la organización crea eventos, gestiona insumos y avanza (de forma limitada) los reportes donde participa', () => {
    expect(roleCan('organization', 'event.create')).toBe(true);
    expect(roleCan('organization', 'resource.manage')).toBe(true);
    // La base de datos limita el cambio a "En proceso"/"Resuelto" y solo en reportes donde se sumó.
    expect(roleCan('organization', 'report.manage_status')).toBe(true);
    expect(roleCan('organization', 'content.moderate')).toBe(false);
  });

  it('la institución también organiza jornadas y pide insumos (sección 4 de la propuesta)', () => {
    expect(roleCan('institution', 'event.create')).toBe(true);
    expect(roleCan('institution', 'resource.manage')).toBe(true);
    expect(roleCan('institution', 'event.join')).toBe(false);
  });

  it('la institución cambia el estado de los reportes, pero no modera ni administra', () => {
    expect(roleCan('institution', 'report.manage_status')).toBe(true);
    expect(roleCan('institution', 'content.moderate')).toBe(false);
    expect(roleCan('institution', 'users.manage')).toBe(false);
  });

  it('el administrador tiene todos los permisos', () => {
    for (const permission of Object.keys(PERMISSION_LABELS) as Permission[]) {
      expect(roleCan('administrator', permission)).toBe(true);
    }
  });

  it('sin sesión no hay permisos', () => {
    expect(roleCan(null, 'report.create')).toBe(false);
  });

  it('todos los roles pueden crear reportes', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]) {
      expect(roleCan(role, 'report.create')).toBe(true);
    }
  });
});
