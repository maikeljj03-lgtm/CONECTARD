import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, Input, inject } from '@angular/core';

export interface ShareTarget {
  id: 'whatsapp' | 'facebook' | 'x' | 'telegram' | 'email';
  label: string;
  url: string;
}

/** Enlaces para compartir en cada red (RF-31). Todo va codificado en la URL; nada se envía a terceros sin que la persona toque. */
export function shareTargets(url: string, text: string): ShareTarget[] {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  const both = encodeURIComponent(`${text} ${url}`);
  return [
    { id: 'whatsapp', label: 'WhatsApp', url: `https://wa.me/?text=${both}` },
    { id: 'facebook', label: 'Facebook', url: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { id: 'x', label: 'X', url: `https://x.com/intent/post?text=${t}&url=${u}` },
    { id: 'telegram', label: 'Telegram', url: `https://t.me/share/url?url=${u}&text=${t}` },
    { id: 'email', label: 'Correo', url: `mailto:?subject=${t}&body=${both}` },
  ];
}

/**
 * Botón "Compartir" (RF-31). En el teléfono abre el menú nativo de compartir
 * (WhatsApp, Instagram, etc.); en la computadora muestra las redes y "Copiar enlace".
 */
@Component({
  selector: 'app-share-button',
  templateUrl: './share-button.component.html',
  styleUrls: ['./share-button.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareButtonComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly changeDetector = inject(ChangeDetectorRef);

  /** Ruta de la app que se comparte, por ejemplo /reporte/<id>. */
  @Input({ required: true }) path!: string;
  @Input({ required: true }) title!: string;
  /** Texto que acompaña al enlace. */
  @Input() text = '';
  /** Estilo compacto (solo ícono). */
  @Input() compact = false;

  open = false;
  copied = false;

  get url(): string {
    return new URL(this.path, window.location.origin).toString();
  }

  get message(): string {
    return this.text || this.title;
  }

  get targets(): ShareTarget[] {
    return shareTargets(this.url, this.message);
  }

  async share(): Promise<void> {
    // Menú nativo del sistema cuando existe (teléfonos y algunos navegadores).
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
    const data: ShareData = { title: this.title, text: this.message, url: this.url };
    if (nav.share && (!nav.canShare || nav.canShare(data)) && window.matchMedia('(pointer: coarse)').matches) {
      try {
        await nav.share(data);
        return;
      } catch (error) {
        // Si la persona cerró el menú, no se hace nada; si falló, se muestra el menú propio.
        if ((error as DOMException)?.name === 'AbortError') return;
      }
    }
    this.open = !this.open;
    this.copied = false;
    this.changeDetector.markForCheck();
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.url);
    } catch {
      // Navegadores sin portapapeles: se selecciona el campo para copiar a mano.
      (this.host.nativeElement.querySelector('input') as HTMLInputElement | null)?.select();
      return;
    }
    this.copied = true;
    this.changeDetector.markForCheck();
    setTimeout(() => {
      this.copied = false;
      this.changeDetector.markForCheck();
    }, 2500);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) {
      this.open = false;
      this.changeDetector.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) {
      this.open = false;
      this.changeDetector.markForCheck();
    }
  }
}
