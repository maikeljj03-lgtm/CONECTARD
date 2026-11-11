import { AbstractControl, ValidationErrors } from '@angular/forms';

/** Validador de grupo: "password" y "confirmPassword" deben coincidir. */
export function matchingPasswords(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirmation = control.get('confirmPassword')?.value;
  return password && confirmation && password !== confirmation ? { passwordMismatch: true } : null;
}

/** Rechaza textos formados solo por espacios. */
export function nonBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim().length > 0 ? null : { blank: true };
}
