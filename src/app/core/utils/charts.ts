// Gráficas pequeñas dibujadas con SVG (sin librerías): conteos por día y minigráfica de línea.

/** Cuántas fechas caen en cada uno de los últimos `days` días (hora local). El último es hoy. */
export function dailyCounts(isoDates: string[], days: number, now: Date = new Date()): number[] {
  const counts = new Array<number>(days).fill(0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (const iso of isoDates) {
    const date = new Date(iso);
    date.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000);
    if (diff >= 0 && diff < days) counts[days - 1 - diff]++;
  }
  return counts;
}

/**
 * Trazo de una minigráfica en un lienzo de width × height: la línea y el área debajo.
 * Con todos los valores en cero dibuja una línea plana en la base.
 */
export function sparklinePath(values: number[], width: number, height: number, padding = 3): { line: string; area: string } {
  if (!values.length) return { line: '', area: '' };
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
  const points = values.map((value, index) => {
    const x = padding + index * step;
    const y = height - padding - (value / max) * (height - padding * 2);
    return [Number(x.toFixed(2)), Number(y.toFixed(2))] as const;
  });
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
  const area = `${line} L${points[points.length - 1][0]} ${height} L${points[0][0]} ${height} Z`;
  return { line, area };
}
