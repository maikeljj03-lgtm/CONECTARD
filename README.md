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
8. Para tener un administrador que revise verificaciones, ejecuta en el SQL Editor (cambiando el correo):

   ```sql
   update public.profiles set role = 'administrator', verification_status = 'approved'
   where id = (select id from auth.users where email = 'correo-del-admin@ejemplo.com');
   ```

   Ese usuario verá **Administración** en la barra superior (`/admin`). Desde ahí, en **Usuarios y roles**, puede nombrar a otros administradores sin volver a usar SQL.

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
