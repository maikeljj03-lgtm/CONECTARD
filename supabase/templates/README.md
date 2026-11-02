# Plantilla de confirmación de ConectaRD

La plantilla de `confirmation.html` usa el diseño y los colores de la página de autenticación. El asunto configurado es **Confirma tu correo | ConectaRD**.

Para aplicarla al proyecto alojado en Supabase:

1. Abre **Authentication → Email Templates → Confirm signup** en el Dashboard.
2. Cambia el asunto a `Confirma tu correo | ConectaRD`.
3. Copia el contenido de `confirmation.html` en el campo del cuerpo y guarda.
4. En **Authentication → URL Configuration**, permite la URL de la app que termina en `/auth/login` para desarrollo y producción.

También se puede publicar desde la terminal: crea un token fine-grained en el Dashboard con permisos `auth_config_write` y `project_admin_write`, guárdalo como `SUPABASE_ACCESS_TOKEN` en `.env` y ejecuta `npm run supabase:confirmation-template`. El token se usa solo como bearer header y el script no lo imprime.

La app envía `emailRedirectTo` a `/auth/login`; la plantilla debe conservar `{{ .ConfirmationURL }}` en el enlace del botón. Para desarrollo, el origen actual de Ionic es `http://localhost:8100`.

`supabase/config.toml` referencia este archivo para entornos locales gestionados por Supabase CLI. En un proyecto alojado, el Dashboard administra el template; añadir el archivo al repositorio no lo publica automáticamente.
