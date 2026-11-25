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

/** Contorno simplificado del territorio dominicano (coordenadas GeoJSON: longitud, latitud). */
export const DR_COUNTRY_BOUNDARY: ReadonlyArray<readonly [number, number]> = [
  [-71.712361, 19.714456], [-71.587304, 19.884911], [-70.806706, 19.880286], [-70.214365, 19.622885],
  [-69.950815, 19.648], [-69.76925, 19.293267], [-69.222126, 19.313214], [-69.254346, 19.015196],
  [-68.809412, 18.979074], [-68.317943, 18.612198], [-68.689316, 18.205142], [-69.164946, 18.422648],
  [-69.623988, 18.380713], [-69.952934, 18.428307], [-70.133233, 18.245915], [-70.517137, 18.184291],
  [-70.669298, 18.426886], [-70.999951, 18.283329], [-71.40021, 17.598564], [-71.657662, 17.757573],
  [-71.708305, 18.044997], [-71.687738, 18.31666], [-71.945112, 18.6169], [-71.701303, 18.785417],
  [-71.624873, 19.169838], [-71.712361, 19.714456],
];

/** Encuadre del mapa para mostrar todo el país: [[sur, oeste], [norte, este]]. */
export const DR_MAP_VIEW: [[number, number], [number, number]] = [[17.45, -72.05], [20.05, -68.2]];

export function isInsideDominicanRepublic(lat: number, lng: number): boolean {
  if (lat < DR_BOUNDS.minLat || lat > DR_BOUNDS.maxLat || lng < DR_BOUNDS.minLng || lng > DR_BOUNDS.maxLng) return false;

  let inside = false;
  for (let i = 0, j = DR_COUNTRY_BOUNDARY.length - 1; i < DR_COUNTRY_BOUNDARY.length; j = i++) {
    const [xi, yi] = DR_COUNTRY_BOUNDARY[i];
    const [xj, yj] = DR_COUNTRY_BOUNDARY[j];
    const crosses = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
