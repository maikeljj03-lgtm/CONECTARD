// Contenido y datos de ejemplo de la landing. Separado del componente para
// editar textos sin tocar la lógica.

// Categorías (RF-09) y estados del ciclo de vida (RF-16) según la propuesta.
export type ReportCategory = 'Basura y limpieza' | 'Baches y vías' | 'Alumbrado' | 'Agua y alcantarillado' | 'Áreas verdes' | 'Seguridad' | 'Educación' | 'Otros';
export type ReportStatus = 'Reportado' | 'En revisión' | 'En proceso' | 'Resuelto' | 'Rechazado';

export interface CategoryInfo { name: ReportCategory; icon: string; description: string; }


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
