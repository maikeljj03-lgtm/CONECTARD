# Plantilla de confirmación de ConectaRD

El registro usa confirmación por enlace de Supabase. La plantilla de `confirmation.html` usa el diseño y los colores de ConectaRD y conserva `{{ .ConfirmationURL }}`.

Para aplicarla al proyecto alojado en Supabase:

1. Activa **Confirm email** en **Authentication → Sign In / Providers**.
2. Abre **Authentication → Emails → Templates → Confirm signup** en el Dashboard.
3. Cambia el asunto a `Confirma tu correo | ConectaRD`.
4. Copia el contenido de `confirmation.html` en el campo del cuerpo y guarda.
5. En **Authentication → URL Configuration**, permite la URL de la app que termina en `/auth/login` para desarrollo y producción.

También se puede publicar desde la terminal: crea un token fine-grained en el Dashboard con permisos `auth_config_write` y `project_admin_write`, guárdalo como `SUPABASE_ACCESS_TOKEN` en `.env` y ejecuta `npm run supabase:confirmation-template`. El token se usa solo como bearer header y el script no lo imprime.

La app envía `emailRedirectTo` a `/auth/login`; la plantilla debe conservar `{{ .ConfirmationURL }}` en el enlace del botón. Para desarrollo, el origen actual de Ionic es `http://localhost:8100`.

El plan actual muestra en el Dashboard que hay que configurar SMTP propio para editar plantillas. No se configura ningún proveedor de correo externo en este proyecto; mientras siga así, Supabase envía su plantilla predeterminada. `supabase/config.toml` referencia este archivo para entornos locales gestionados por Supabase CLI. En un proyecto alojado, añadir el archivo al repositorio no cambia por sí solo el correo enviado.

## OTP de seis dígitos para el login

El login solicita correo y contraseña. Supabase valida la contraseña sin persistir una sesión y solo entonces envía el OTP; la sesión normal se crea después de verificar los seis dígitos. `shouldCreateUser: false` evita registrar cuentas desde el formulario de login.

Para que el correo incluya el código y no un enlace, la plantilla **Magic Link** del proyecto alojado debe usar `magic-link-otp.html` con `{{ .Token }}`. En el Dashboard: **Authentication → Emails → Templates → Magic Link**. Permite también la URL de retorno de la app en **Authentication → URL Configuration**. El proyecto mostrado en el Dashboard no deja editar plantillas con el correo predeterminado; en ese caso Supabase enviará su enlace predeterminado. La app ofrece el campo OTP y también acepta ese enlace, que inicia la sesión y lleva al home. Para recibir el código numérico hay que poder aplicar la plantilla en el Dashboard.

## OTP de seis dígitos para confirmar registro

La pantalla OTP y la verificación con `verifyOtp` están preparadas en la app. Para activar ese recorrido, la plantilla **Confirm signup** del proyecto alojado debe enviar `{{ .Token }}` (no `{{ .ConfirmationURL }}`). El HTML listo está en [confirmation-otp.html](confirmation-otp.html). Supabase valida el código con `type: 'email'`.

Solo después de que la plantilla OTP esté activa, añade esta línea a `.env` y reinicia `npm start`:

```env
NEXT_PUBLIC_SUPABASE_SIGNUP_OTP=true
```

Si el panel sigue mostrando que debes configurar SMTP para editar la plantilla, deja la opción en `false` o sin definir. En ese estado, la app conserva el flujo de confirmación por enlace y no muestra un campo de código que no coincida con el correo enviado. El SMTP predeterminado de Supabase limita los destinatarios a miembros del equipo del proyecto y el volumen de envíos; no se ha agregado otro proveedor de correo.
