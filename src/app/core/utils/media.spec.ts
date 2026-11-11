import { fitWithin, formatBytes, MEDIA_LIMITS, mediaKindOf, validateMediaFile } from './media';

describe('Procesamiento de fotos y videos (RF-10, RF-11, RF-12)', () => {
  describe('fitWithin: tamaño final de la foto', () => {
    it('reduce una foto de teléfono (4032×3024) a 1600 px en el lado mayor, sin deformarla', () => {
      expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    });

    it('respeta las fotos verticales', () => {
      expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    });

    it('nunca agranda una foto pequeña', () => {
      expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    });

    it('no devuelve tamaños inválidos', () => {
      expect(fitWithin(0, 500, 1600)).toEqual({ width: 0, height: 0 });
      expect(fitWithin(10000, 3, 1600).height).toBeGreaterThanOrEqual(1);
    });
  });

  describe('mediaKindOf: tipos admitidos', () => {
    it('reconoce fotos de cualquier formato de imagen', () => {
      expect(mediaKindOf({ type: 'image/jpeg' })).toBe('image');
      expect(mediaKindOf({ type: 'image/heic' })).toBe('image');
    });

    it('admite videos MP4, WebM y MOV', () => {
      expect(mediaKindOf({ type: 'video/mp4' })).toBe('video');
      expect(mediaKindOf({ type: 'video/webm' })).toBe('video');
      expect(mediaKindOf({ type: 'video/quicktime' })).toBe('video');
    });

    it('rechaza documentos y otros archivos', () => {
      expect(mediaKindOf({ type: 'application/pdf' })).toBeNull();
      expect(mediaKindOf({ type: 'video/x-msvideo' })).toBeNull();
    });
  });

  describe('validateMediaFile: límites', () => {
    it('acepta una foto normal', () => {
      expect(validateMediaFile({ name: 'bache.jpg', type: 'image/jpeg', size: 4 * 1024 * 1024 })).toBeNull();
    });

    it('rechaza un video de más de 20 MB con un mensaje claro', () => {
      const message = validateMediaFile({ name: 'largo.mp4', type: 'video/mp4', size: MEDIA_LIMITS.videoMaxBytes + 1 });
      expect(message).toContain('largo.mp4');
      expect(message).toContain('20.0 MB');
    });

    it('rechaza un tipo de archivo no admitido', () => {
      expect(validateMediaFile({ name: 'acta.pdf', type: 'application/pdf', size: 1000 })).toContain('acta.pdf');
    });
  });

  it('formatBytes muestra tamaños legibles', () => {
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(formatBytes(830 * 1024)).toBe('830 KB');
    expect(formatBytes(10)).toBe('1 KB');
  });
});
