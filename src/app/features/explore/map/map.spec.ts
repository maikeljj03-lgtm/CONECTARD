import { parseChange } from '../../../core/services/reports-realtime.service';
import { clusterPoints, statusRing } from './clustering';
import { heatMax, heatRadius } from './heat-layer';

describe('Mapa interactivo (RF-18, RF-19)', () => {
  it('agrupa los marcadores cercanos y deja aparte los lejanos', () => {
    const clusters = clusterPoints([
      { item: 'a', x: 100, y: 100 },
      { item: 'b', x: 120, y: 110 },
      { item: 'c', x: 400, y: 400 },
    ], 46);
    expect(clusters.length).toBe(2);
    expect(clusters[0].items).toEqual(['a', 'b']);
    expect(clusters[0].x).toBe(110);
    expect(clusters[1].items).toEqual(['c']);
  });

  it('une los grupos que, al crecer, quedaron encimados', () => {
    // Puntos en fila: el centro de cada grupo se mueve al sumar puntos.
    const clusters = clusterPoints([
      { item: 'a', x: 100, y: 0 },
      { item: 'b', x: 140, y: 0 },
      { item: 'c', x: 175, y: 0 },
      { item: 'd', x: 200, y: 0 },
    ], 46);
    for (const [i, first] of clusters.entries()) {
      for (const second of clusters.slice(i + 1)) expect(Math.abs(first.x - second.x)).toBeGreaterThan(46);
    }
  });

  it('el anillo de un grupo reparte los colores según cuántos reportes hay por estado', () => {
    const ring = statusRing({ reportado: 3, resuelto: 1 }, { reportado: '#aaa', resuelto: '#0bb' }, ['reportado', 'resuelto']);
    expect(ring).toBe('conic-gradient(#aaa 0.00% 75.00%, #0bb 75.00% 100.00%)');
  });

  it('el radio del mapa de calor crece al acercarse, con límites', () => {
    expect(heatRadius(6)).toBe(18);
    expect(heatRadius(12)).toBeGreaterThan(heatRadius(9));
    expect(heatRadius(18)).toBe(46);
  });

  it('un reporte aislado no llega al color máximo; una zona densa sí', () => {
    expect(heatMax([{ x: 0, y: 0, weight: 1 }], 20)).toBe(2);
    const dense = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, weight: 1 }));
    expect(heatMax(dense, 20)).toBe(5);
  });

  it('solo acepta avisos en vivo con id válido y tipo conocido', () => {
    expect(parseChange({ id: '0b8f6c0e-3a55-4c1f-9d3b-0a2f9e6c1d11', change: 'created' })).toEqual({ id: '0b8f6c0e-3a55-4c1f-9d3b-0a2f9e6c1d11', change: 'created' });
    expect(parseChange({ id: 'x; drop table', change: 'created' })).toBeNull();
    expect(parseChange({ id: '0b8f6c0e-3a55-4c1f-9d3b-0a2f9e6c1d11', change: 'hack' })).toBeNull();
    expect(parseChange(null)).toBeNull();
  });
});
