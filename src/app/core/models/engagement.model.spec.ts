import { BADGES, FLAG_REASONS, NOTIFICATION_ICONS, POINT_RULES, levelProgress } from './engagement.model';

describe('Módulo 5: reglas de la app', () => {
  it('calcula el avance hacia el siguiente nivel', () => {
    expect(levelProgress({ points: 0, level_floor: 0, next_level_points: 50 })).toBe(0);
    expect(levelProgress({ points: 100, level_floor: 50, next_level_points: 150 })).toBe(50);
    expect(levelProgress({ points: 1500, level_floor: 1000, next_level_points: null })).toBe(100);
    expect(levelProgress({ points: 10, level_floor: 50, next_level_points: 150 })).toBe(0);
  });

  it('los puntos coinciden con los de la base de datos', () => {
    const byAction = Object.fromEntries(POINT_RULES.map((rule) => [rule.action, rule.points]));
    expect(byAction).toEqual({ reporte: 10, reporte_resuelto: 20, asistencia: 25, jornada_organizada: 15, solucion: 15, voluntariado: 5, comentario: 2, apoyo: 1 });
  });

  it('hay 10 medallas, todas con una acción que da puntos', () => {
    expect(BADGES.length).toBe(10);
    const actions = new Set(POINT_RULES.map((rule) => rule.action));
    expect(BADGES.every((badge) => actions.has(badge.action) && badge.needed > 0)).toBe(true);
    expect(new Set(BADGES.map((badge) => badge.id)).size).toBe(10);
  });

  it('cada tipo de notificación tiene ícono y cada denuncia un motivo válido', () => {
    expect(Object.keys(NOTIFICATION_ICONS).length).toBe(12);
    expect(FLAG_REASONS.map((reason) => reason.value)).toEqual(['spam', 'ofensivo', 'falso', 'datos_personales', 'otro']);
  });
});
