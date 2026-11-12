// Agrupación de marcadores cercanos (RF-18): con el país completo a la vista, cientos de
// marcadores se taparían entre sí. Se agrupan los que quedan a menos de `radius` píxeles.

export interface ClusterPoint<T> {
  item: T;
  /** Posición en píxeles del mapa (proyectada al zoom actual). */
  x: number;
  y: number;
}

export interface Cluster<T> {
  items: T[];
  /** Centro del grupo en píxeles (promedio de sus puntos). */
  x: number;
  y: number;
}

/**
 * Agrupa de forma voraz: cada punto se une al primer grupo cuyo centro esté a menos de
 * `radius` píxeles; si no hay ninguno, abre un grupo nuevo. Para cientos de puntos es instantáneo.
 */
export function clusterPoints<T>(points: ClusterPoint<T>[], radius: number): Cluster<T>[] {
  const clusters: (Cluster<T> & { sumX: number; sumY: number })[] = [];
  const radiusSq = radius * radius;
  for (const point of points) {
    let target: (typeof clusters)[number] | undefined;
    for (const cluster of clusters) {
      const dx = cluster.x - point.x;
      const dy = cluster.y - point.y;
      if (dx * dx + dy * dy <= radiusSq) {
        target = cluster;
        break;
      }
    }
    if (target) {
      target.items.push(point.item);
      target.sumX += point.x;
      target.sumY += point.y;
      target.x = target.sumX / target.items.length;
      target.y = target.sumY / target.items.length;
    } else {
      clusters.push({ items: [point.item], x: point.x, y: point.y, sumX: point.x, sumY: point.y });
    }
  }
  // El centro de un grupo se desplaza al crecer y puede quedar encima de otro: se unen
  // los grupos que terminaron demasiado cerca hasta que ninguno se tape.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i];
        const b = clusters[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        // Se tapan si están más cerca que la suma de sus radios dibujados (más un margen).
        const minGap = Math.max(radius, (clusterSize(a.items.length) + clusterSize(b.items.length)) / 2 + 6);
        if (dx * dx + dy * dy < minGap * minGap) {
          a.items.push(...b.items);
          a.sumX += b.sumX;
          a.sumY += b.sumY;
          a.x = a.sumX / a.items.length;
          a.y = a.sumY / a.items.length;
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return clusters.map(({ items, x, y }) => ({ items, x, y }));
}

/** Diámetro en píxeles con que se dibuja un grupo (un reporte suelto mide 34). */
export function clusterSize(count: number): number {
  return count <= 1 ? 34 : Math.round(Math.min(64, 36 + Math.log2(count) * 6));
}

/**
 * Anillo de colores para un grupo: un tramo por estado, proporcional a cuántos reportes tiene.
 * Devuelve un conic-gradient de CSS.
 */
export function statusRing(counts: Record<string, number>, colors: Record<string, string>, order: string[]): string {
  const total = order.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
  if (!total) return 'conic-gradient(#8a9693 0 100%)';
  let start = 0;
  const stops: string[] = [];
  for (const status of order) {
    const count = counts[status] ?? 0;
    if (!count) continue;
    const end = start + (count / total) * 100;
    stops.push(`${colors[status]} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
    start = end;
  }
  return `conic-gradient(${stops.join(', ')})`;
}
