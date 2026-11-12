import { ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, Output, inject } from '@angular/core';
import { MEDIA_LIMITS, formatBytes, processMediaFile, type ProcessedMedia } from '../../../core/utils/media';

export interface PickedMedia {
  id: string;
  name: string;
  status: 'processing' | 'ready' | 'error';
  previewUrl: string | null;
  processed: ProcessedMedia | null;
  error: string;
}

/**
 * Elegir fotos y videos para un reporte.
 * - "Cámara" abre la cámara del teléfono (RF-10).
 * - "Galería" permite elegir varios archivos guardados (RF-11).
 * Cada foto se comprime al momento (RF-12) y se muestra cuánto pesaba antes y después.
 */
@Component({
  selector: 'app-media-picker',
  templateUrl: './media-picker.component.html',
  styleUrls: ['./media-picker.component.scss'],
  standalone: false,
})
export class MediaPickerComponent implements OnDestroy {
  private readonly changeDetector = inject(ChangeDetectorRef);

  @Input() disabled = false;
  /** Máximo de archivos que se pueden elegir (por ejemplo, los que quedan libres al editar). */
  @Input() maxItems: number = MEDIA_LIMITS.maxItems;
  /** false para aceptar solo fotos (la evidencia de solución, RF-17). */
  @Input() allowVideo = true;
  /** Marca el primer archivo como portada (al crear un reporte). */
  @Input() showCover = true;
  /** Archivos listos para subir, cada vez que cambia la selección. */
  @Output() readonly readyChange = new EventEmitter<ProcessedMedia[]>();
  /** true mientras algún archivo se está procesando. */
  @Output() readonly processingChange = new EventEmitter<boolean>();

  readonly maxVideoSeconds = MEDIA_LIMITS.videoMaxSeconds;
  readonly maxVideoSize = formatBytes(MEDIA_LIMITS.videoMaxBytes);
  items: PickedMedia[] = [];
  notice = '';
  dragging = false;

  get accept(): string {
    return this.allowVideo ? 'image/*,video/mp4,video/webm,video/quicktime' : 'image/*';
  }

  get remaining(): number {
    return this.maxItems - this.items.filter((item) => item.status !== 'error').length;
  }

  get savedBytes(): number {
    return this.items.reduce((total, item) => {
      const processed = item.processed;
      return processed?.kind === 'image' ? total + Math.max(0, processed.originalBytes - processed.blob.size) : total;
    }, 0);
  }

  sizeLabel(item: PickedMedia): string {
    const processed = item.processed;
    if (!processed) return '';
    if (processed.kind === 'video') return `${formatBytes(processed.blob.size)} · ${processed.durationSeconds ?? 0} s`;
    return `${formatBytes(processed.originalBytes)} → ${formatBytes(processed.blob.size)}`;
  }

  formatBytes = formatBytes;

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void this.addFiles(files);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
    if (this.disabled) return;
    void this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.disabled) this.dragging = true;
  }

  remove(item: PickedMedia): void {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    this.items = this.items.filter((candidate) => candidate.id !== item.id);
    this.notice = '';
    this.emit();
  }

  /** Mueve un archivo una posición (el primero es la portada del reporte). */
  move(item: PickedMedia, direction: -1 | 1): void {
    const index = this.items.indexOf(item);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this.items.length) return;
    const copy = [...this.items];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    this.items = copy;
    this.emit();
  }

  /** Vacía la selección (después de enviar el reporte). */
  clear(): void {
    for (const item of this.items) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    this.items = [];
    this.notice = '';
    this.emit();
  }

  ngOnDestroy(): void {
    for (const item of this.items) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }

  private async addFiles(files: File[]): Promise<void> {
    this.notice = '';
    if (!files.length) return;
    const allowed = this.allowVideo ? files : files.filter((file) => !file.type.startsWith('video/'));
    if (allowed.length < files.length) this.notice = 'Aquí solo se aceptan fotos.';
    const accepted = allowed.slice(0, Math.max(0, this.remaining));
    if (accepted.length < allowed.length) {
      this.notice = `Puedes adjuntar hasta ${this.maxItems} ${this.allowVideo ? 'fotos o videos' : 'fotos'}.`;
    }
    const added = accepted.map<PickedMedia>((file) => ({
      id: crypto.randomUUID(),
      name: file.name || 'archivo',
      status: 'processing',
      previewUrl: null,
      processed: null,
      error: '',
    }));
    this.items = [...this.items, ...added];
    this.emit();

    // Se procesan uno a uno para no saturar la memoria del teléfono.
    for (const [index, file] of accepted.entries()) {
      const item = added[index];
      try {
        const processed = await processMediaFile(file);
        item.processed = processed;
        item.previewUrl = URL.createObjectURL(processed.blob);
        item.status = 'ready';
      } catch (error) {
        item.status = 'error';
        item.error = error instanceof Error ? error.message : 'No se pudo procesar el archivo.';
      }
      this.items = [...this.items];
      this.emit();
    }
  }

  private emit(): void {
    this.readyChange.emit(this.items.filter((item) => item.status === 'ready' && item.processed).map((item) => item.processed!));
    this.processingChange.emit(this.items.some((item) => item.status === 'processing'));
    this.changeDetector.markForCheck();
  }
}
