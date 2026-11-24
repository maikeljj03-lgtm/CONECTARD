import { differenceHash, hammingDistance, hasCameraData } from './image-fingerprint';

/** Miniatura 9 × 8 en RGBA a partir de una función de gris por píxel. */
function thumbnail(gray: (x: number, y: number) => number): Uint8Array {
  const pixels = new Uint8Array(9 * 8 * 4);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 9; x++) {
      const value = Math.max(0, Math.min(255, Math.round(gray(x, y))));
      pixels.set([value, value, value, 255], (y * 9 + x) * 4);
    }
  }
  return pixels;
}

/** Bloque TIFF con las etiquetas indicadas en IFD0 (y opcionalmente un sub-IFD Exif con la fecha). */
function tiff(little: boolean, tags: number[], withDateOriginal = false): Uint8Array {
  const entries = [...tags];
  if (withDateOriginal) entries.push(0x8769);
  const ifd0Size = 2 + entries.length * 12 + 4;
  const exifOffset = 8 + ifd0Size;
  const size = exifOffset + (withDateOriginal ? 2 + 12 + 4 : 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(little ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, entries.length, little);
  entries.forEach((tag, i) => {
    const start = 10 + i * 12;
    view.setUint16(start, tag, little);
    view.setUint16(start + 2, tag === 0x8769 ? 4 : 2, little);
    view.setUint32(start + 4, tag === 0x8769 ? 1 : 8, little);
    view.setUint32(start + 8, tag === 0x8769 ? exifOffset : 0, little);
  });
  if (withDateOriginal) {
    view.setUint16(exifOffset, 1, little);
    view.setUint16(exifOffset + 2, 0x9003, little);
    view.setUint16(exifOffset + 4, 2, little);
    view.setUint32(exifOffset + 6, 20, little);
  }
  return bytes;
}

const concat = (...parts: (Uint8Array | number[])[]) => {
  const arrays = parts.map((part) => (part instanceof Uint8Array ? part : Uint8Array.from(part)));
  const out = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of arrays) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const text = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0));
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

function jpeg(exif: Uint8Array | null): Uint8Array {
  const parts: (Uint8Array | number[])[] = [[0xff, 0xd8], [0xff, 0xe0, 0x00, 0x10], new Uint8Array(14)];
  if (exif) {
    const payload = concat(text('Exif\0\0'), exif);
    parts.push([0xff, 0xe1, ((payload.length + 2) >> 8) & 255, (payload.length + 2) & 255], payload);
  }
  parts.push([0xff, 0xda, 0x00, 0x08], new Uint8Array(6), [0xff, 0xd9]);
  return concat(...parts);
}

describe('Huella de fotos y datos de cámara (RF-46)', () => {
  it('calcula una huella de 16 caracteres hex y es estable', () => {
    const gradient = thumbnail((x, y) => 255 - x * 25 - y * 3);
    const hash = differenceHash(gradient);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    // Cada píxel es más claro que el de su derecha: todos los bits en 1.
    expect(hash).toBe('ffffffffffffffff');
    expect(differenceHash(thumbnail((x) => x * 25))).toBe('0000000000000000');
  });

  it('la misma foto más clara o más oscura conserva la huella', () => {
    const scene = (x: number, y: number) => 120 + 60 * Math.sin(x * 1.3 + y * 0.7) + 25 * Math.cos(y * 1.9);
    const original = differenceHash(thumbnail(scene));
    const brighter = differenceHash(thumbnail((x, y) => scene(x, y) * 1.1 + 12));
    expect(hammingDistance(original, brighter)).toBeLessThanOrEqual(2);
  });

  it('fotos distintas quedan lejos', () => {
    const a = differenceHash(thumbnail((x, y) => 120 + 60 * Math.sin(x * 1.3 + y * 0.7)));
    const b = differenceHash(thumbnail((x, y) => 120 + 60 * Math.cos(x * 0.4 - y * 2.1)));
    expect(hammingDistance(a, b)).toBeGreaterThan(10);
  });

  it('cuenta los bits distintos entre dos huellas', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('a5b3c7d91e2f4860', 'a5b3c7d91e2f4861')).toBe(1);
    expect(() => hammingDistance('xyz', '0000000000000000')).toThrow();
  });

  it('rechaza una miniatura incompleta', () => {
    expect(() => differenceHash(new Uint8Array(10))).toThrow();
  });

  it('JPEG con marca y modelo de cámara → tiene datos de cámara', () => {
    expect(hasCameraData(jpeg(tiff(true, [0x010f, 0x0110])))).toBe(true);
    expect(hasCameraData(jpeg(tiff(false, [0x010f])))).toBe(true);
  });

  it('JPEG con solo la fecha de la toma (sub-IFD Exif) → tiene datos de cámara', () => {
    expect(hasCameraData(jpeg(tiff(false, [0x0112], true)))).toBe(true);
  });

  it('JPEG sin EXIF o con EXIF sin datos de cámara → no tiene', () => {
    expect(hasCameraData(jpeg(null))).toBe(false);
    expect(hasCameraData(jpeg(tiff(true, [0x0112, 0x011a])))).toBe(false);
  });

  it('PNG: captura sin EXIF → no tiene; con bloque eXIf de cámara → sí', () => {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = concat(u32be(13), text('IHDR'), new Uint8Array(13), [0, 0, 0, 0]);
    const iend = concat(u32be(0), text('IEND'), [0, 0, 0, 0]);
    expect(hasCameraData(concat(signature, ihdr, iend))).toBe(false);
    const exif = tiff(true, [0x010f]);
    const chunk = concat(u32be(exif.length), text('eXIf'), exif, [0, 0, 0, 0]);
    expect(hasCameraData(concat(signature, ihdr, chunk, iend))).toBe(true);
  });

  it('WebP con bloque EXIF (con o sin prefijo "Exif") → tiene datos de cámara', () => {
    const vp8 = concat(text('VP8 '), u32le(3), [1, 2, 3, 0]);
    const plain = tiff(true, [0x0110]);
    const withPrefix = concat(text('Exif\0\0'), plain);
    for (const payload of [plain, withPrefix]) {
      const exifChunk = concat(text('EXIF'), u32le(payload.length), payload, payload.length % 2 ? [0] : []);
      const body = concat(text('WEBP'), vp8, exifChunk);
      expect(hasCameraData(concat(text('RIFF'), u32le(body.length), body))).toBe(true);
    }
    const bare = concat(text('WEBP'), vp8);
    expect(hasCameraData(concat(text('RIFF'), u32le(bare.length), bare))).toBe(false);
  });

  it('formatos desconocidos o datos rotos no fallan', () => {
    expect(hasCameraData(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(hasCameraData(new Uint8Array(0))).toBeNull();
    const broken = jpeg(tiff(true, [0x010f])).subarray(0, 30);
    expect(hasCameraData(broken)).toBe(false);
    const bogus = jpeg(concat(text('II'), [42, 0], u32le(999999)));
    expect(hasCameraData(bogus)).toBe(false);
  });
});
