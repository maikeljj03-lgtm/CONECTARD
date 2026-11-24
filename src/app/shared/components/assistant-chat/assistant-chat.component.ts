import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AiError, AiService, type ChatTurn } from '../../../core/services/ai.service';
import { AuthService } from '../../../core/services/auth.service';

/** Pantallas de la app que el asistente puede mencionar; se convierten en enlaces. */
const APP_ROUTES = ['/reportes/nuevo', '/reportes/mios', '/explorar', '/jornadas', '/ranking', '/notificaciones', '/perfil', '/gestion'];
const ROUTE_PATTERN = new RegExp(`(${APP_ROUTES.map((route) => route.replace(/\//g, '\\/')).join('|')})(?![\\w/-])`, 'g');
const MAX_STORED_TURNS = 30;
/** Pantallas donde no tiene sentido (acceso, bienvenida y textos legales). */
const HIDDEN_ON = [/^\/$/, /^\/landing/, /^\/auth/, /^\/terminos/, /^\/privacidad/];

export interface MessagePart {
  text: string;
  route: string | null;
}

/** Divide un texto en partes normales y enlaces a pantallas de la app (sin HTML: nada se inyecta). */
export function splitRoutes(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  for (const match of text.matchAll(ROUTE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index), route: null });
    parts.push({ text: match[0], route: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), route: null });
  return parts;
}

/** Quita marcas de Markdown sueltas (**negrita**, # títulos) que a veces aparecen en la respuesta. */
export function plainText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
}

/**
 * Asistente de ConectaRD (RF-47): botón flotante con un chat que responde dudas sobre la
 * plataforma y sobre los reportes de la propia persona. Solo aparece con la sesión iniciada.
 */
@Component({
  selector: 'app-assistant-chat',
  templateUrl: './assistant-chat.component.html',
  styleUrls: ['./assistant-chat.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantChatComponent implements OnInit, OnDestroy {
  private readonly ai = inject(AiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly subscriptions = new Subscription();
  private stopAuthListener?: () => void;
  @ViewChild('input') private input?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('log') private log?: ElementRef<HTMLElement>;

  readonly suggestions = [
    '¿Cómo reporto un problema?',
    '¿Cómo va mi último reporte?',
    '¿Quién atiende mi reporte?',
    '¿Cómo gano puntos y medallas?',
  ];

  visible = false;
  /** Hay sesión iniciada (el botón solo se muestra con sesión y fuera de las pantallas de acceso). */
  signedIn = false;
  private hiddenHere = true;
  private userId: string | null = null;
  open = false;
  messages: ChatTurn[] = [];
  draft = '';
  sending = false;
  error = '';
  unavailable = false;
  remaining: number | null = null;
  private storageKey = '';

  async ngOnInit(): Promise<void> {
    this.hiddenHere = this.isHidden(this.router.url);
    this.subscriptions.add(this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
      this.hiddenHere = this.isHidden(event.urlAfterRedirects);
      if (this.hiddenHere) this.open = false;
      this.refreshVisibility();
    }));
    const user = await this.auth.getCurrentUser().catch(() => null);
    this.setUser(user?.id ?? null);
    try {
      const client = await this.auth.supabase();
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        this.zone.run(() => this.setUser(session?.user?.id ?? null));
      });
      this.stopAuthListener = () => data.subscription.unsubscribe();
    } catch {
      // Sin configuración de Supabase el asistente simplemente no aparece.
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.stopAuthListener?.();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.close();
  }

  toggle(): void {
    if (this.open) this.close();
    else {
      this.open = true;
      this.scrollSoon(true);
    }
  }

  close(): void {
    this.open = false;
    this.changeDetector.markForCheck();
  }

  parts(turn: ChatTurn): MessagePart[] {
    return splitRoutes(turn.role === 'assistant' ? plainText(turn.content) : turn.content);
  }

  onKeydown(event: KeyboardEvent): void {
    // Enter envía; Shift+Enter hace un salto de línea.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.send();
    }
  }

  async ask(question: string): Promise<void> {
    this.draft = question;
    await this.send();
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || this.sending || this.unavailable) return;
    if (text.length > 1500) {
      this.error = 'Tu mensaje es muy largo: usa hasta 1500 caracteres.';
      return;
    }
    this.messages = [...this.messages, { role: 'user', content: text }];
    this.draft = '';
    await this.request();
  }

  /** Reintenta la última pregunta que no tuvo respuesta. */
  async retry(): Promise<void> {
    if (this.messages.at(-1)?.role === 'user') await this.request();
  }

  clear(): void {
    this.messages = [];
    this.error = '';
    this.persist();
    this.changeDetector.markForCheck();
  }

  private async request(): Promise<void> {
    this.sending = true;
    this.error = '';
    this.persist();
    this.scrollSoon();
    try {
      const { reply, remaining } = await this.ai.chat(this.messages.slice(-12));
      this.messages = [...this.messages, { role: 'assistant', content: reply }];
      this.remaining = remaining;
      this.persist();
    } catch (error) {
      if (error instanceof AiError && error.unavailable) this.unavailable = true;
      this.error = error instanceof AiError ? error.message : 'El asistente no pudo responder ahora.';
    } finally {
      this.sending = false;
      this.scrollSoon(true);
    }
  }

  private setUser(id: string | null): void {
    if (id === this.userId) return;
    // Al cerrar sesión se borra la conversación guardada en este navegador (por si es un equipo compartido).
    if (!id && this.storageKey) {
      try {
        sessionStorage.removeItem(this.storageKey);
      } catch {
        // Sin almacenamiento: no hay nada que borrar.
      }
    }
    this.userId = id;
    this.signedIn = !!id;
    this.open = false;
    this.error = '';
    this.unavailable = false;
    this.remaining = null;
    this.storageKey = id ? `conectard-asistente:${id}` : '';
    // Al cambiar de cuenta (o salir) no queda nada de la conversación anterior en pantalla.
    this.messages = id ? this.restore() : [];
    this.refreshVisibility();
  }

  private refreshVisibility(): void {
    this.visible = this.signedIn && !this.hiddenHere;
    this.changeDetector.markForCheck();
  }

  private isHidden(url: string): boolean {
    const path = url.split(/[?#]/)[0] || '/';
    return HIDDEN_ON.some((pattern) => pattern.test(path));
  }

  private scrollSoon(focus = false): void {
    this.changeDetector.markForCheck();
    setTimeout(() => {
      const log = this.log?.nativeElement;
      if (log) log.scrollTop = log.scrollHeight;
      if (focus && this.open && !this.unavailable) this.input?.nativeElement.focus();
    });
  }

  private restore(): ChatTurn[] {
    if (!this.storageKey) return [];
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      const parsed = raw ? (JSON.parse(raw) as ChatTurn[]) : [];
      return Array.isArray(parsed)
        ? parsed.filter((turn) => (turn?.role === 'user' || turn?.role === 'assistant') && typeof turn.content === 'string').slice(-MAX_STORED_TURNS)
        : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    if (!this.storageKey) return;
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(this.messages.slice(-MAX_STORED_TURNS)));
    } catch {
      // Sin almacenamiento (modo privado): la conversación solo dura mientras la página siga abierta.
    }
  }
}
