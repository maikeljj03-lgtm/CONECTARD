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
2. En **Authentication → Sign In / Providers**, activa **Confirm email**. Supabase rechazará el inicio de sesión por correo y contraseña hasta confirmar la dirección.
3. Para Google, habilita el proveedor Google en esa misma sección y configura sus credenciales OAuth.
4. En **Authentication → URL Configuration**, permite `http://localhost:8100/auth/login` y `http://localhost:8100/landing` como URL de retorno. Al publicar la app, añade las URL equivalentes de producción.
5. En Google Cloud, configura como URI de retorno autorizada la URL de callback que muestra Supabase para el proveedor Google.
5b. Para Facebook (RF-01):
   - En [developers.facebook.com](https://developers.facebook.com) crea una app de tipo **Consumidor** (o "Autenticar y solicitar datos a los usuarios con el inicio de sesión con Facebook").
   - En **Inicio de sesión con Facebook → Configuración**, pega en **URI de redireccionamiento de OAuth válidos** la URL de callback que muestra Supabase en el proveedor Facebook (termina en `/auth/v1/callback`).
   - En **Configuración de la app → Básica** copia el **Identificador de la app** y la **Clave secreta**.
   - En Supabase, **Authentication → Sign In / Providers → Facebook**: actívalo y pega esos dos valores.
   - Mientras la app de Facebook esté en modo **Desarrollo**, solo pueden entrar las cuentas agregadas como administradores, desarrolladores o evaluadores. Para abrirla a todo el público hay que pasarla a modo **Activo** (Facebook pide una URL de política de privacidad).
6. Ejecuta también, si todavía no se aplicó, [supabase/migrations/20261102010000_prevent_self_assigned_roles.sql](supabase/migrations/20261102010000_prevent_self_assigned_roles.sql) para proteger los roles solicitados durante el registro.

7. Ejecuta, en este orden, las migraciones de perfil, verificación y reportes:
   - [20261111000000_profile_editing.sql](supabase/migrations/20261111000000_profile_editing.sql): edición de perfil y bucket `avatars` para fotos (RF-05).
   - [20261111010000_organization_verification.sql](supabase/migrations/20261111010000_organization_verification.sql): solicitudes de verificación, bucket privado `verification-documents` y revisión por administradores (RF-06).
   - [20261111020000_reports_anonymous.sql](supabase/migrations/20261111020000_reports_anonymous.sql): tabla `reports` y vista pública `public_reports`, que nunca muestra el autor de un reporte anónimo (RF-07).
8. Para tener un administrador que revise verificaciones, ejecuta en el SQL Editor (cambiando el correo):

   ```sql
   update public.profiles set role = 'administrator', verification_status = 'approved'
   where id = (select id from auth.users where email = 'correo-del-admin@ejemplo.com');
   ```

   Ese usuario verá la opción **Verificaciones** en la barra superior (`/admin/verificaciones`).

La confirmación del correo se activa en el panel de Supabase, no con SQL. El SQL de perfiles enlaza cada perfil con una cuenta de `auth.users`; no crea una forma alternativa de iniciar sesión. El correo integrado de Supabase usa el enlace predeterminado mientras el panel no permita editar la plantilla.

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
│       ├── landing/      página principal pública (+ landing.content.ts: textos y datos de ejemplo)
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
