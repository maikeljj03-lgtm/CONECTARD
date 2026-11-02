# Confirmación de registro por OTP

La pantalla de registro usa un código de 6 dígitos con `supabase.auth.verifyOtp`. Para que Supabase envíe ese código, la plantilla **Confirm sign up** debe incluir `{{ .Token }}`. No la reemplaces por `{{ .ConfirmationURL }}`, porque eso cambia el correo a un enlace de confirmación.

## Aplicar la plantilla

En un proyecto que permita editar plantillas:

1. Activa **Confirm email** en **Authentication → Sign In / Providers**.
2. Abre **Authentication → Emails → Templates → Confirm sign up**.
3. Usa como asunto `Tu código de verificación para ConectaRD`.
4. Pega el contenido de [confirm-signup-otp.html](confirm-signup-otp.html) y guarda.

## Límite del proyecto actual

El panel de ConectaRD indica que hay que configurar SMTP propio para editar las plantillas. En proyectos Free nuevos, Supabase bloquea la personalización con su SMTP predeterminado. Ese servicio también limita los destinatarios a direcciones autorizadas del equipo y el volumen de envíos. Por eso, el HTML queda preparado en este repositorio, pero no se aplicará al correo real mientras el proyecto siga usando el SMTP predeterminado.
