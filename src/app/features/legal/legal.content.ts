// Textos legales de ConectaRD (RF-50). Describen lo que la app hace hoy con los datos.
// IMPORTANTE: son una base redactada por el equipo; antes del lanzamiento público
// deben revisarse con asesoría legal. Si cambia cómo se tratan los datos, actualizar aquí.

export interface LegalSection {
  id: string;
  title: string;
  /** Párrafos. */
  body?: string[];
  /** Lista de puntos (se muestra después de los párrafos). */
  items?: string[];
}

export interface LegalDocument {
  kind: 'terminos' | 'privacidad';
  title: string;
  summary: string;
  updatedAt: string;
  sections: LegalSection[];
}

/**
 * Correo para ejercer derechos y hacer consultas legales.
 * PENDIENTE: definir un correo real del proyecto. Mientras esté vacío, la página lo indica.
 */
export const LEGAL_CONTACT_EMAIL = '';

const UPDATED_AT = '11 de noviembre de 2026';

export const PRIVACY_POLICY: LegalDocument = {
  kind: 'privacidad',
  title: 'Política de privacidad',
  summary: 'Qué datos recoge ConectaRD, para qué los usa, quién puede verlos y cómo ejercer tus derechos según la Ley 172-13 de República Dominicana.',
  updatedAt: UPDATED_AT,
  sections: [
    {
      id: 'responsable',
      title: '1. Quién es responsable de tus datos',
      body: [
        'ConectaRD es una plataforma ciudadana para reportar problemas de la comunidad y coordinar su solución entre ciudadanos, voluntarios, organizaciones e instituciones públicas de República Dominicana.',
        'El equipo de ConectaRD es responsable del tratamiento de los datos personales que se recogen en la plataforma, conforme a la Ley núm. 172-13 sobre protección integral de los datos personales.',
      ],
    },
    {
      id: 'datos',
      title: '2. Qué datos recogemos',
      items: [
        'Datos de la cuenta: nombre completo, correo electrónico y contraseña. La contraseña se guarda cifrada; nadie del equipo puede leerla.',
        'Si entras con una red social (por ejemplo, Google): el nombre, el correo y la foto que esa red comparta con nosotros. No recibimos tu contraseña de esa red.',
        'Datos de perfil que decidas completar: foto, provincia, municipio, sector y una biografía breve.',
        'El tipo de participación que solicitas (ciudadano, voluntario, organización o institución) y la fecha en que aceptaste estos documentos.',
        'Si solicitas verificar una organización o institución: nombre y tipo de la entidad, RNC, persona responsable, teléfono, zona de cobertura y los documentos oficiales que adjuntes.',
        'Reportes: título, descripción, categoría, ubicación (coordenadas y referencia), provincia, municipio, sector y, más adelante, las fotos que adjuntes.',
        'Datos técnicos necesarios para mantener tu sesión iniciada de forma segura.',
      ],
    },
    {
      id: 'finalidad',
      title: '3. Para qué usamos tus datos',
      items: [
        'Crear y proteger tu cuenta, y confirmar tu correo con un código.',
        'Publicar los reportes que crees y mostrarlos en el mapa y en el listado de la comunidad.',
        'Hacer llegar cada reporte a la institución o ayuntamiento responsable y dar seguimiento a su estado.',
        'Verificar que las organizaciones e instituciones son quienes dicen ser antes de darles permisos especiales.',
        'Moderar el contenido, prevenir abusos y reportes falsos.',
        'Avisarte de cambios en tus reportes y de actividad relevante de tu comunidad.',
        'Elaborar estadísticas agregadas (por ejemplo, reportes resueltos por zona) que no identifican a nadie.',
      ],
      body: ['No vendemos tus datos ni los usamos para publicidad.'],
    },
    {
      id: 'publico',
      title: '4. Qué es público y qué no',
      body: [
        'Los reportes son públicos: cualquier persona puede ver su título, descripción, categoría, ubicación y estado.',
        'Junto a un reporte se muestran tu nombre y tu foto de perfil, salvo que elijas publicarlo de forma anónima.',
        'Reportes anónimos: tu nombre y tu foto no se muestran a nadie. La plataforma conserva internamente quién creó el reporte para evitar abusos; solo pueden verlo los administradores y solo para moderación o por requerimiento de una autoridad competente.',
        'Nunca se muestran públicamente tu correo, tu teléfono ni los documentos de verificación. Los documentos solo los ven los administradores encargados de revisarlos.',
      ],
    },
    {
      id: 'terceros',
      title: '5. Servicios de terceros que intervienen',
      items: [
        'Supabase: aloja la base de datos, la autenticación y los archivos. Sus servidores pueden estar fuera de República Dominicana, por lo que tus datos pueden transferirse y almacenarse en el extranjero con medidas de seguridad equivalentes.',
        'Redes sociales (Google y las demás que estén disponibles en la pantalla de acceso): solo si eliges entrar con ellas. Cada una tiene su propia política de privacidad.',
        'OpenStreetMap: muestra el mapa. Al cargarlo, tu navegador solicita las imágenes del mapa a sus servidores.',
        'Google Fonts: proporciona las tipografías de la aplicación.',
        'Servicio de correo electrónico: envía los códigos de verificación y avisos.',
      ],
    },
    {
      id: 'conservacion',
      title: '6. Cuánto tiempo guardamos los datos',
      body: [
        'Conservamos tus datos mientras tu cuenta esté activa. Si la eliminas, borramos tu perfil y tus datos personales.',
        'Los reportes pueden mantenerse publicados sin datos que te identifiquen, porque forman parte del historial de la comunidad y de las estadísticas de transparencia.',
        'Los documentos de verificación se conservan mientras la organización o institución esté activa en la plataforma.',
      ],
    },
    {
      id: 'derechos',
      title: '7. Tus derechos',
      body: ['De acuerdo con la Ley 172-13 puedes, en cualquier momento:'],
      items: [
        'Acceder a los datos personales que tenemos sobre ti.',
        'Rectificar los datos que sean incorrectos o estén incompletos (la mayoría puedes corregirlos tú desde “Mi perfil”).',
        'Cancelar o suprimir tus datos y tu cuenta.',
        'Oponerte a un tratamiento concreto de tus datos.',
        'Retirar tu consentimiento, sin que eso afecte lo realizado antes de retirarlo.',
      ],
    },
    {
      id: 'seguridad',
      title: '8. Seguridad',
      body: [
        'Toda la comunicación con la plataforma viaja cifrada (HTTPS). La base de datos aplica reglas que impiden que una persona lea o modifique datos de otra, y los documentos de verificación se guardan en un almacenamiento privado.',
        'Ningún sistema es infalible. Si detectamos un incidente que afecte tus datos, te lo comunicaremos y tomaremos las medidas necesarias.',
      ],
    },
    {
      id: 'menores',
      title: '9. Menores de edad',
      body: [
        'Las personas menores de 18 años deben usar ConectaRD con la autorización de su madre, padre o tutor. Si eres tutor y crees que un menor nos dio datos sin autorización, escríbenos para eliminarlos.',
      ],
    },
    {
      id: 'cambios',
      title: '10. Cambios en esta política',
      body: [
        'Si cambiamos esta política te avisaremos dentro de la plataforma. La fecha de la última actualización aparece al inicio de esta página.',
      ],
    },
  ],
};

export const TERMS_OF_USE: LegalDocument = {
  kind: 'terminos',
  title: 'Términos de uso',
  summary: 'Las reglas para usar ConectaRD: qué ofrece la plataforma, qué se espera de cada persona y qué ocurre con el contenido que publicas.',
  updatedAt: UPDATED_AT,
  sections: [
    {
      id: 'servicio',
      title: '1. Qué es ConectaRD',
      body: [
        'ConectaRD es una plataforma gratuita para reportar problemas de la comunidad (basura, baches, alumbrado, agua, áreas verdes, seguridad, educación y otros), apoyar los reportes de otras personas y coordinar su solución con voluntarios, organizaciones e instituciones públicas.',
        'Al crear una cuenta o usar la plataforma aceptas estos términos y la Política de privacidad.',
      ],
    },
    {
      id: 'emergencias',
      title: '2. ConectaRD no es un servicio de emergencias',
      body: [
        'Si hay peligro para la vida, la salud o la seguridad de alguien, llama al Sistema Nacional de Atención a Emergencias 9-1-1. Los reportes de ConectaRD no se atienden en tiempo real ni sustituyen a los servicios de emergencia.',
      ],
    },
    {
      id: 'cuenta',
      title: '3. Tu cuenta',
      items: [
        'Debes dar datos verdaderos y mantener tu correo actualizado.',
        'Eres responsable de lo que se haga con tu cuenta. No compartas tu contraseña ni los códigos de verificación.',
        'Las personas menores de 18 años necesitan la autorización de su madre, padre o tutor.',
        'Puedes eliminar tu cuenta cuando quieras.',
      ],
    },
    {
      id: 'roles',
      title: '4. Perfiles y verificación',
      body: [
        'Todas las cuentas empiezan con perfil de ciudadano. Los perfiles de voluntario, organización e institución pública se conceden después de una revisión; las organizaciones e instituciones deben aportar documentación oficial.',
        'Podemos rechazar o retirar un perfil verificado si la información resulta falsa o si se usa de forma indebida.',
      ],
    },
    {
      id: 'uso',
      title: '5. Uso aceptable',
      body: ['Al usar ConectaRD te comprometes a no:'],
      items: [
        'Publicar reportes falsos, exagerados a propósito o duplicados con mala intención.',
        'Publicar contenido ofensivo, discriminatorio, violento, sexual o que incite al odio.',
        'Acusar, señalar o exponer a personas concretas, ni publicar datos personales de terceros (nombres, teléfonos, rostros identificables, placas, etc.).',
        'Suplantar a otra persona, organización o institución.',
        'Usar la plataforma para propaganda política o partidista, publicidad o fines comerciales.',
        'Intentar acceder a cuentas o datos ajenos, o interferir con el funcionamiento de la plataforma.',
      ],
    },
    {
      id: 'contenido',
      title: '6. El contenido que publicas',
      body: [
        'Sigues siendo responsable de lo que publicas y debes tener derecho a publicarlo (por ejemplo, las fotos deben ser tuyas o contar con permiso).',
        'Al publicar un reporte, autorizas a ConectaRD a mostrarlo públicamente, a compartirlo con la institución responsable de resolverlo y a usarlo, sin datos que te identifiquen, en estadísticas y datos abiertos sobre la comunidad.',
        'Si publicas de forma anónima, tu nombre no se mostrará, pero sigues siendo responsable del contenido.',
      ],
    },
    {
      id: 'moderacion',
      title: '7. Moderación',
      body: [
        'Cualquier persona puede denunciar contenido inapropiado. El equipo de moderación puede ocultar o eliminar reportes y comentarios que incumplan estos términos, marcar reportes como rechazados indicando el motivo, y suspender o cerrar cuentas que los incumplan de forma grave o repetida.',
      ],
    },
    {
      id: 'responsabilidad',
      title: '8. Alcance y responsabilidad',
      items: [
        'ConectaRD facilita que los reportes lleguen a quien puede resolverlos, pero no garantiza que una institución los atienda ni en qué plazo; la solución depende de cada responsable.',
        'La información de los reportes la publican las personas usuarias; ConectaRD no garantiza su exactitud.',
        'Hacemos lo posible por mantener la plataforma disponible y segura, pero puede haber interrupciones por mantenimiento o causas ajenas.',
      ],
    },
    {
      id: 'cambios',
      title: '9. Cambios en estos términos',
      body: [
        'Podemos actualizar estos términos. Te avisaremos dentro de la plataforma y, si los cambios son importantes, te pediremos aceptarlos de nuevo.',
      ],
    },
    {
      id: 'ley',
      title: '10. Ley aplicable',
      body: [
        'Estos términos se rigen por las leyes de la República Dominicana.',
      ],
    },
  ],
};
