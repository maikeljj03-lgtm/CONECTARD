// Idiomas de ConectaRD (RF-56): español (principal), inglés y creole haitiano.
// El idioma se elige en Ajustes (o se toma del navegador) y se aplica al cargar la app:
// al cambiarlo, la página se recarga para que todas las pantallas usen el nuevo.
import { MESSAGES, type MessageKey } from './messages';

export type Language = 'es' | 'en' | 'ht';

export const LANGUAGES: { value: Language; label: string; native: string }[] = [
  { value: 'es', label: 'Español', native: 'Español' },
  { value: 'en', label: 'Inglés', native: 'English' },
  { value: 'ht', label: 'Creole haitiano', native: 'Kreyòl ayisyen' },
];

export const LANGUAGE_STORAGE_KEY = 'conectard-idioma';

/** Idioma elegido en este dispositivo; si no hay, el del navegador; si no, español. */
export function currentLanguage(): Language {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored === 'es' || stored === 'en' || stored === 'ht') return stored;
  const browser = (typeof navigator !== 'undefined' ? navigator.language : 'es').toLowerCase();
  if (browser.startsWith('ht') || browser === 'fr-ht') return 'ht';
  if (browser.startsWith('en')) return 'en';
  return 'es';
}

const active: Language = currentLanguage();
const INDEX: Record<Language, 0 | 1 | 2> = { es: 0, en: 1, ht: 2 };

/**
 * Texto traducido. Admite marcadores {nombre}: t('alerts.max', { n: 5 }).
 * Si falta la traducción, usa el español (nunca muestra la clave).
 */
export function t(key: MessageKey, params?: Record<string, string | number>, language: Language = active): string {
  const entry = MESSAGES[key];
  let text: string = entry ? entry[INDEX[language]] || entry[0] : key;
  if (params) {
    for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

/** Atributo lang del documento según el idioma (para lectores de pantalla, RF-54). */
export function applyDocumentLanguage(language: Language = active): void {
  document.documentElement.lang = language === 'es' ? 'es-DO' : language;
}
