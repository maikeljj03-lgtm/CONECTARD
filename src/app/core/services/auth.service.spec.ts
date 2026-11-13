import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService · dispositivos de confianza', () => {
  let auth: AuthService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    auth = TestBed.inject(AuthService);
  });

  it('un dispositivo nuevo no es de confianza (pide código)', () => {
    expect(auth.isDeviceTrusted('usuario-1')).toBe(false);
  });

  it('después de confirmar el código, el dispositivo queda recordado para esa cuenta', () => {
    auth.trustDevice('usuario-1');
    expect(auth.isDeviceTrusted('usuario-1')).toBe(true);
  });

  it('recordar un dispositivo para una cuenta no sirve para otra cuenta', () => {
    auth.trustDevice('usuario-1');
    expect(auth.isDeviceTrusted('usuario-2')).toBe(false);
  });

  it('la confianza vence y vuelve a pedir el código', () => {
    localStorage.setItem('conectard.trusted-devices', JSON.stringify({ 'usuario-1': Date.now() - 1000 }));
    expect(auth.isDeviceTrusted('usuario-1')).toBe(false);
  });

  it('si el almacenamiento está dañado, pide el código en vez de fallar', () => {
    localStorage.setItem('conectard.trusted-devices', '{no es json');
    expect(auth.isDeviceTrusted('usuario-1')).toBe(false);
  });
});

describe('AuthService · timeout de carga de archivos', () => {
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    auth = TestBed.inject(AuthService);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('permite que la subida de foto/video supere los 10 segundos', async () => {
    const fetchWithTimeout = (auth as unknown as { fetchWithTimeout: typeof fetch }).fetchWithTimeout;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        setTimeout(resolve, 20_000);
      });
      return new Response(null, { status: 200 });
    });

    const upload = fetchWithTimeout('https://example.supabase.co/storage/v1/object/report-media/test.webp');
    const assertion = expect(upload).resolves.toMatchObject({ status: 200 });
    await vi.advanceTimersByTimeAsync(20_000);

    await assertion;
  });

  it('mantiene el límite de 10 segundos para peticiones API normales', async () => {
    const fetchWithTimeout = (auth as unknown as { fetchWithTimeout: typeof fetch }).fetchWithTimeout;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));

    const request = fetchWithTimeout('https://example.supabase.co/rest/v1/reports');
    const assertion = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
  });
});
