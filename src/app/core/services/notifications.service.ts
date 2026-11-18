import { Injectable, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { BehaviorSubject } from 'rxjs';
import type { AppNotification } from '../models/engagement.model';
import { AuthService } from './auth.service';

const BROWSER_KEY = 'conectard.browser-notifications';
const PAGE_SIZE = 30;

/**
 * Centro de notificaciones (RF-36) y avisos del navegador (RF-34).
 * Escucha en tiempo real la tabla notifications (Realtime respeta RLS: cada quien solo recibe las suyas).
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);

  /** Últimas notificaciones (las más nuevas primero). */
  readonly items$ = new BehaviorSubject<AppNotification[]>([]);
  readonly unread$ = new BehaviorSubject<number>(0);
  readonly loading$ = new BehaviorSubject<boolean>(false);

  private channel?: RealtimeChannel;
  private userId: string | null = null;
  private starting?: Promise<void>;

  /** Empieza a escuchar (una sola vez por sesión). */
  start(): Promise<void> {
    this.starting ??= this.doStart().catch(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  /** Deja de escuchar y limpia (al cerrar sesión). */
  async stop(): Promise<void> {
    const client = await this.auth.supabase();
    if (this.channel) await client.removeChannel(this.channel);
    this.channel = undefined;
    this.userId = null;
    this.starting = undefined;
    this.items$.next([]);
    this.unread$.next(0);
  }

  async refresh(): Promise<void> {
    const client = await this.auth.supabase();
    const user = await this.auth.getCurrentUser();
    if (!user) return;
    this.loading$.next(true);
    try {
      const [list, count] = await Promise.all([
        client.from('notifications').select('*').order('created_at', { ascending: false }).limit(PAGE_SIZE),
        client.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
      ]);
      if (list.error) throw list.error;
      if (count.error) throw count.error;
      this.items$.next((list.data ?? []) as AppNotification[]);
      this.unread$.next(count.count ?? 0);
    } finally {
      this.loading$.next(false);
    }
  }

  async markRead(item: AppNotification): Promise<void> {
    if (item.read_at) return;
    const client = await this.auth.supabase();
    const now = new Date().toISOString();
    const { error } = await client.from('notifications').update({ read_at: now }).eq('id', item.id);
    if (error) throw error;
    this.items$.next(this.items$.value.map((n) => (n.id === item.id ? { ...n, read_at: now } : n)));
    this.unread$.next(Math.max(0, this.unread$.value - 1));
  }

  async markAllRead(): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.rpc('mark_all_notifications_read');
    if (error) throw error;
    const now = new Date().toISOString();
    this.items$.next(this.items$.value.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    this.unread$.next(0);
  }

  async remove(item: AppNotification): Promise<void> {
    const client = await this.auth.supabase();
    const { error } = await client.from('notifications').delete().eq('id', item.id);
    if (error) throw error;
    this.items$.next(this.items$.value.filter((n) => n.id !== item.id));
    if (!item.read_at) this.unread$.next(Math.max(0, this.unread$.value - 1));
  }

  /** Abre el enlace interno de la notificación y la marca como leída. */
  async open(item: AppNotification): Promise<void> {
    await this.markRead(item).catch(() => undefined);
    if (item.link && item.link.startsWith('/') && !item.link.startsWith('//')) await this.router.navigateByUrl(item.link);
  }

  // ---------- Avisos del navegador (RF-34) ----------

  get browserSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  get browserEnabled(): boolean {
    if (!this.browserSupported) return false;
    try {
      return Notification.permission === 'granted' && localStorage.getItem(BROWSER_KEY) !== 'off';
    } catch {
      return false;
    }
  }

  get browserBlocked(): boolean {
    return this.browserSupported && Notification.permission === 'denied';
  }

  /** Pide permiso al navegador y activa los avisos. Devuelve si quedaron activos. */
  async enableBrowser(): Promise<boolean> {
    if (!this.browserSupported) return false;
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    try {
      localStorage.setItem(BROWSER_KEY, permission === 'granted' ? 'on' : 'off');
    } catch {
      // Sin almacenamiento: queda según el permiso del navegador.
    }
    return permission === 'granted';
  }

  disableBrowser(): void {
    try {
      localStorage.setItem(BROWSER_KEY, 'off');
    } catch {
      // Nada que guardar.
    }
  }

  private async doStart(): Promise<void> {
    const client = await this.auth.supabase();
    const user = await this.auth.getCurrentUser();
    if (!user) return;
    if (this.userId === user.id && this.channel) return;
    this.userId = user.id;
    await this.refresh();
    this.channel = client
      .channel(`notifications:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, ({ new: row }) =>
        this.zone.run(() => this.onNew(row as AppNotification)),
      )
      .subscribe();
  }

  private onNew(item: AppNotification): void {
    if (this.items$.value.some((n) => n.id === item.id)) return;
    this.items$.next([item, ...this.items$.value].slice(0, PAGE_SIZE));
    this.unread$.next(this.unread$.value + 1);
    // Aviso del sistema solo si la app no está a la vista (si está a la vista, se ve la campanita).
    if (this.browserEnabled && document.visibilityState !== 'visible') {
      try {
        const notice = new Notification(item.title, { body: item.body ?? undefined, icon: '/assets/icon/favicon.png', tag: `crd-${item.id}` });
        notice.onclick = () => this.zone.run(() => {
          window.focus();
          void this.open(item);
          notice.close();
        });
      } catch {
        // Algunos navegadores móviles solo permiten avisos desde un service worker.
      }
    }
  }
}
