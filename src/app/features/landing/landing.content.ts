// Contenido y datos de ejemplo de la landing. Separado del componente para
// editar textos sin tocar la lógica.

// Categorías (RF-09) y estados del ciclo de vida (RF-16) según la propuesta.
export type ReportCategory = 'Basura y limpieza' | 'Baches y vías' | 'Alumbrado' | 'Agua y alcantarillado' | 'Áreas verdes' | 'Seguridad' | 'Educación' | 'Otros';
export type ReportStatus = 'Reportado' | 'En revisión' | 'En proceso' | 'Resuelto' | 'Rechazado';
export type CategoryFilter = 'Todas' | ReportCategory;

export interface CategoryInfo { name: ReportCategory; icon: string; description: string; }

export interface SampleReport {
  id: number;
  title: string;
  category: ReportCategory;
  sector: string;
  municipality: string;
  age: string;
  status: ReportStatus;
  supports: number;
  lat: number;
  lng: number;
}

export const STATUS_COLORS: Record<ReportStatus, string> = {
  'Reportado': '#8a9693',
  'En revisión': '#4d7fb8',
  'En proceso': '#e9a13b',
  'Resuelto': '#00b2a9',
  'Rechazado': '#d0645a',
};

export const SECTION_IDS = ['inicio', 'como-funciona', 'mapa', 'participa', 'transparencia', 'preguntas'];

export const NAV_ITEMS = [
  { id: 'como-funciona', label: 'Cómo funciona' },
  { id: 'mapa', label: 'Mapa' },
  { id: 'participa', label: 'Participa' },
  { id: 'transparencia', label: 'Transparencia' },
  { id: 'preguntas', label: 'Preguntas' },
];

export const LANDING_CATEGORIES: CategoryInfo[] = [
  { name: 'Basura y limpieza', icon: 'trash', description: 'Vertederos, acumulación, recogida' },
  { name: 'Baches y vías', icon: 'alert', description: 'Hoyos, aceras, señalización' },
  { name: 'Alumbrado', icon: 'lightbulb', description: 'Postes apagados o dañados' },
  { name: 'Agua y alcantarillado', icon: 'droplet', description: 'Fugas, cloacas, falta de agua' },
  { name: 'Áreas verdes', icon: 'leaf', description: 'Parques y espacios descuidados' },
  { name: 'Seguridad', icon: 'shield', description: 'Zonas inseguras o sin vigilancia' },
  { name: 'Educación', icon: 'book', description: 'Escuelas y necesidades educativas' },
  { name: 'Otros', icon: 'more', description: 'Lo que tu comunidad necesite' },
];

/** Reportes de ejemplo para la vista previa del mapa (no son datos reales). */
export const SAMPLE_REPORTS: SampleReport[] = [
  { id: 1, title: 'Hoyo profundo frente a la escuela', category: 'Baches y vías', sector: 'Los Mina', municipality: 'Santo Domingo Este', age: 'Hace 2 h', status: 'En proceso', supports: 38, lat: 18.4975, lng: -69.8549 },
  { id: 2, title: 'Vertedero improvisado en la esquina', category: 'Basura y limpieza', sector: 'Villa Consuelo', municipality: 'Distrito Nacional', age: 'Hace 5 h', status: 'En revisión', supports: 24, lat: 18.4891, lng: -69.9012 },
  { id: 3, title: 'Tres postes de luz apagados', category: 'Alumbrado', sector: 'Los Alcarrizos', municipality: 'Los Alcarrizos', age: 'Hace 1 día', status: 'Resuelto', supports: 51, lat: 18.5165, lng: -70.0105 },
  { id: 4, title: 'Fuga de agua potable en la avenida', category: 'Agua y alcantarillado', sector: 'Los Jardines', municipality: 'Santiago de los Caballeros', age: 'Hace 3 h', status: 'Reportado', supports: 12, lat: 19.4637, lng: -70.6888 },
  { id: 5, title: 'Parque sin mantenimiento', category: 'Áreas verdes', sector: 'Centro', municipality: 'San Francisco de Macorís', age: 'Hace 2 días', status: 'En proceso', supports: 19, lat: 19.2999, lng: -70.2526 },
  { id: 6, title: 'Calle sin iluminación ni vigilancia', category: 'Seguridad', sector: 'Villa Hermosa', municipality: 'La Romana', age: 'Hace 6 h', status: 'En revisión', supports: 33, lat: 18.4296, lng: -68.9636 },
  { id: 7, title: 'Escuela necesita pupitres y pintura', category: 'Educación', sector: 'Pueblo Nuevo', municipality: 'San Juan de la Maguana', age: 'Hace 4 días', status: 'Reportado', supports: 47, lat: 18.8076, lng: -71.2297 },
  { id: 8, title: 'Cañada tapada por desechos', category: 'Basura y limpieza', sector: 'Capotillo', municipality: 'Distrito Nacional', age: 'Hace 1 día', status: 'En proceso', supports: 66, lat: 18.5052, lng: -69.9228 },
  { id: 9, title: 'Badén destruido tras las lluvias', category: 'Baches y vías', sector: 'Centro', municipality: 'Puerto Plata', age: 'Hace 3 días', status: 'Resuelto', supports: 28, lat: 19.7934, lng: -70.6884 },
  { id: 10, title: 'Contenedor en propiedad privada', category: 'Otros', sector: 'El Millón', municipality: 'Distrito Nacional', age: 'Hace 2 días', status: 'Rechazado', supports: 3, lat: 18.4568, lng: -69.9449 },
];

export const LIFECYCLE: { status: ReportStatus; description: string }[] = [
  { status: 'Reportado', description: 'El caso entra con foto, ubicación y categoría.' },
  { status: 'En revisión', description: 'Se valida y se asigna al responsable.' },
  { status: 'En proceso', description: 'La institución o la comunidad trabaja en él.' },
  { status: 'Resuelto', description: 'Se publica la evidencia de antes y después.' },
];

export const ROLES = [
  {
    slug: 'ciudadano', icon: 'user', title: 'Ciudadanos', lead: 'Tu voz con seguimiento.',
    points: ['Reporta con foto y GPS, incluso de forma anónima', 'Apoya con “Me afecta” y comenta', 'Recibe avisos cuando cambia el estado'],
    cta: 'Crear cuenta',
  },
  {
    slug: 'voluntario', icon: 'heart', title: 'Voluntarios', lead: 'Tu tiempo donde más se necesita.',
    points: ['Súmate a la solución de un reporte', 'Asiste a jornadas con registro por QR', 'Obtén constancias de horas de servicio social'],
    cta: 'Quiero ser voluntario',
  },
  {
    slug: 'ong', icon: 'users', title: 'Organizaciones y ONG', lead: 'Coordina sin perder el hilo.',
    points: ['Crea eventos ligados a reportes reales', 'Solicita insumos y gestiona donaciones', 'Publica con transparencia el uso de recursos'],
    cta: 'Registrar organización',
  },
  {
    slug: 'institucion', icon: 'landmark', title: 'Instituciones públicas', lead: 'Reportes ordenados por jurisdicción.',
    points: ['Recibe casos según ubicación y categoría', 'Actualiza estados y sube evidencia', 'Mide y exporta tus tiempos de respuesta'],
    cta: 'Registrar institución',
  },
];

export const FAQS = [
  { q: '¿Cuánto cuesta usar ConectaRD?', a: 'Nada. Reportar, apoyar, comentar y participar como voluntario es gratis para cualquier persona.' },
  { q: '¿Puedo reportar sin mostrar mi nombre?', a: 'Sí. Puedes publicar un reporte de forma anónima: tu identidad no se muestra públicamente, aunque la plataforma la conserva para evitar abusos, conforme a la Ley 172-13.' },
  { q: '¿Quién resuelve los reportes?', a: 'Cada reporte se dirige al ayuntamiento o institución responsable según su ubicación y categoría. Voluntarios y ONG pueden sumarse cuando la solución es comunitaria, como una jornada de limpieza.' },
  { q: '¿Cómo sé si mi reporte avanzó?', a: 'Cada caso tiene un estado público (Reportado, En revisión, En proceso, Resuelto o Rechazado) y recibirás una notificación cada vez que cambie.' },
  { q: '¿Necesito instalar una aplicación?', a: 'No. ConectaRD funciona en el navegador de tu teléfono o computadora y puedes instalarla en la pantalla de inicio como una app.' },
  { q: '¿Cómo se evitan los reportes falsos?', a: 'La comunidad puede denunciar contenido, hay moderación y filtros automáticos, y las organizaciones e instituciones pasan por una verificación con documentos oficiales.' },
];
