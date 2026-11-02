import { Component, OnInit } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from './auth.service';

type AuthMode = 'login' | 'register' | 'forgot-password' | 'reset-password';

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
export class AuthPage implements OnInit {
  mode: AuthMode = 'login';
  loginForm: FormGroup;
  registerForm: FormGroup;
  emailForm: FormGroup;
  resetForm: FormGroup;
  busy = false;
  showPassword = false;
  message = '';
  notice = '';

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
  ) {
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
      this.mode = requestedMode && ['login', 'register', 'forgot-password', 'reset-password'].includes(requestedMode)
        ? requestedMode
        : 'login';
      this.message = '';
      this.notice = '';
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
        this.notice = 'Te enviamos un correo para confirmar tu cuenta. Cuando la confirmes, inicia sesión para continuar.';
      }
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

  private startRequest(): void {
    this.busy = true;
    this.message = '';
    this.notice = '';
  }

  private friendlyError(error: unknown): string {
    const candidate = error as { code?: string; message?: string };
    const code = candidate?.code ?? '';
    const detail = candidate?.message ?? '';
    if (code === 'invalid_credentials') return 'El correo o la contraseña no coinciden.';
    if (code === 'email_not_confirmed') return 'Confirma tu correo antes de iniciar sesión.';
    if (code === 'user_already_exists') return 'Ya existe una cuenta con ese correo. Intenta iniciar sesión.';
    if (code === 'weak_password') return 'Usa una contraseña más segura, de al menos 8 caracteres.';
    if (code === 'provider_disabled') return 'El acceso con Google aún no está habilitado en Supabase.';
    if (detail.toLowerCase().includes('fetch')) return 'No pudimos conectar con el servicio. Revisa tu conexión e inténtalo de nuevo.';
    return detail || 'Ocurrió un error. Inténtalo de nuevo en unos momentos.';
  }
}
