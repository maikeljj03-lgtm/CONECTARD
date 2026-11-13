import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject } from '@angular/core';
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
  @ViewChild('cameraPreview') private cameraPreview?: ElementRef<HTMLVideoElement>;
  private cameraStream?: MediaStream;
  private microphoneStream?: MediaStream;
  private mediaRecorder?: MediaRecorder;
  private recordedChunks: Blob[] = [];
  private recordingTimer?: ReturnType<typeof setInterval>;
  private discardRecording = false;

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
  cameraOpen = false;
  recording = false;
  recordingSeconds = 0;

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

  async openCamera(): Promise<void> {
    if (this.disabled || this.remaining <= 0) return;
    this.notice = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      this.notice = 'Este navegador no permite abrir la cámara. Usa Galería o abre la app desde localhost o una conexión HTTPS.';
      return;
    }

    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      this.cameraOpen = true;
      this.changeDetector.detectChanges();
      const preview = this.cameraPreview?.nativeElement;
      if (!preview) throw new Error('No se pudo mostrar la vista previa de la cámara.');
      preview.srcObject = this.cameraStream;
      await preview.play();
    } catch (error) {
      this.stopCamera();
      this.notice = this.cameraError(error);
      this.changeDetector.markForCheck();
    }
  }

  async takePhoto(): Promise<void> {
    const preview = this.cameraPreview?.nativeElement;
    if (!preview?.videoWidth || !preview.videoHeight) {
      this.notice = 'La cámara todavía se está preparando. Inténtalo de nuevo en un momento.';
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = preview.videoWidth;
    canvas.height = preview.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      this.notice = 'No se pudo procesar la foto. Inténtalo de nuevo.';
      return;
    }
    context.drawImage(preview, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      this.notice = 'No se pudo guardar la foto. Inténtalo de nuevo.';
      return;
    }
    const file = new File([blob], `conectard-foto-${Date.now()}.jpg`, { type: 'image/jpeg' });
    this.stopCamera();
    void this.addFiles([file]);
  }

  async startRecording(): Promise<void> {
    if (!this.cameraStream || typeof MediaRecorder === 'undefined') {
      this.notice = 'Este navegador no permite grabar video. Puedes tomar una foto o elegir un video desde Galería.';
      return;
    }
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4']
      .find((type) => MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try {
      this.microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recordingStream = new MediaStream([
        ...this.cameraStream.getVideoTracks(),
        ...this.microphoneStream.getAudioTracks(),
      ]);
      recorder = mimeType
        ? new MediaRecorder(recordingStream, { mimeType })
        : new MediaRecorder(recordingStream);
      this.mediaRecorder = recorder;
    } catch (error) {
      this.microphoneStream?.getTracks().forEach((track) => track.stop());
      this.microphoneStream = undefined;
      this.notice = (error as { name?: string })?.name === 'NotAllowedError'
        ? 'Permite el acceso al micrófono para grabar video con sonido.'
        : 'No se pudo iniciar la grabación en este navegador.';
      return;
    }

    this.recordedChunks = [];
    this.discardRecording = false;
    this.recordingSeconds = 0;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size) this.recordedChunks.push(event.data);
    };
    recorder.onerror = () => {
      this.notice = 'La grabación tuvo un problema. Inténtalo otra vez.';
      this.discardRecording = true;
      this.recording = false;
      this.stopCamera();
    };
    recorder.onstop = () => {
      const chunks = this.recordedChunks;
      this.recordedChunks = [];
      const isDiscarded = this.discardRecording;
      this.discardRecording = false;
      const rawType = recorder.mimeType.split(';')[0].toLowerCase();
      const type = rawType === 'video/mp4' || rawType === 'video/quicktime' ? rawType : 'video/webm';
      const blob = new Blob(chunks, { type });
      this.stopCamera();
      if (!isDiscarded && blob.size) {
        const extension = type === 'video/mp4' ? 'mp4' : type === 'video/quicktime' ? 'mov' : 'webm';
        void this.addFiles([new File([blob], `conectard-video-${Date.now()}.${extension}`, { type })]);
      }
    };
    recorder.start(250);
    this.recording = true;
    this.recordingTimer = setInterval(() => {
      this.recordingSeconds++;
      if (this.recordingSeconds >= MEDIA_LIMITS.videoMaxSeconds) this.stopRecording();
      this.changeDetector.markForCheck();
    }, 1000);
  }

  stopRecording(): void {
    if (this.recordingTimer) clearInterval(this.recordingTimer);
    this.recordingTimer = undefined;
    this.recording = false;
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
  }

  closeCamera(): void {
    if (this.recording || this.mediaRecorder?.state === 'recording') {
      this.discardRecording = true;
      this.stopRecording();
    }
    this.stopCamera();
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
    this.closeCamera();
    for (const item of this.items) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }

  private stopCamera(): void {
    if (this.recordingTimer) clearInterval(this.recordingTimer);
    this.recordingTimer = undefined;
    this.recording = false;
    this.cameraStream?.getTracks().forEach((track) => track.stop());
    this.microphoneStream?.getTracks().forEach((track) => track.stop());
    this.cameraStream = undefined;
    this.microphoneStream = undefined;
    this.mediaRecorder = undefined;
    this.cameraOpen = false;
    this.changeDetector.markForCheck();
  }

  private cameraError(error: unknown): string {
    const name = (error as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'Permite el acceso a la cámara y al micrófono en el navegador para continuar.';
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No encontramos una cámara disponible en este dispositivo.';
    if (name === 'NotReadableError' || name === 'TrackStartError') return 'La cámara está ocupada por otra aplicación. Ciérrala e inténtalo de nuevo.';
    return 'No se pudo abrir la cámara. Revisa los permisos del navegador e inténtalo de nuevo.';
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
