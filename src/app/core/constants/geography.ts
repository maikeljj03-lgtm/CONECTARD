/** Provincias de República Dominicana (31 provincias + Distrito Nacional). */
export const DR_PROVINCES = [
  'Azua', 'Bahoruco', 'Barahona', 'Dajabón', 'Distrito Nacional', 'Duarte', 'El Seibo', 'Elías Piña',
  'Espaillat', 'Hato Mayor', 'Hermanas Mirabal', 'Independencia', 'La Altagracia', 'La Romana', 'La Vega',
  'María Trinidad Sánchez', 'Monseñor Nouel', 'Monte Cristi', 'Monte Plata', 'Pedernales', 'Peravia',
  'Puerto Plata', 'Samaná', 'San Cristóbal', 'San José de Ocoa', 'San Juan', 'San Pedro de Macorís',
  'Sánchez Ramírez', 'Santiago', 'Santiago Rodríguez', 'Santo Domingo', 'Valverde',
] as const;

/** Límites aproximados del país. Iguales al CHECK de la tabla reports. */
export const DR_BOUNDS = { minLat: 17.3, maxLat: 20.2, minLng: -72.1, maxLng: -68.2 } as const;

/** Encuadre del mapa para mostrar todo el país: [[sur, oeste], [norte, este]]. */
export const DR_MAP_VIEW: [[number, number], [number, number]] = [[17.45, -72.05], [20.05, -68.2]];

export function isInsideDominicanRepublic(lat: number, lng: number): boolean {
  return lat >= DR_BOUNDS.minLat && lat <= DR_BOUNDS.maxLat && lng >= DR_BOUNDS.minLng && lng <= DR_BOUNDS.maxLng;
}
