import { TestBed } from '@angular/core/testing';
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
