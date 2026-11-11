// Procesamiento de fotos y videos en el dispositivo, antes de subirlos (RF-10, RF-11, RF-12).

export const MEDIA_LIMITS = {
  maxItems: 5,
  /** Lado mayor de la foto final, en píxeles. Suficiente para ver detalles en el teléfono. */
  imageMaxDimension: 1600,
  imageQuality: 0.8,
  /** Fotos originales más grandes que esto se rechazan (antes de comprimir). */
  imageMaxInputBytes: 40 * 1024 * 1024,
  videoMaxBytes: 20 * 1024 * 1024,
  videoMaxSeconds: 30,
} as const;

export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

export type MediaKind = 'image' | 'video';

export interface ProcessedMedia {
  kind: MediaKind;
  blob: Blob;
  mimeType: string;
  /** Extensión del archivo a subir, sin punto. */
  extension: string;
  originalBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

/** Tipo de archivo según su MIME, o null si no se admite. */
export function mediaKindOf(file: { type: string }): MediaKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if ((VIDEO_TYPES as readonly string[]).includes(file.type)) return 'video';
  return null;
}

/** Reduce (w, h) para que el lado mayor no pase de max, sin agrandar nunca. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** "2.4 MB", "830 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Valida un archivo antes de procesarlo. Devuelve el mensaje de error o null. */
export function validateMediaFile(file: { name: string; type: string; size: number }): string | null {
  const kind = mediaKindOf(file);
  if (!kind) return `“${file.name}” no es una foto ni un video compatible (MP4, WebM o MOV).`;
  if (kind === 'image' && file.size > MEDIA_LIMITS.imageMaxInputBytes) return `“${file.name}” es demasiado grande.`;
  if (kind === 'video' && file.size > MEDIA_LIMITS.videoMaxBytes) {
    return `“${file.name}” pesa ${formatBytes(file.size)}; el máximo para videos es ${formatBytes(MEDIA_LIMITS.videoMaxBytes)}.`;
  }
  return null;
}

/** Procesa una foto o video según su tipo. Lanza un Error con mensaje en español si no se puede. */
export async function processMediaFile(file: File): Promise<ProcessedMedia> {
  const problem = validateMediaFile(file);
  if (problem) throw new Error(problem);
  return mediaKindOf(file) === 'video' ? processVideo(file) : compressImage(file);
}

/**
 * Comprime una foto (RF-12): reduce su tamaño, la endereza según la orientación de la
 * cámara y la vuelve a codificar. Al recodificarla se pierden los metadatos EXIF,
 * incluida la ubicación GPS de la cámara, lo que protege la privacidad.
 */
export async function compressImage(file: File): Promise<ProcessedMedia> {
  const source = await decodeImage(file);
  try {
    const { width, height } = fitWithin(source.width, source.height, MEDIA_LIMITS.imageMaxDimension);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Tu navegador no permite procesar imágenes.');
    // Fondo blanco: las imágenes con transparencia (PNG) no quedan negras en JPEG.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(source.image, 0, 0, width, height);

    // WebP pesa menos; si el navegador no sabe generarlo, se usa JPEG.
    let blob = await canvasToBlob(canvas, 'image/webp', MEDIA_LIMITS.imageQuality);
    if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', MEDIA_LIMITS.imageQuality);
    if (!blob) throw new Error(`No se pudo procesar “${file.name}”.`);
    const isWebp = blob.type === 'image/webp';
    return {
      kind: 'image',
      blob,
      mimeType: isWebp ? 'image/webp' : 'image/jpeg',
      extension: isWebp ? 'webp' : 'jpg',
      originalBytes: file.size,
      width,
      height,
      durationSeconds: null,
    };
  } finally {
    source.release();
  }
}

/** Videos cortos (RF-10/RF-11): se comprueban duración y tamaño; no se recomprimen en el teléfono. */
export async function processVideo(file: File): Promise<ProcessedMedia> {
  const metadata = await readVideoMetadata(file);
  if (metadata.duration > MEDIA_LIMITS.videoMaxSeconds + 0.5) {
    throw new Error(`“${file.name}” dura ${Math.round(metadata.duration)} s; el máximo es ${MEDIA_LIMITS.videoMaxSeconds} s.`);
  }
  const extension = file.type === 'video/webm' ? 'webm' : file.type === 'video/quicktime' ? 'mov' : 'mp4';
  return {
    kind: 'video',
    blob: file,
    mimeType: file.type,
    extension,
    originalBytes: file.size,
    width: metadata.width || null,
    height: metadata.height || null,
    durationSeconds: Math.round(metadata.duration * 10) / 10,
  };
}

// ---------- Ayudantes del navegador ----------

interface DecodedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

async function decodeImage(file: File): Promise<DecodedImage> {
  // createImageBitmap aplica la orientación EXIF (fotos de teléfono giradas).
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Se intenta con <img> abajo.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`“${file.name}” no se pudo abrir. Prueba con una foto JPG o PNG.`));
      element.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function readVideoMetadata(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const finish = (callback: () => void) => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      callback();
    };
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => finish(() => resolve({
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      width: video.videoWidth,
      height: video.videoHeight,
    }));
    video.onerror = () => finish(() => reject(new Error(`“${file.name}” no se pudo leer. Prueba con un video MP4.`)));
    video.src = url;
  });
}
