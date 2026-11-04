import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

type AuthMode = 'login' | 'register' | 'verify-email' | 'verify-login' | 'forgot-password' | 'reset-password';
const GOOGLE_REGISTRATION_PENDING = 'conectard.google-registration-pending';
const PENDING_SIGNUP_EMAIL = 'conectard.pending-signup-email';
const PENDING_LOGIN_EMAIL = 'conectard.pending-login-email';

function matchingPasswords(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirmation = control.get('confirmPassword')?.value;
  return password && confirmation && password !== confirmation ? { passwordMismatch: true } : null;
}

function nonBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim().length > 0 ? null : { blank: true };
}

@Component({
  selector: 'app-auth',
  templateUrl: './auth.page.html',
  styleUrls: ['./auth.page.scss'],
  standalone: false,
})
export class AuthPage implements OnInit, OnDestroy {
  private readonly formBuilder = inject(FormBuilder);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  mode: AuthMode = 'login';
  loginForm: FormGroup;
  registerForm: FormGroup;
  otpForm: FormGroup;
  emailForm: FormGroup;
  resetForm: FormGroup;
  busy = false;
  googleBusy = false;
  signupOtpEnabled = false;
  loginNeedsSignup = false;
  showPassword = false;
  registeredEmail = '';
  resendCooldownSeconds = 0;
  message = '';
  notice = '';
  private resendCooldownTimer?: ReturnType<typeof setInterval>;
  private googleRequestTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]],
    });
    this.registerForm = this.formBuilder.group({
      fullName: ['', [Validators.required, nonBlank, Validators.minLength(2), Validators.maxLength(80)]],
      requestedRole: ['citizen', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]],
    }, { validators: matchingPasswords });
    this.otpForm = this.formBuilder.group({
      token: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    });
    this.emailForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
    });
    this.resetForm = this.formBuilder.group({
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]],
    }, { validators: matchingPasswords });
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const requestedMode = params.get('mode') as AuthMode | null;
      const nextMode = requestedMode && ['login', 'register', 'verify-email', 'verify-login', 'forgot-password', 'reset-password'].includes(requestedMode)
        ? requestedMode
        : 'login';
      this.mode = nextMode;
      if (nextMode === 'verify-email') {
        const navigationEmail = window.history.state?.['email'];
        this.registeredEmail = typeof navigationEmail === 'string' && navigationEmail
          ? navigationEmail
          : sessionStorage.getItem(PENDING_SIGNUP_EMAIL) ?? this.registeredEmail;
        void this.auth.isSignupOtpEnabled()
          .then((enabled) => {
            this.signupOtpEnabled = enabled;
            this.refreshView();
          })
          .catch(() => {
            this.signupOtpEnabled = false;
            this.refreshView();
          });
      }
      if (nextMode === 'verify-login') {
        const navigationEmail = window.history.state?.['email'];
        this.registeredEmail = typeof navigationEmail === 'string' && navigationEmail
          ? navigationEmail
          : sessionStorage.getItem(PENDING_LOGIN_EMAIL) ?? '';
        if (!this.registeredEmail) {
          void this.router.navigateByUrl('/auth/login', { replaceUrl: true });
        }
        this.startResendCooldown();
      }
      this.message = '';
      this.notice = '';
    });

    this.route.queryParamMap.subscribe((params) => {
      if (params.has('auth_callback')) {
        this.mode = 'login';
        this.notice = 'No se pudo completar el acceso. Inicia sesión de nuevo; si el enlace venció, solicita uno nuevo.';
        this.refreshView();
        return;
      }
      if (params.has('unverified')) {
        this.mode = 'login';
        this.notice = 'Confirma el correo desde el enlace que te enviamos antes de entrar.';
        return;
      }
      if (!params.has('code')) return;
      this.mode = 'login';
      this.notice = 'Confirmando tu correo…';
      void this.auth.initialize()
        .then(async () => {
          const registeredWithGoogle = sessionStorage.getItem(GOOGLE_REGISTRATION_PENDING) === '1';
          const pendingLoginEmail = sessionStorage.getItem(PENDING_LOGIN_EMAIL);
          if (pendingLoginEmail) {
            sessionStorage.removeItem(PENDING_LOGIN_EMAIL);
            await this.router.navigateByUrl('/landing', { replaceUrl: true });
            return;
          } else if (registeredWithGoogle) {
            await this.auth.signOut('local');
            sessionStorage.removeItem(GOOGLE_REGISTRATION_PENDING);
            this.notice = 'Tu acceso con Google está listo. Inicia sesión con Google para entrar.';
          } else {
            this.notice = 'Correo confirmado. Ya puedes iniciar sesión.';
          }
          this.refreshView();
        })
        .catch((error: unknown) => {
          sessionStorage.removeItem(GOOGLE_REGISTRATION_PENDING);
          this.message = this.friendlyError(error);
          this.notice = '';
          this.refreshView();
        });
    });
  }

  async submitLogin(): Promise<void> {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.startRequest();
    try {
      const email = String(this.loginForm.value.email).trim().toLowerCase();
      const { error } = await this.auth.validatePasswordAndSendLoginOtp(email, this.loginForm.value.password);
      if (error) throw error;
      this.registeredEmail = email;
      sessionStorage.setItem(PENDING_LOGIN_EMAIL, email);
      this.otpForm.reset({ token: '' });
      this.startResendCooldown();
      await this.router.navigateByUrl('/auth/verify-login', { state: { email }, replaceUrl: true });
    } catch (error) {
      if ((error as { code?: string })?.code === 'invalid_credentials') {
        this.loginNeedsSignup = true;
        this.message = 'Correo o contraseña incorrectos. Si todavía no tienes cuenta, regístrate.';
      } else {
        this.message = this.friendlyError(error);
      }
    } finally {
      this.busy = false;
      this.refreshView();
    }
  }

  async verifyLoginOtp(): Promise<void> {
    if (this.otpForm.invalid || !this.registeredEmail) {
      this.otpForm.markAllAsTouched();
      return;
    }
    this.startRequest();
    try {
      const { token } = this.otpForm.getRawValue();
      const { error } = await this.auth.verifyLoginOtp(this.registeredEmail, token);
      if (error) throw error;
      sessionStorage.removeItem(PENDING_LOGIN_EMAIL);
      await this.router.navigateByUrl('/landing', { replaceUrl: true });
    } catch (error) {
      this.message = this.friendlyError(error);
    } finally {
      this.busy = false;
      this.refreshView();
    }
  }

  async resendLoginOtp(): Promise<void> {
    if (!this.registeredEmail || this.resendCooldownSeconds > 0) return;
    this.startRequest();
    try {
      const { error } = await this.auth.resendLoginOtp(this.registeredEmail);
      if (error) throw error;
      this.notice = 'Si existe una cuenta con ese correo, recibirás un nuevo código.';
      this.startResendCooldown();
    } catch (error) {
      this.message = this.friendlyError(error);
    } finally {
      this.busy = false;
      this.refreshView();
    }
  }

  async submitRegister(): Promise<void> {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }
    this.startRequest();
    sessionStorage.removeItem(GOOGLE_REGISTRATION_PENDING);
    try {
      const value = this.registerForm.value;
      const email = value.email.trim().toLowerCase();
      const { data, error } = await this.auth.signUp(email, value.password, {
        fullName: value.fullName.trim(),
        requestedRole: value.requestedRole,
      });
      if (error) throw error;
      this.registeredEmail = email;
      if (data.session) {
        await this.auth.signOut('local');
        await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
        this.loginForm.patchValue({ email });
        this.notice = 'Supabase no pidió confirmar el correo, así que no se envió un código. Activa Confirm email para usar OTP.';
      } else {
        this.signupOtpEnabled = await this.auth.isSignupOtpEnabled();
        if (this.signupOtpEnabled) {
          sessionStorage.setItem(PENDING_SIGNUP_EMAIL, email);
          this.otpForm.reset({ token: '' });
          this.startResendCooldown();
          await this.router.navigateByUrl('/auth/verify-email', {
            state: { email },
            replaceUrl: true,
          });
        } else {
          await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
          this.loginForm.patchValue({ email });
          this.notice = `Cuenta creada. Confirma el enlace que Supabase envió a ${email} y luego inicia sesión.`;
        }
      }
      this.refreshView();
    } catch (error) {
      this.message = this.friendlyError(error);
    } finally {
      this.busy = false;
      this.refreshView();
    }
  }

  async verifySignupOtp(): Promise<void> {
    if (this.otpForm.invalid || !this.registeredEmail) {
      this.otpForm.markAllAsTouched();
      return;
    }
    this.startRequest();
    try {
      const { token } = this.otpForm.getRawValue();
      const { error } = await this.auth.verifySignupOtp(this.registeredEmail, token);
      if (error) throw error;
      await this.auth.signOut('local');
      sessionStorage.removeItem(PENDING_SIGNUP_EMAIL);
      await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
      this.loginForm.patchValue({ email: this.registeredEmail });
      this.notice = 'Correo verificado. Ahora inicia sesión con tu correo y contraseña.';
    } catch (error) {
      this.message = this.friendlyError(error);
    } finally {
      this.busy = false;
      this.refreshView();
    }
  }

  async resendSignupVerification(): Promise<void> {
    if (!this.registeredEmail || this.resendCooldownSeconds > 0) return;
    this.startRequest();
    try {
      const { error } = this.signupOtpEnabled
        ? await this.auth.resendSignupOtp(this.registeredEmail)
        : await this.auth.resendSignupConfirmation(this.registeredEmail);
      if (error) throw error;
      this.notice = this.signupOtpEnabled
        ? 'Si la cuenta necesita confirmación, enviaremos un nuevo código.'
        : 'Si la cuenta necesita confirmación, enviaremos un nuevo enlace.';
      this.startResendCooldown();
    } catch (error) {
      this.message = this.friendlyError(error);
    } finally {
      this.busy = false;
      this.refreshView();
    }
  }

  async continueWithGoogle(forRegistration = false): Promise<void> {
    this.googleBusy = true;
    this.message = '';
    this.notice = '';
    if (forRegistration) {
      sessionStorage.setItem(GOOGLE_REGISTRATION_PENDING, '1');
    } else {
      sessionStorage.removeItem(GOOGLE_REGISTRATION_PENDING);
    }
    if (this.googleRequestTimer) clearTimeout(this.googleRequestTimer);
    this.googleRequestTimer = setTimeout(() => {
      if (!this.googleBusy) return;
      this.googleBusy = false;
      sessionStorage.removeItem(GOOGLE_REGISTRATION_PENDING);
      this.message = 'Google no respondió. Revisa tu conexión e inténtalo otra vez.';
      this.googleRequestTimer = undefined;
      this.refreshView();
    }, 15_000);
    try {
      const { error } = await this.auth.signInWithGoogle(forRegistration);
      if (error) throw error;
    } catch (error) {
      sessionStorage.removeItem(GOOGLE_REGISTRATION_PENDING);
      this.message = this.friendlyError(error);
      this.googleBusy = false;
      if (this.googleRequestTimer) clearTimeout(this.googleRequestTimer);
      this.googleRequestTimer = undefined;
      this.refreshView();
    }
  }

  async sendPasswordReset(): Promise<void> {
    if (this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      return;
    }
    this.startRequest();
    try {
      const { error } = await this.auth.sendPasswordReset(this.emailForm.value.email);
      if (error) throw error;
      this.notice = 'Si el correo corresponde a una cuenta, recibirás un enlace para cambiar la contraseña.';
    } catch (error) {
      this.message = this.friendlyError(error);
    } finally {
      this.busy = false;
      this.refreshView();
    }
  }

  async updatePassword(): Promise<void> {
    if (this.resetForm.invalid) {
      this.resetForm.markAllAsTouched();
      return;
    }
    this.startRequest();
    try {
      const { error } = await this.auth.updatePassword(this.resetForm.value.password);
      if (error) throw error;
      this.notice = 'Tu contraseña se actualizó. Ya puedes iniciar sesión.';
      this.resetForm.reset();
    } catch (error) {
      this.message = this.friendlyError(error);
    } finally {
      this.busy = false;
      this.refreshView();
    }
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  ngOnDestroy(): void {
    if (this.resendCooldownTimer) clearInterval(this.resendCooldownTimer);
    if (this.googleRequestTimer) clearTimeout(this.googleRequestTimer);
  }

  private startRequest(): void {
    this.busy = true;
    this.message = '';
    this.notice = '';
    this.loginNeedsSignup = false;
  }

  private refreshView(): void {
    this.changeDetector.markForCheck();
  }

  private startResendCooldown(): void {
    if (this.resendCooldownTimer) clearInterval(this.resendCooldownTimer);
    this.resendCooldownSeconds = 60;
    this.resendCooldownTimer = setInterval(() => {
      this.resendCooldownSeconds = Math.max(0, this.resendCooldownSeconds - 1);
      this.refreshView();
      if (this.resendCooldownSeconds === 0 && this.resendCooldownTimer) {
        clearInterval(this.resendCooldownTimer);
        this.resendCooldownTimer = undefined;
      }
    }, 1000);
  }

  private friendlyError(error: unknown): string {
    const candidate = error as { code?: string; message?: string };
    const code = candidate?.code ?? '';
    const detail = candidate?.message ?? '';
    if ((error as { name?: string })?.name === 'AbortError') {
      return 'No pudimos verificar tu cuenta. Supabase no respondió; revisa la conexión y la configuración e inténtalo otra vez.';
    }
    if (code === 'invalid_credentials') return 'No encontramos una cuenta con esos datos. Revisa el correo y la contraseña o crea una cuenta.';
    if (code === 'auth_timeout') return 'No pudimos verificar tu cuenta. Supabase no respondió; revisa la conexión y la configuración e inténtalo otra vez.';
    if (code === 'email_not_confirmed') return 'Confirma tu correo antes de iniciar sesión.';
    if (code === 'otp_expired' || detail.toLowerCase().includes('token has expired')) return 'El código venció. Solicita uno nuevo.';
    if (detail.toLowerCase().includes('token')) return 'El código no es válido. Revísalo e inténtalo otra vez.';
    if (['over_email_send_rate_limit', 'email_rate_limit_exceeded'].includes(code)) return 'Supabase limitó temporalmente el envío del correo. Espera un momento antes de solicitar otro.';
    if (code === 'email_address_not_authorized' || detail.toLowerCase().includes('email address not authorized')) {
      return 'El correo integrado de Supabase solo envía a direcciones autorizadas del equipo del proyecto.';
    }
    if (code === 'user_already_exists') return 'Ya existe una cuenta con ese correo. Intenta iniciar sesión.';
    if (code === 'weak_password') return 'Usa una contraseña más segura, de al menos 8 caracteres.';
    if (code === 'provider_disabled' || detail.toLowerCase().includes('provider is not enabled')) {
      return 'Google aún no está habilitado en Supabase. Activa Google en Authentication → Sign In / Providers y configura sus credenciales OAuth.';
    }
    if (detail.toLowerCase().includes('redirect') && detail.toLowerCase().includes('allow')) {
      return 'Supabase rechazó la URL de retorno. Añade la dirección de esta app en Authentication → URL Configuration → Redirect URLs.';
    }
    if (detail.toLowerCase().includes('fetch')) return 'No pudimos conectar con el servicio. Revisa tu conexión e inténtalo de nuevo.';
    if (detail.toLowerCase().includes('no se pudo cargar la configuración')
      || detail.toLowerCase().includes('configuración de supabase está incompleta')
      || detail.toLowerCase().includes('todavía tiene valores de ejemplo')) {
      return 'Supabase todavía no está configurado. Revisa la URL y la clave pública del proyecto e inicia de nuevo la app.';
    }
    if (detail.toLowerCase().includes('invalid api key') || detail.toLowerCase().includes('invalid jwt')) {
      return 'Supabase no está configurado correctamente. Revisa la URL y la clave pública del proyecto.';
    }
    return detail || 'Ocurrió un error. Inténtalo de nuevo en unos momentos.';
  }
}
