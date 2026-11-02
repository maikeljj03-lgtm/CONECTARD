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
2. Para autenticación con Google, habilita el proveedor Google en **Authentication → Sign In / Providers** y configura las credenciales OAuth de Google.
3. En **Authentication → URL Configuration**, permite `http://localhost:8100/home` como URL de retorno. Al publicar la app, añade también su URL de producción.
4. En Google Cloud, configura como URI de retorno autorizada la URL de callback que muestra Supabase para el proveedor Google.

## Estructura principal

- `src/app/auth/`: inicio de sesión, registro y recuperación de contraseña.
- `src/app/home/`: página principal después de iniciar sesión.
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
