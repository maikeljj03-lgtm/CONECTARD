import * as L from 'leaflet';
import { REPORT_CATEGORIES } from '../../../core/constants/catalogs';
import type { PublicReport } from '../../../core/models/report.model';
import { ICON_PATHS, type IconName } from '../../../shared/components/icon/icons';
import { STATUS_COLORS } from '../../../shared/components/community-scene/community-scene.component';
import { clusterSize, statusRing } from './clustering';

// Íconos de los marcadores (RF-18): el color indica el ESTADO y el dibujo, la CATEGORÍA.
// El HTML se arma solo con datos fijos de la app (colores, íconos y números); nada que
// haya escrito un usuario se inserta como HTML.

export const STATUS_ORDER = ['reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado'];

function categoryIcon(category: string): IconName {
  const icon = REPORT_CATEGORIES.find((item) => item.value === category)?.icon ?? 'more';
  return (icon in ICON_PATHS ? icon : 'more') as IconName;
}

function svg(icon: IconName): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[icon]}</svg>`;
}

const safeColor = (status: string) => STATUS_COLORS[status] ?? STATUS_COLORS['reportado'];

export function reportIcon(report: PublicReport, isNew = false): L.DivIcon {
  return L.divIcon({
    className: `explore-marker${isNew ? ' is-new' : ''}`,
    html: `<span style="--marker:${safeColor(report.status)}">${svg(categoryIcon(report.category))}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

export function clusterIcon(reports: PublicReport[]): L.DivIcon {
  const counts: Record<string, number> = {};
  for (const report of reports) counts[report.status] = (counts[report.status] ?? 0) + 1;
  const count = reports.length;
  // Tamaño según la cantidad, con tope para no tapar el mapa.
  const size = clusterSize(count);
  const label = count > 999 ? `${Math.floor(count / 1000)}k` : String(count);
  return L.divIcon({
    className: 'explore-cluster',
    html: `<span style="--ring:${statusRing(counts, STATUS_COLORS, STATUS_ORDER)};--size:${size}px"><b>${label}</b></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
