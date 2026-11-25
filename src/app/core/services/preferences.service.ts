import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { currentLanguage, LANGUAGE_STORAGE_KEY, type Language } from '../i18n/i18n';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'conectard-tema';
export const DATA_SAVER_STORAGE_KEY = 'conectard-ahorro-datos';

const THEME_COLORS = { light: '#FBFAF7', dark: '#0E191B' } as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento (modo privado): la preferencia dura hasta cerrar la página.
  }
}

/**
 * Preferencias de la persona en este dispositivo: tema (RF-49), idioma (RF-56) y ahorro de datos (RF-60).
 * Se guardan en el navegador; no hace falta sesión.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  readonly theme$ = new BehaviorSubject<ThemePreference>(this.storedTheme());
  readonly dataSaver$ = new BehaviorSubject<boolean>(read(DATA_SAVER_STORAGE_KEY) === '1');
  readonly language: Language = currentLanguage();

  constructor() {
    this.applyTheme();
    // Si eligió "como el sistema", sigue los cambios del teléfono (por ejemplo, al anochecer).
    this.media?.addEventListener?.('change', () => {
      if (this.theme$.value === 'system') this.applyTheme();
    });
  }

  get theme(): ThemePreference {
    return this.theme$.value;
  }

  /** Tema que se ve ahora mismo (resuelve "como el sistema"). */
  get effectiveTheme(): 'light' | 'dark' {
    const choice = this.theme$.value;
    if (choice === 'system') return this.media?.matches ? 'dark' : 'light';
    return choice;
  }

  setTheme(theme: ThemePreference): void {
    write(THEME_STORAGE_KEY, theme);
    this.theme$.next(theme);
    this.applyTheme();
  }

  get dataSaver(): boolean {
    return this.dataSaver$.value;
  }

  setDataSaver(enabled: boolean): void {
    write(DATA_SAVER_STORAGE_KEY, enabled ? '1' : '0');
    this.dataSaver$.next(enabled);
  }

  /** Cambia el idioma y recarga para que toda la app use el nuevo (los textos se leen al cargar). */
  setLanguage(language: Language): void {
    if (language === this.language) return;
    write(LANGUAGE_STORAGE_KEY, language);
    location.reload();
  }

  private storedTheme(): ThemePreference {
    const value = read(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  }

  private applyTheme(): void {
    const theme = this.effectiveTheme;
    const root = document.documentElement;
    root.dataset['theme'] = theme;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  }
}
