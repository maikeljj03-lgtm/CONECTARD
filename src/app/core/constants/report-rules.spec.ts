import {
  REPORT_EDIT_WINDOW_HOURS, allowedNextStatuses, editTimeLeft, editableUntil, isReportEditable,
  statusNeedsEvidence, statusNeedsNote,
} from './report-rules';

describe('Reglas del ciclo de vida de los reportes (RF-15, RF-16, RF-17)', () => {
  const created = '2026-11-12T10:00:00.000Z';
  const at = (hours: number) => new Date(new Date(created).getTime() + hours * 3_600_000);

  it('el autor puede editar durante las primeras 24 horas', () => {
    expect(REPORT_EDIT_WINDOW_HOURS).toBe(24);
    expect(isReportEditable({ status: 'reportado', created_at: created }, at(1))).toBe(true);
    expect(isReportEditable({ status: 'reportado', created_at: created }, at(23.9))).toBe(true);
    expect(isReportEditable({ status: 'reportado', created_at: created }, at(24))).toBe(false);
  });

  it('no se puede editar si una institución ya lo está atendiendo', () => {
    expect(isReportEditable({ status: 'en_revision', created_at: created }, at(1))).toBe(false);
    expect(editableUntil({ status: 'resuelto', created_at: created })).toBeNull();
  });

  it('muestra el tiempo que queda para editar', () => {
    const report = { status: 'reportado' as const, created_at: created };
    expect(editTimeLeft(report, at(19))).toBe('Quedan 5 h');
    expect(editTimeLeft(report, at(23.5))).toBe('Quedan 30 min');
    expect(editTimeLeft(report, at(25))).toBeNull();
  });

  it('la institución puede avanzar o rechazar, pero no volver a "Reportado"', () => {
    expect(allowedNextStatuses('institution', 'reportado')).toEqual(['en_revision', 'en_proceso', 'resuelto', 'rechazado']);
    expect(allowedNextStatuses('institution', 'en_proceso')).not.toContain('en_proceso');
    expect(allowedNextStatuses('institution', 'en_proceso')).not.toContain('reportado');
  });

  it('el administrador solo modera: rechazar o restaurar', () => {
    expect(allowedNextStatuses('administrator', 'en_proceso')).toEqual(['rechazado']);
    expect(allowedNextStatuses('administrator', 'rechazado')).toEqual(['reportado']);
  });

  it('la organización participante solo marca "En proceso" o "Resuelto"', () => {
    expect(allowedNextStatuses('organization', 'reportado')).toEqual(['en_proceso', 'resuelto']);
    expect(allowedNextStatuses('organization', 'en_proceso')).toEqual(['resuelto']);
    expect(allowedNextStatuses('organization', 'resuelto')).toEqual([]);
  });

  it('ciudadanos y voluntarios no cambian estados', () => {
    expect(allowedNextStatuses('citizen', 'reportado')).toEqual([]);
    expect(allowedNextStatuses('volunteer', 'reportado')).toEqual([]);
    expect(allowedNextStatuses(null, 'reportado')).toEqual([]);
  });

  it('rechazar exige motivo y resolver exige evidencia', () => {
    expect(statusNeedsNote('rechazado')).toBe(true);
    expect(statusNeedsNote('en_proceso')).toBe(false);
    expect(statusNeedsEvidence('resuelto')).toBe(true);
    expect(statusNeedsEvidence('en_revision')).toBe(false);
  });
});
