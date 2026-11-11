// Silueta de República Dominicana para la escena 3D de la homepage.
// Fuente: Natural Earth 1:50m (dominio público), proyección equirectangular
// corregida por la latitud media (≈18.8°). Generado una vez; no editar a mano.

export const DR_VIEWBOX = { width: 1000, height: 671 } as const;

const BOUNDS = { minLng: -72.05, maxLng: -68.29, minLat: 17.58, maxLat: 19.97 } as const;
const K = Math.cos((18.8 * Math.PI) / 180);
const SCALE = 1000 / ((BOUNDS.maxLng - BOUNDS.minLng) * K);

/** Contorno del país en coordenadas del viewBox. */
export const DR_OUTLINE_PATH =
  'M74.9 542.5L76.1 496.2L83.2 477.4L76.6 457.6L47.2 436.5L29.2 409.5L13.2 385.5L16.8 382.0L48.8 380.9L60.0 372.1L81.6 347.6L85.9 327.8L84.1 312.9L70.1 295.0L64.6 276.2L81.9 259.7L104.5 235.8L107.6 226.6L107.1 217.5L80.7 192.2L78.9 181.4L91.2 154.0L90.0 135.8L77.8 79.2L72.0 70.8L83.7 66.0L91.5 49.1L101.8 34.1L115.4 26.0L130.9 21.0L161.8 21.4L204.4 34.5L216.5 34.2L257.5 22.3L291.4 15.7L323.4 23.2L336.4 33.5L362.8 49.7L376.0 54.6L417.7 54.2L429.1 55.8L464.2 82.6L493.7 93.3L510.8 93.8L541.5 83.5L556.7 83.8L574.1 106.8L577.6 139.5L592.2 169.4L614.5 188.5L724.7 180.4L749.3 196.1L740.9 209.1L725.3 216.0L672.9 213.0L650.0 214.5L645.4 227.4L645.3 239.4L676.0 242.3L706.0 248.3L736.6 257.9L767.8 264.5L802.8 268.8L837.4 275.8L895.0 299.3L958.7 352.7L975.7 364.9L986.9 381.7L981.6 402.3L958.8 436.1L946.0 447.0L927.2 453.6L914.3 467.4L901.9 491.1L894.3 493.1L885.4 492.1L870.1 478.7L859.2 458.1L828.5 438.8L792.0 441.3L738.2 429.9L705.6 435.4L673.0 436.7L639.7 430.9L606.2 428.8L572.8 436.1L540.3 448.5L528.4 456.4L507.6 475.6L496.5 482.7L417.6 492.4L394.8 478.3L373.8 459.0L343.4 456.4L299.4 471.3L271.9 476.7L260.6 483.1L257.4 490.4L257.3 517.4L251.1 533.8L208.2 595.7L184.0 639.4L174.0 652.9L162.5 655.8L141.4 630.7L127.9 621.6L111.2 617.1L104.2 603.7L104.5 584.7L100.1 566.4L89.8 551.9L74.9 542.5Z';

/** Convierte latitud/longitud en una posición dentro del dibujo (0–100 %). */
export function projectToOutline(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng - BOUNDS.minLng) * K * SCALE) / DR_VIEWBOX.width;
  const y = ((BOUNDS.maxLat - lat) * SCALE) / DR_VIEWBOX.height;
  return { x: Math.min(1, Math.max(0, x)) * 100, y: Math.min(1, Math.max(0, y)) * 100 };
}
