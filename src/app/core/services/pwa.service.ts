import { Injectable, NgZone, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/** Evento que el navegador dispara cuando la app se puede instalar (Chrome, Edge, Samsung Internet). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState = 'installed' | 'available' | 'ios' | 'manual';

/**
 * App instalable (RF-48) y estado de la conexión (RF-60).
 * - Guarda el aviso de instalación del navegador para mostrar nuestro propio botón "Instalar".
 * - Avisa cuando no hay conexión (la app sigue mostrando lo que ya estaba en caché).
 */
@Injectable({ providedIn: 'root' })
export class PwaService {
  private readonly zone = inject(NgZone);
  private deferredPrompt: InstallPromptEvent | null = null;
  readonly installState$ = new BehaviorSubject<InstallState>(this.initialState());
  readonly online$ = new BehaviorSubject<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);

  constructor() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferredPrompt = event as InstallPromptEvent;
      this.zone.run(() => this.installState$.next('available'));
    });
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.zone.run(() => this.installState$.next('installed'));
    });
    window.addEventListener('online', () => this.zone.run(() => this.online$.next(true)));
    window.addEventListener('offline', () => this.zone.run(() => this.online$.next(false)));
  }

  /** Muestra el diálogo de instalación del navegador. Devuelve true si la persona aceptó. */
  async install(): Promise<boolean> {
    const prompt = this.deferredPrompt;
    if (!prompt) return false;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    this.deferredPrompt = null;
    this.installState$.next(choice.outcome === 'accepted' ? 'installed' : this.initialState());
    return choice.outcome === 'accepted';
  }

  /**
   * Borra la caché de datos (reportes, ranking) al cerrar sesión: en un equipo compartido,
   * la siguiente persona no debe ver lo que se guardó con la sesión anterior.
   */
  async clearDataCaches(): Promise<void> {
    if (typeof caches === 'undefined') return;
    try {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.includes(':data:') && name.includes('datos-publicos')).map((name) => caches.delete(name)));
    } catch {
      // Sin acceso a la caché: no hay nada que borrar.
    }
  }

  private initialState(): InstallState {
    if (typeof window === 'undefined') return 'manual';
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return 'installed';
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return 'ios';
    return 'manual';
  }
}
