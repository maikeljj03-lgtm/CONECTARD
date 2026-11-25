# ConectaRD

Aplicación web desarrollada con Ionic y Angular para conectar a las personas con iniciativas y necesidades de sus comunidades en República Dominicana.

## Requisitos

- Node.js y npm instalados.
- Acceso al proyecto de Supabase de ConectaRD.

## Preparar el proyecto

Desde PowerShell, en la carpeta del proyecto:

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Abre `.env` y reemplaza los valores de ejemplo con la URL del proyecto Supabase y su clave publicable:

```env
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_TU_CLAVE
```

`.env` contiene configuración local y está excluido de Git. No agregues claves secretas o `service_role` a la aplicación ni al repositorio.

## Ejecutar localmente

```powershell
npm.cmd start
```

Abre [http://localhost:8100](http://localhost:8100). Para comprobar una compilación de producción:

```powershell
npm.cmd run build
```

## Configurar Supabase

1. En el panel del proyecto, abre **SQL Editor** y ejecuta una vez la migración [supabase/migrations/20261102000000_create_profiles.sql](supabase/migrations/20261102000000_create_profiles.sql).
2. En **Authentication → Sign In / Providers → Email**, **desactiva Confirm email**. El registro no pide código: la cuenta se crea y se pasa al login. El correo se comprueba con el código que se envía la **primera vez que la cuenta entra desde cada dispositivo**; después ese dispositivo queda recordado 90 días.
3. Para Google, habilita el proveedor Google en esa misma sección y configura sus credenciales OAuth.
4. En **Authentication → URL Configuration**, permite `http://localhost:8100/auth/login` y `http://localhost:8100/landing` como URL de retorno. Al publicar la app, añade las URL equivalentes de producción.
5. En Google Cloud, configura como URI de retorno autorizada la URL de callback que muestra Supabase para el proveedor Google.
5b. Otras redes sociales: ver [Redes sociales](#redes-sociales-rf-01) más abajo.
6. Ejecuta también, si todavía no se aplicó, [supabase/migrations/20261102010000_prevent_self_assigned_roles.sql](supabase/migrations/20261102010000_prevent_self_assigned_roles.sql) para proteger los roles solicitados durante el registro.

7. Ejecuta, en este orden, las migraciones de perfil, verificación y reportes:
   - [20261111000000_profile_editing.sql](supabase/migrations/20261111000000_profile_editing.sql): edición de perfil y bucket `avatars` para fotos (RF-05).
   - [20261111010000_organization_verification.sql](supabase/migrations/20261111010000_organization_verification.sql): solicitudes de verificación, bucket privado `verification-documents` y revisión por administradores (RF-06).
   - [20261111020000_reports_anonymous.sql](supabase/migrations/20261111020000_reports_anonymous.sql): tabla `reports` y vista pública `public_reports`, que nunca muestra el autor de un reporte anónimo (RF-07).
   - [20261112000000_roles_permissions.sql](supabase/migrations/20261112000000_roles_permissions.sql): roles y permisos (RF-03): aprobar voluntarios, cambiar roles desde el panel y permitir que instituciones cambien el estado de los reportes.
   - [20261113000000_report_media.sql](supabase/migrations/20261113000000_report_media.sql): fotos y videos de los reportes (RF-10, RF-11, RF-12): bucket público `report-media` y tabla `report_media`. Los archivos se guardan por id de reporte, nunca por usuario, para no romper el anonimato.
   - [20261114000000_report_lifecycle.sql](supabase/migrations/20261114000000_report_lifecycle.sql): ciclo de vida del reporte (RF-15, RF-16, RF-17): editar o eliminar el reporte propio durante 24 horas (`update_own_report`, `delete_own_report`), cambio de estado con historial público (`set_report_status`, `public_report_history`; la institución solo en su jurisdicción y el administrador solo rechaza o restaura) y evidencia "Antes y Después" (`report_evidence`, carpeta `<reporte>/evidencia/`). Reemplaza a `update_report_status`.
   - [20261115000000_realtime_map.sql](supabase/migrations/20261115000000_realtime_map.sql): mapa en tiempo real y filtros (RF-18, RF-20): avisa por el canal público de Realtime `public-reports` cada vez que se crea, cambia o elimina un reporte (solo envía el id; la app vuelve a leer la vista pública), añade índices para los filtros y búsqueda sin distinguir tildes (extensión `unaccent`).
   - [20261116000000_community.sql](supabase/migrations/20261116000000_community.sql): módulo 4 (RF-23 a RF-31): apoyos "Me afecta" (`toggle_report_support`), comentarios con respuestas (`add/edit/delete_report_comment`, vista `public_report_comments` que no revela al autor de un reporte anónimo), "Sumarme como voluntario" (`toggle_report_volunteer`; la ONG participante puede marcar "En proceso" o "Resuelto"), jornadas comunitarias con pase de lista por QR (`community_events`, `event_attendees`, `check_in_event`; el código del QR nunca es público) e insumos con registro público de donaciones y su uso (`resource_requests`, `resource_donations`, `resource_usages`; no se puede registrar más uso del recibido).
   - [20261117000000_hardening.sql](supabase/migrations/20261117000000_hardening.sql): depuración completa (160 pruebas de flujos por rol). Arregla que **ninguna subida de archivos funcionaba** (una política de storage leía una columna sin permiso y bloqueaba todas), que ONG e instituciones no podían pedir insumos, ligar reportes a jornadas ni subir evidencia, que el autor de un reporte anónimo quedaba expuesto al sumarse o pedir insumos, y que cualquiera sin sesión podía enviar avisos falsos al mapa en vivo (Supabase concede EXECUTE a `anon` aunque se haga `revoke ... from public`).
   - [20261118000000_engagement.sql](supabase/migrations/20261118000000_engagement.sql): módulo 5 (RF-32 a RF-38): filtro de lenguaje ofensivo aplicado por la base de datos (`blocked_terms`), centro de notificaciones en tiempo real (`notifications`, creadas por disparadores), puntos y medallas con protección contra trampas (`point_events`, `user_badges`, `my_progress`), ranking público (`leaderboard`), denuncias y bandeja de moderación (`flag_content`, `admin_flag_queue`, `resolve_flags`) y datos del resumen semanal (`weekly_digest_rows`, solo `service_role`). El envío del correo semanal está en `supabase/functions/weekly-digest` (ver instrucciones dentro del archivo).
   - [20261119000000_admin_console.sql](supabase/migrations/20261119000000_admin_console.sql): consola de administración (RF-39 a RF-43, RF-52): bloqueo de cuentas que impide publicar y también iniciar sesión (`admin_set_user_block`, `banned_until`), registro de auditoría inalterable escrito por disparadores (`admin_audit_log`, `admin_audit_entries`), listas paginadas de usuarios y reportes con el autor real de los anónimos (`admin_users_page`, `admin_reports_page`, `admin_user_detail`) y resumen con series diarias, categorías, provincias y tiempo de respuesta por institución (`admin_dashboard`).
   - [20261120000000_assignment_ai.sql](supabase/migrations/20261120000000_assignment_ai.sql): módulos 6 y 7. RF-42: cada reporte se asigna solo a la institución responsable según provincia, municipio y categoría (gana la más específica; si empatan, la de menos carga), con aviso a la institución, reasignación manual (`admin_assign_report`) y zona de atención editable por la administración (`admin_set_institution_scope`, `admin_institutions`); solo la institución asignada gestiona el reporte. RF-45: reportes parecidos a menos de 150 m (`nearby_similar_reports`, que la app muestra antes de enviar), marca automática de posible duplicado y unión con el original que traslada apoyos y voluntarios (`admin_resolve_duplicate`). RF-46: huella de cada foto y datos de cámara calculados en el teléfono; las fotos repetidas de otra persona o sin datos de cámara quedan marcadas para la moderación (`media_flags`). RF-44 y RF-47: límite diario de uso de la inteligencia artificial (`consume_ai_quota`).
   - [20261121000000_platform.sql](supabase/migrations/20261121000000_platform.sql): módulo 8. RF-51: teléfonos de contacto y ubicaciones de las alertas cifrados con AES-256 (pgcrypto) con una clave guardada en Supabase Vault (`conectard_data_key`); el teléfono completo solo lo ve un administrador y queda en la auditoría (`admin_contact_phone`). RF-53: si una cuenta de administración o de institución activa la verificación en dos pasos, sus permisos especiales exigen la sesión verificada (`mfa_satisfied`, aal2). RF-57: estadísticas abiertas (`public_stats`). RF-58: sensores IoT con clave propia (solo se guarda su huella SHA-256) que crean un reporte cuando una medición pasa el límite (`iot_submit_reading`). RF-59: zonas catastrales importadas en GeoJSON y tipo de terreno de cada reporte (`admin_import_cadastral_zones`, `land_status`). RF-61: alertas por radio de distancia (`save_alert_subscription`). RF-62: constancias de voluntariado verificables (`issue_volunteer_certificate`, `verify_certificate`). RF-63: encuesta de satisfacción al resolverse un reporte (`submit_report_survey`, `admin_satisfaction`). Además, el filtro de lenguaje ofensivo reconoce los plurales.
8. Para tener un administrador que revise verificaciones, ejecuta en el SQL Editor (cambiando el correo):

   ```sql
   update public.profiles set role = 'administrator', verification_status = 'approved'
   where id = (select id from auth.users where email = 'correo-del-admin@ejemplo.com');
   ```

   Ese usuario verá **Administración** en la barra superior (`/admin`). Desde ahí, en **Usuarios y roles**, puede nombrar a otros administradores sin volver a usar SQL.

### Inteligencia artificial (RF-44 y RF-47)

La sugerencia de categoría a partir de la foto (`supabase/functions/classify-report-photo`) y el asistente (`supabase/functions/assistant-chat`) usan Claude (modelo `claude-opus-5-5`) desde funciones de Supabase. La clave nunca llega a la app: se guarda como secreto del servidor. Para activarlas, con la [CLI de Supabase](https://supabase.com/docs/guides/cli) enlazada al proyecto:

```bash
supabase secrets set ANTHROPIC_API_KEY=<tu clave de console.anthropic.com>
supabase functions deploy classify-report-photo
supabase functions deploy assistant-chat
```

Mientras no estén desplegadas, la app no muestra la sugerencia y el asistente avisa que todavía no está activado; el resto de la app funciona igual. Cada persona tiene un límite diario de 30 fotos analizadas y 40 mensajes. El modelo se cambia en `AI_MODEL` de `supabase/functions/_shared/conectard-ai.ts`.

### Plataforma (módulo 8)

- **App instalable y sin conexión (RF-48, RF-60):** la versión publicada (`npm.cmd run build`) incluye el service worker de Angular (`ngsw-config.json`) y el manifiesto (`src/manifest.webmanifest`). Guarda la app, el mapa, las fotos y los reportes públicos para abrir más rápido y verlos sin conexión. En Ajustes está el botón "Instalar" y el modo "Ahorro de datos". En `npm start` (desarrollo) el service worker está apagado a propósito.
- **Tema, idioma y accesibilidad (RF-49, RF-54, RF-56):** tema claro, oscuro o del sistema; español, inglés y creole haitiano (`src/app/core/i18n/messages.ts`); enlace "Saltar al contenido", foco visible, movimiento reducido y contraste AA comprobado con axe-core en las pantallas principales.
- **Dictado por voz (RF-55):** botón "Dictar" en la descripción del reporte (usa el reconocimiento de voz del navegador; si no lo tiene, el botón no aparece).
- **API de datos abiertos (RF-57):** `supabase functions deploy public-api --no-verify-jwt`. La documentación está en `/datos-abiertos` y la especificación en `<proyecto>/functions/v1/public-api/v1/openapi.json`.
- **Sensores (RF-58):** se registran en Consola → Sensores (la clave se muestra una sola vez). Cada sensor envía sus mediciones así:

  ```bash
  curl -X POST "https://<proyecto>.supabase.co/rest/v1/rpc/iot_submit_reading" \
    -H "apikey: <clave pública>" -H "Content-Type: application/json" \
    -d '{"device_token":"crd_iot_...","reading":42}'
  ```

- **Catastro (RF-59):** Consola → Catastro, subir un GeoJSON oficial (FeatureCollection de polígonos con la propiedad `tipo`: público, privado o protegido).
- **Copias de seguridad (RF-65):** `.github/workflows/backup.yml` hace cada día un volcado cifrado (AES-256) de la base de datos y lo guarda 30 días en GitHub. Necesita los secretos `SUPABASE_DB_URL` y `BACKUP_PASSPHRASE` (ver las instrucciones dentro del archivo, incluida la restauración).

La confirmación del correo se activa en el panel de Supabase, no con SQL. El SQL de perfiles enlaza cada perfil con una cuenta de `auth.users`; no crea una forma alternativa de iniciar sesión. El correo integrado de Supabase usa el enlace predeterminado mientras el panel no permita editar la plantilla.

## Redes sociales (RF-01)

La pantalla de acceso muestra **solo las redes activadas** en Supabase (las consulta en `/auth/v1/settings`). Al activar una red en Supabase, su botón aparece solo, sin tocar código. Si se pulsa una red que no está activada, la app muestra un aviso en lugar de ir a la página de error de Supabase.

Todas usan la misma **URL de callback**, que Supabase muestra al abrir cualquier proveedor en **Authentication → Sign In / Providers** (tiene la forma `https://<tu-proyecto>.supabase.co/auth/v1/callback`). En cada red hay que registrarla como URL de redirección.

| Red | Dónde se crea la app | Qué se pega en Supabase | A tener en cuenta |
|---|---|---|---|
| **Google** | Google Cloud → APIs y servicios → Credenciales → ID de cliente OAuth (aplicación web) | Client ID y Client Secret | Ya está activado. |
| **Apple** | [developer.apple.com](https://developer.apple.com) → Identifiers (App ID + **Services ID**) y Keys (clave de *Sign in with Apple*) | Services ID, Team ID, Key ID y la clave `.p8` | Requiere la membresía de Apple Developer (de pago). |
| **Microsoft** | [portal.azure.com](https://portal.azure.com) → App registrations → New registration (cuentas personales y de organizaciones) → Certificates & secrets | Application (client) ID, el *secret* y la URL `https://login.microsoftonline.com/common` | En Supabase el proveedor se llama **Azure**. |
| **LinkedIn** | [linkedin.com/developers](https://www.linkedin.com/developers) → Create app (pide una página de LinkedIn) → Products → **Sign In with LinkedIn using OpenID Connect** → Auth | Client ID y Client Secret | En Supabase el proveedor se llama **LinkedIn (OIDC)**. |
| **Facebook, X e Instagram** | — | — | **Retiradas.** Facebook y X se quitaron por decisión del equipo; Instagram no existe en Supabase. Para volver a agregar Facebook o X basta con añadirlas en `core/constants/social-providers.ts` y activarlas en Supabase. |

Las cuentas creadas con cualquier red social empiezan con perfil de **ciudadano**.

Cuando una red pida **URL de política de privacidad** o **de términos**, usa las páginas públicas de la app: `https://<tu-dominio>/privacidad` y `https://<tu-dominio>/terminos`. Deben ser direcciones publicadas en internet: las redes no aceptan `localhost`.

## Estructura del proyecto

```
src/
├── app/
│   ├── app.module.ts, app-routing.module.ts   Arranque y rutas principales (cada sección se carga al visitarla)
│   ├── core/                                  Lo que existe una sola vez en toda la app
│   │   ├── services/     auth, perfiles, reportes y verificación (conexión con Supabase)
│   │   ├── guards/       authGuard (páginas privadas) y sessionGuard (páginas públicas)
│   │   ├── models/       tipos de datos: Profile, Report, VerificationRequest
│   │   ├── constants/    catálogos (categorías, estados, roles) y geografía (provincias, límites de RD)
│   │   └── utils/        mensajes de error en español
│   ├── shared/                                Piezas reutilizables por cualquier sección
│   │   ├── components/   icon, logo, skyline (silueta) y topbar (barra superior)
│   │   ├── validators/   validadores de formularios
│   │   └── shared.module.ts
│   └── features/                              Una carpeta por sección, con su módulo y sus rutas
│       ├── landing/      página pública para quien no tiene cuenta (+ landing.content.ts: textos)
│       ├── home/         inicio con sesión (/inicio): maqueta 3D, cifras y reportes cercanos
│       ├── explore/      Explorar (/explorar, pública): mapa y lista con filtros
│       ├── auth/         login, registro, códigos y recuperación (+ auth.constants.ts)
│       ├── profile/      Mi perfil (RF-05)
│       ├── verification/ verificación de organizaciones (RF-06)
│       ├── reports/      nuevo reporte (RF-07)
│       └── admin/        revisión de verificaciones
├── theme/_tokens.scss    Colores, tipografías, radios y sombras (variables CSS)
├── styles/               Estilos compartidos por las páginas internas
├── global.scss           Punto de entrada de los estilos globales
└── assets/               Imágenes (licencias en images/README.md) e iconos
supabase/
├── migrations/           Cambios de la base de datos, en orden
├── setup-completo.sql    Todas las migraciones juntas (generado con npm.cmd run supabase:setup)
└── templates/            Plantillas de correo
scripts/                  Utilidades: arrancar el servidor, sincronizar .env y generar el SQL
docs/design/              Bocetos y material de diseño
```

**Convenciones**
- Cada componente tiene sus archivos `.ts`, `.html` y `.scss` en su propia carpeta.
- Una página nueva va en `features/<sección>/pages/<página>/` y se declara en el módulo de su sección.
- Un servicio que usan varias secciones va en `core/services/`; sus tipos, en `core/models/`.
- Los textos fijos y los datos de ejemplo van en archivos aparte (`*.content.ts`, `*.constants.ts`), no dentro del componente.
- Para cambiar la base de datos, crea una migración nueva en `supabase/migrations/` (no edites las ya aplicadas) y ejecuta `npm.cmd run supabase:setup`.

## Colaborar

Antes de empezar a trabajar, actualiza tu copia local:

```powershell
git pull origin main
```

Después de hacer y guardar cambios, súbelos con un mensaje que describa el cambio:

```powershell
git add .
git commit -m "Describe el cambio"
git push
```
