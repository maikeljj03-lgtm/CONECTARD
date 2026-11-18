import { dailyCounts, sparklinePath } from './charts';

describe('Minigráficas de la homepage', () => {
  const now = new Date(2026, 10, 17, 20, 0);

  it('cuenta reportes por día en los últimos 14 días (el último es hoy)', () => {
    const counts = dailyCounts([
      new Date(2026, 10, 17, 9).toISOString(),
      new Date(2026, 10, 17, 1).toISOString(),
      new Date(2026, 10, 16, 23).toISOString(),
      new Date(2026, 10, 4, 10).toISOString(),
      new Date(2026, 10, 3, 10).toISOString(), // hace 14 días: queda fuera
    ], 14, now);
    expect(counts.length).toBe(14);
    expect(counts[13]).toBe(2);
    expect(counts[12]).toBe(1);
    expect(counts[0]).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('dibuja la línea y el área dentro del lienzo', () => {
    const { line, area } = sparklinePath([0, 2, 1], 120, 36);
    expect(line.startsWith('M3 33')).toBe(true);
    expect(line).toContain('L60 3');
    expect(area.endsWith('Z')).toBe(true);
  });

  it('sin datos no dibuja nada, y con ceros dibuja una línea plana', () => {
    expect(sparklinePath([], 120, 36)).toEqual({ line: '', area: '' });
    expect(sparklinePath([0, 0], 120, 36).line).toBe('M3 33 L117 33');
  });
});
