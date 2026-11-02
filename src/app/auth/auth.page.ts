import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from './auth.service';

type AuthMode = 'login' | 'register' | 'verify-email' | 'forgot-password' | 'reset-password';

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
  showPassword = false;
  registeredEmail = '';
  resendCooldownSeconds = 0;
  message = '';
  notice = '';
  private resendCooldownTimer?: ReturnType<typeof setInterval>;

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
      email: ['', [Validators.required, Validators.email]],
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
      const nextMode = requestedMode && ['login', 'register', 'verify-email', 'forgot-password', 'reset-password'].includes(requestedMode)
        ? requestedMode
        : 'login';
      this.mode = nextMode;
      if (nextMode === 'verify-email') {
        const navigationEmail = window.history.state?.['email'];
        this.registeredEmail = typeof navigationEmail === 'string' && navigationEmail
          ? navigationEmail
          : this.registeredEmail;
        if (this.registeredEmail) this.otpForm.patchValue({ email: this.registeredEmail });
      }
      this.message = '';
      this.notice = '';
    });

    this.route.queryParamMap.subscribe((params) => {
      if (!params.has('code')) return;
      this.mode = 'login';
      this.notice = 'Confirmando tu correo…';
      void this.auth.initialize()
        .then(() => { this.notice = 'Correo confirmado. Ya puedes iniciar sesión.'; })
        .catch((error: unknown) => { this.message = this.friendlyError(error); this.notice = ''; });
    });
  }

  async submitLogin(): Promise<void> {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.startRequest();
    try {
      const { error } = await this.auth.signIn(this.loginForm.value.email, this.loginForm.value.password);
      if (error) throw error;
      await this.router.navigateByUrl('/home', { replaceUrl: true });
    } catch (error) {
      this.message = this.friendlyError(error);
    } finally {
      this.busy = false;
    }
  }

  async submitRegister(): Promise<void> {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }
    this.startRequest();
    try {
      const value = this.registerForm.value;
      const { data, error } = await this.auth.signUp(value.email.trim().toLowerCase(), value.password, {
        fullName: value.fullName.trim(),
        requestedRole: value.requestedRole,
      });
      if (error) throw error;
      if (data.session) {
        await this.router.navigateByUrl('/home', { replaceUrl: true });
      } else {
        this.registeredEmail = value.email.trim().toLowerCase();
        this.otpForm.patchValue({ email: this.registeredEmail, token: '' });
        this.startResendCooldown();
        await this.router.navigateByUrl('/auth/verify-email', {
          state: { email: this.registeredEmail },
        });
      }
    } catch (error) {
      this.message = this.friendlyError(error);
    } finally {
      this.busy = false;
    }
  }

  async verifySignupOtp(): Promise<void> {
    if (this.otpForm.invalid) {
      this.otpForm.markAllAsTouched();
      return;
    }
    this.startRequest();
    try {
      const { email, token } = this.otpForm.getRawValue();
      const { data, error } = await this.auth.verifySignupOtp(email, token);
      if (error) throw error;
      if (!data.session) throw new Error('Supabase verificó el código, pero no devolvió una sesión.');
      await this.router.navigateByUrl('/home', { replaceUrl: true });
    } catch (error) {
      this.message = this.friendlyError(error);
    } finally {
      this.busy = false;
    }
  }

  async resendSignupOtp(): Promise<void> {
    const emailControl = this.otpForm.controls['email'];
    if (emailControl.invalid || this.resendCooldownSeconds > 0) {
      emailControl.markAsTouched();
      return;
    }
    this.startRequest();
    try {
      const { error } = await this.auth.resendSignupOtp(emailControl.value);
      if (error) throw error;
      this.registeredEmail = emailControl.value.trim().toLowerCase();
      this.notice = 'Si la cuenta necesita confirmación, enviaremos un nuevo código.';
      this.startResendCooldown();
    } catch (error) {
      this.message = this.friendlyError(error);
    } finally {
      this.busy = false;
    }
  }

  async continueWithGoogle(): Promise<void> {
    this.startRequest();
    try {
      const { error } = await this.auth.signInWithGoogle();
      if (error) throw error;
    } catch (error) {
      this.message = this.friendlyError(error);
      this.busy = false;
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
    }
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  ngOnDestroy(): void {
    if (this.resendCooldownTimer) clearInterval(this.resendCooldownTimer);
  }

  private startRequest(): void {
    this.busy = true;
    this.message = '';
    this.notice = '';
  }

  private startResendCooldown(): void {
    if (this.resendCooldownTimer) clearInterval(this.resendCooldownTimer);
    this.resendCooldownSeconds = 30;
    this.resendCooldownTimer = setInterval(() => {
      this.resendCooldownSeconds = Math.max(0, this.resendCooldownSeconds - 1);
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
      return 'Supabase tardó demasiado en responder. Revisa tu conexión y el correo por si la cuenta alcanzó a crearse antes de volver a intentarlo.';
    }
    if (code === 'invalid_credentials') return 'El correo o la contraseña no coinciden.';
    if (code === 'email_not_confirmed') return 'Confirma tu correo antes de iniciar sesión.';
    if (code === 'otp_expired' || detail.toLowerCase().includes('token has expired')) return 'El código venció. Solicita uno nuevo.';
    if (detail.toLowerCase().includes('token')) return 'El código no es válido. Revísalo e inténtalo otra vez.';
    if (['over_email_send_rate_limit', 'email_rate_limit_exceeded'].includes(code)) return 'Supabase limitó temporalmente el envío de códigos. Espera un momento antes de solicitar otro.';
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
    return detail || 'Ocurrió un error. Inténtalo de nuevo en unos momentos.';
  }
}
