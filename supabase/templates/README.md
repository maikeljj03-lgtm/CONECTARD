# Plantillas de correo de ConectaRD

El proyecto usa dos plantillas distintas:

- **Magic link or OTP** para el OTP que se pide al iniciar sesión. Debe incluir `{{ .Token }}` y está en [magic-link-otp.html](magic-link-otp.html).
- **Confirm signup** para verificar el correo al crear una cuenta. Con `NEXT_PUBLIC_SUPABASE_SIGNUP_OTP=true`, debe incluir `{{ .Token }}` y se usa [confirmation-otp.html](confirmation-otp.html). Si la variable está en `false`, la app muestra el flujo de enlace y usa [confirmation.html](confirmation.html).

## Configuración alojada

En Supabase, conserva **Confirm email** activado. Ve a **Authentication → Emails → Templates → Confirm signup**, elige **Source**, pega el HTML de `confirmation-otp.html` y guarda. La plantilla de login se configura aparte en **Magic link or OTP**. Añade la URL de la app en **Authentication → URL Configuration**.

Un archivo guardado en el repositorio no cambia automáticamente las plantillas del proyecto alojado. Para publicarlas desde la terminal, configura `SUPABASE_ACCESS_TOKEN` en `.env` con permisos `auth_config_write` y `project_admin_write`, y ejecuta `npm run supabase:confirmation-template`. El script elige la plantilla de confirmación por OTP o por enlace según `NEXT_PUBLIC_SUPABASE_SIGNUP_OTP` y nunca imprime el token.

La app valida los códigos con Supabase (`verifyOtp`, tipo `email`). Tras confirmar el registro, vuelve al login; el OTP de inicio de sesión se envía después de validar la contraseña.
