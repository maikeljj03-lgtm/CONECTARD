import { projectToOutline } from '../constants/dr-outline';
import { distanceKm, formatDistance, greetingFor, timeAgo } from './geo';

describe('Utilidades de ubicación y tiempo (RF-23)', () => {
  it('calcula la distancia real entre Santo Domingo y Santiago (~120 km)', () => {
    const km = distanceKm({ lat: 18.4861, lng: -69.9312 }, { lat: 19.4517, lng: -70.697 });
    expect(km).toBeGreaterThan(125);
    expect(km).toBeLessThan(140);
  });

  it('la distancia de un punto a sí mismo es cero', () => {
    expect(distanceKm({ lat: 18.5, lng: -69.9 }, { lat: 18.5, lng: -69.9 })).toBe(0);
  });

  it('muestra la distancia de forma legible', () => {
    expect(formatDistance(0.34)).toBe('340 m');
    expect(formatDistance(1.234)).toBe('1.2 km');
    expect(formatDistance(48.6)).toBe('49 km');
  });

  it('expresa el tiempo transcurrido en español', () => {
    const now = new Date('2026-11-11T15:00:00Z');
    expect(timeAgo('2026-11-11T14:59:30Z', now)).toBe('Hace un momento');
    expect(timeAgo('2026-11-11T14:45:00Z', now)).toBe('Hace 15 min');
    expect(timeAgo('2026-11-11T12:00:00Z', now)).toBe('Hace 3 h');
    expect(timeAgo('2026-11-10T12:00:00Z', now)).toBe('Ayer');
    expect(timeAgo('2026-11-07T12:00:00Z', now)).toBe('Hace 4 días');
  });

  it('saluda según la hora', () => {
    expect(greetingFor(new Date(2026, 10, 11, 8))).toBe('Buenos días');
    expect(greetingFor(new Date(2026, 10, 11, 15))).toBe('Buenas tardes');
    expect(greetingFor(new Date(2026, 10, 11, 21))).toBe('Buenas noches');
  });

  it('ubica Santo Domingo al sur-centro y Puerto Plata al norte en la maqueta 3D', () => {
    const santoDomingo = projectToOutline(18.4861, -69.9312);
    const puertoPlata = projectToOutline(19.7934, -70.6884);
    expect(santoDomingo.y).toBeGreaterThan(puertoPlata.y); // más al sur = más abajo
    expect(santoDomingo.x).toBeGreaterThan(puertoPlata.x); // más al este = más a la derecha
    expect(santoDomingo.x).toBeGreaterThan(40);
    expect(santoDomingo.x).toBeLessThan(70);
  });
});
