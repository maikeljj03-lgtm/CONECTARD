// RF-46: huella de una foto y datos de cámara, calculados en el teléfono antes de comprimirla.
// - La huella (dHash de 64 bits) es igual o casi igual para la misma foto aunque se haya
//   recomprimido o cambiado de tamaño; así se detectan fotos repetidas entre reportes.
// - Los datos de cámara (EXIF: marca, modelo o fecha de la toma) suelen faltar en fotos
//   bajadas de internet, capturas de pantalla o reenviadas por WhatsApp. Es solo una señal
//   para la moderación, nunca una prueba.

/** Ancho y alto de la miniatura para la huella: 9 × 8 da 8 comparaciones por fila × 8 filas = 64 bits. */
export const FINGERPRINT_WIDTH = 9;
export const FINGERPRINT_HEIGHT = 8;

/**
 * Huella dHash a partir de los píxeles RGBA de una miniatura de 9 × 8.
 * Cada bit dice si un píxel es más claro que su vecino de la derecha. Devuelve 16 caracteres hex.
 */
export function differenceHash(rgba: ArrayLike<number>): string {
  if (rgba.length < FINGERPRINT_WIDTH * FINGERPRINT_HEIGHT * 4) throw new Error('Faltan píxeles para la huella.');
  const gray = (x: number, y: number) => {
    const i = (y * FINGERPRINT_WIDTH + x) * 4;
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  };
  let hex = '';
  for (let y = 0; y < FINGERPRINT_HEIGHT; y++) {
    // Cada fila da 8 bits = 2 caracteres hex.
    let byte = 0;
    for (let x = 0; x < FINGERPRINT_WIDTH - 1; x++) {
      byte = (byte << 1) | (gray(x, y) > gray(x + 1, y) ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Cuántos bits cambian entre dos huellas (0 = idénticas, 64 = opuestas). */
export function hammingDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) throw new Error('Huella no válida.');
  let distance = 0;
  for (let i = 0; i < 16; i++) {
    let diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (diff) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance;
}

// ---------- Datos de cámara (EXIF) ----------

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_ORIGINAL = 0x9003;

/**
 * ¿La foto trae datos de la cámara? true si el EXIF tiene marca, modelo o fecha de la toma;
 * false si es JPEG, PNG o WebP sin esos datos; null si el formato no se reconoce (no se sabe).
 */
export function hasCameraData(bytes: Uint8Array): boolean | null {
  const format = imageFormat(bytes);
  if (!format) return null;
  const tiff = format === 'jpeg' ? findJpegExif(bytes) : format === 'png' ? findPngExif(bytes) : findWebpExif(bytes);
  return tiff ? tiffHasCameraTags(tiff) : false;
}

function imageFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  return null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (start + length > bytes.length) return '';
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** JPEG: el EXIF está en un segmento APP1 que empieza por "Exif\0\0". */
function findJpegExif(bytes: Uint8Array): Uint8Array | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // Relleno entre segmentos.
    if (marker === 0xff) {
      offset++;
      continue;
    }
    // Inicio de la imagen comprimida o fin: ya no hay más metadatos.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    if (marker === 0xe1 && ascii(bytes, offset + 4, 6) === 'Exif\0\0') {
      return bytes.subarray(offset + 10, Math.min(bytes.length, offset + 2 + length));
    }
    offset += 2 + length;
  }
  return null;
}

/** PNG: bloque "eXIf" con el TIFF directo. */
function findPngExif(bytes: Uint8Array): Uint8Array | null {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset, false);
    const type = ascii(bytes, offset + 4, 4);
    if (type === 'eXIf') return bytes.subarray(offset + 8, Math.min(bytes.length, offset + 8 + length));
    if (type === 'IEND') return null;
    offset += 12 + length;
  }
  return null;
}

/** WebP: bloque "EXIF" (algunos programas le anteponen "Exif\0\0"). */
function findWebpExif(bytes: Uint8Array): Uint8Array | null {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = readUint32(bytes, offset + 4, true);
    if (type === 'EXIF') {
      let start = offset + 8;
      if (ascii(bytes, start, 6) === 'Exif\0\0') start += 6;
      return bytes.subarray(start, Math.min(bytes.length, offset + 8 + length));
    }
    // Los bloques de tamaño impar llevan un byte de relleno.
    offset += 8 + length + (length % 2);
  }
  return null;
}

/** Busca marca, modelo (IFD0) o fecha de la toma (sub-IFD Exif) en un bloque TIFF. */
function tiffHasCameraTags(tiff: Uint8Array): boolean {
  if (tiff.length < 8) return false;
  const order = ascii(tiff, 0, 2);
  if (order !== 'II' && order !== 'MM') return false;
  const little = order === 'II';
  if (readUint16(tiff, 2, little) !== 42) return false;
  const ifd0 = readUint32(tiff, 4, little);
  const entries = readIfd(tiff, ifd0, little);
  if (!entries) return false;
  if (entries.some((entry) => (entry.tag === TAG_MAKE || entry.tag === TAG_MODEL) && entry.count > 1)) return true;
  const exifPointer = entries.find((entry) => entry.tag === TAG_EXIF_IFD);
  if (!exifPointer) return false;
  const exifEntries = readIfd(tiff, exifPointer.value, little);
  return !!exifEntries?.some((entry) => entry.tag === TAG_DATE_ORIGINAL && entry.count > 1);
}

function readIfd(tiff: Uint8Array, offset: number, little: boolean): { tag: number; count: number; value: number }[] | null {
  if (offset < 8 || offset + 2 > tiff.length) return null;
  const count = readUint16(tiff, offset, little);
  // Un IFD real no tiene cientos de entradas: evita recorrer basura.
  if (count === 0 || count > 500 || offset + 2 + count * 12 > tiff.length) return null;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const start = offset + 2 + i * 12;
    entries.push({ tag: readUint16(tiff, start, little), count: readUint32(tiff, start + 4, little), value: readUint32(tiff, start + 8, little) });
  }
  return entries;
}

function readUint16(bytes: Uint8Array, offset: number, little: boolean): number {
  if (offset + 2 > bytes.length) return 0;
  return little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number, little: boolean): number {
  if (offset + 4 > bytes.length) return 0;
  const value = little
    ? bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)
    : (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
  return value >>> 0;
}
