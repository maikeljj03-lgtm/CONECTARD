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

## Estructura principal

- `src/app/core/`: servicios y guardas compartidos, incluida la integración de autenticación con Supabase.
- `src/app/features/auth/pages/`: inicio de sesión, registro, verificación y recuperación de contraseña.
- `src/app/features/landing/pages/`: página principal, mapa y secciones comunitarias.
- `src/app/features/profile/`, `verification/`, `reports/`, `admin/`: Mi perfil, verificación de organizaciones, nuevo reporte y revisión de solicitudes.
- `src/app/core/data/`: servicios de datos (perfiles, verificación, reportes) y catálogos (provincias, categorías).
- `src/styles/`: estilos globales de páginas y librerías visuales.
- `src/app/app-routing.module.ts`: rutas de la aplicación.
- `supabase/migrations/`: esquema y políticas de seguridad de la base de datos.
- `scripts/`: preparación de la configuración local y ejecución de Ionic.

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
