import * as L from 'leaflet';

// Mapa de calor (RF-19), dibujado en un <canvas> dentro del mapa, sin librerías externas.
// Técnica: cada reporte se pinta como un círculo difuminado en escala de grises con poca
// opacidad; donde se acumulan muchos, el gris se vuelve intenso. Después cada píxel se
// colorea según esa intensidad con una paleta (pocos → verde azulado, muchos → rojo).

export interface HeatPoint {
  lat: number;
  lng: number;
  /** Peso del punto (1 = un reporte). */
  weight: number;
}

/** Paleta de la marca: poca densidad en verde azulado, mucha en ámbar y rojo. */
export const HEAT_GRADIENT: [number, string][] = [
  [0.0, 'rgba(0, 178, 169, 0)'],
  [0.25, 'rgba(0, 178, 169, 0.75)'],
  [0.5, '#9cc87a'],
  [0.7, '#e9c46a'],
  [0.85, '#e9a13b'],
  [1.0, '#c4483d'],
];

/** Radio (en píxeles de pantalla) según el zoom: más grande al acercarse. */
export function heatRadius(zoom: number): number {
  return Math.round(Math.min(46, Math.max(18, 22 + (zoom - 8) * 3.5)));
}

/**
 * Cuántos reportes cercanos hacen falta para llegar al color máximo. Se adapta a los datos
 * (el 95 % de los puntos tiene como mucho p95 vecinos dentro del radio).
 * Así un solo reporte aislado no se ve rojo, y la zona más densa sí.
 */
export function heatMax(points: { x: number; y: number; weight: number }[], radius: number): number {
  if (!points.length) return 1;
  const radiusSq = radius * radius;
  const density = points.map((a) => points.reduce((sum, b) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy <= radiusSq ? sum + b.weight : sum;
  }, 0));
  density.sort((a, b) => a - b);
  const p95 = density[Math.min(density.length - 1, Math.floor(density.length * 0.95))];
  // A la mitad de esa densidad ya se llega al rojo: las zonas más afectadas destacan con claridad.
  return Math.max(2, p95 * 0.5);
}

export class HeatLayer {
  private readonly canvas = document.createElement('canvas');
  private map?: L.Map;
  private points: HeatPoint[] = [];
  private palette?: Uint8ClampedArray;
  private stamp?: { canvas: HTMLCanvasElement; radius: number; ratio: number };
  private visible = false;
  private readonly redraw = () => this.draw();

  constructor() {
    // leaflet-zoom-hide: Leaflet lo oculta durante la animación de zoom y se redibuja al terminar.
    this.canvas.className = 'heat-layer leaflet-zoom-hide';
    this.canvas.setAttribute('aria-hidden', 'true');
  }

  addTo(map: L.Map): this {
    this.map = map;
    map.getPanes().overlayPane.appendChild(this.canvas);
    map.on('moveend zoomend resize viewreset', this.redraw);
    this.draw();
    return this;
  }

  remove(): void {
    this.map?.off('moveend zoomend resize viewreset', this.redraw);
    this.canvas.remove();
    this.map = undefined;
  }

  setPoints(points: HeatPoint[]): void {
    this.points = points;
    this.draw();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.canvas.hidden = !visible;
    this.draw();
  }

  draw(): void {
    const map = this.map;
    if (!map || !this.visible) return;
    const size = map.getSize();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(size.x * ratio));
    const height = Math.max(1, Math.round(size.y * ratio));

    // El canvas sigue a la esquina superior izquierda visible del mapa.
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]));
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;

    const context = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (!this.points.length) return;

    const radius = heatRadius(map.getZoom());
    const stamp = this.getStamp(radius, ratio);
    const half = stamp.canvas.width / 2;
    const bounds = map.getBounds().pad(0.25);
    const projected = this.points
      .filter((point) => bounds.contains([point.lat, point.lng]))
      .map((point) => {
        const position = map.latLngToContainerPoint([point.lat, point.lng]);
        return { x: position.x, y: position.y, weight: point.weight };
      });
    const max = heatMax(projected, radius);

    for (const point of projected) {
      context.globalAlpha = Math.min(1, Math.max(0.05, point.weight / max));
      context.drawImage(stamp.canvas, point.x * ratio - half, point.y * ratio - half);
    }
    context.globalAlpha = 1;
    this.colorize(context, width, height);
  }

  /** Círculo difuminado que se "estampa" por cada reporte. */
  private getStamp(radius: number, ratio: number): { canvas: HTMLCanvasElement; radius: number; ratio: number } {
    if (this.stamp && this.stamp.radius === radius && this.stamp.ratio === ratio) return this.stamp;
    const r = radius * ratio;
    const blur = r * 0.9;
    const full = Math.ceil(r + blur);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = full * 2;
    const context = canvas.getContext('2d')!;
    // Se dibuja fuera del lienzo y solo se deja ver su sombra difuminada.
    context.shadowOffsetX = context.shadowOffsetY = full * 2;
    context.shadowBlur = blur;
    context.shadowColor = 'black';
    context.beginPath();
    context.arc(-full, -full, r, 0, Math.PI * 2);
    context.closePath();
    context.fill();
    this.stamp = { canvas, radius, ratio };
    return this.stamp;
  }

  /** Pasa la intensidad (opacidad acumulada) a los colores de la paleta. */
  private colorize(context: CanvasRenderingContext2D, width: number, height: number): void {
    const palette = this.getPalette();
    const image = context.getImageData(0, 0, width, height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (!alpha) continue;
      const offset = alpha * 4;
      data[i] = palette[offset];
      data[i + 1] = palette[offset + 1];
      data[i + 2] = palette[offset + 2];
      data[i + 3] = Math.min(255, palette[offset + 3] * (0.55 + alpha / 255 * 0.45));
    }
    context.putImageData(image, 0, 0);
  }

  private getPalette(): Uint8ClampedArray {
    if (this.palette) return this.palette;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 256, 0);
    for (const [stop, color] of HEAT_GRADIENT) gradient.addColorStop(stop, color);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 1);
    this.palette = context.getImageData(0, 0, 256, 1).data;
    return this.palette;
  }
}
