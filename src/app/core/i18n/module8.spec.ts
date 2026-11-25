import { REPORT_CATEGORIES, REPORT_STATUS_LABELS } from '../constants/catalogs';
import { activityPeriod, hoursLabel } from '../utils/certificate-pdf';
import { appendDictation } from '../../shared/components/dictation-button/dictation-button.component';
import { CERTIFICATE_CODE, normalizeCertificateCode } from '../../features/open-data/pages/verify-certificate/verify-certificate.page';
import { readGeoJson } from '../../features/admin/pages/cadastre/cadastre.page';
import { t } from './i18n';
import { MESSAGES } from './messages';

describe('Módulo 8 · idiomas (RF-56)', () => {
  it('cada texto tiene español, inglés y creole, sin huecos', () => {
    for (const [key, [es, en, ht]] of Object.entries(MESSAGES)) {
      expect(es.trim(), key).not.toBe('');
      expect(en.trim(), key).not.toBe('');
      expect(ht.trim(), key).not.toBe('');
    }
  });

  it('traduce según el idioma y reemplaza los marcadores', () => {
    expect(t('nav.home', undefined, 'es')).toBe('Inicio');
    expect(t('nav.home', undefined, 'en')).toBe('Home');
    expect(t('nav.home', undefined, 'ht')).toBe('Akèy');
    expect(t('survey.thanks', { n: 4 }, 'en')).toBe('Thank you! You rated the solution 4 out of 5.');
    expect(t('new.withNameHint', { name: 'Ana' }, 'es')).toBe('Aparece “Ana” como autor.');
  });

  it('los marcadores de cada idioma coinciden con los del español', () => {
    const marks = (text: string) => (text.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
    for (const [key, [es, en, ht]] of Object.entries(MESSAGES)) {
      expect(marks(en), key).toBe(marks(es));
      expect(marks(ht), key).toBe(marks(es));
    }
  });

  it('los catálogos salen en el idioma de la app (español en las pruebas)', () => {
    expect(REPORT_CATEGORIES[0].label).toBe('Basura y limpieza');
    expect(REPORT_STATUS_LABELS['en_proceso']).toBe('En proceso');
  });
});

describe('Módulo 8 · dictado por voz (RF-55)', () => {
  it('une lo dictado al texto con espacios y mayúscula al empezar oración', () => {
    expect(appendDictation('', 'hay un hoyo grande', 2000)).toBe('Hay un hoyo grande');
    expect(appendDictation('Hay un hoyo.', 'desde ayer', 2000)).toBe('Hay un hoyo. Desde ayer');
    expect(appendDictation('Hay un hoyo', 'frente a la escuela', 2000)).toBe('Hay un hoyo frente a la escuela');
    expect(appendDictation('Texto  ', '   ', 2000)).toBe('Texto  ');
  });

  it('nunca pasa del máximo de caracteres', () => {
    expect(appendDictation('a'.repeat(1995), 'palabras de más', 2000)).toHaveLength(2000);
  });
});

describe('Módulo 8 · constancias (RF-62)', () => {
  it('normaliza el código como lo escribe la gente', () => {
    expect(normalizeCertificateCode(' crd-1a2b3-c4d5e ')).toBe('CRD-1A2B3-C4D5E');
    expect(normalizeCertificateCode('CRD1A2B3C4D5E')).toBe('CRD-1A2B3-C4D5E');
    expect(normalizeCertificateCode('1a2b3 c4d5e')).toBe('CRD-1A2B3-C4D5E');
    expect(CERTIFICATE_CODE.test(normalizeCertificateCode('crd 1a2b3 c4d5e'))).toBe(true);
    expect(CERTIFICATE_CODE.test(normalizeCertificateCode('hola'))).toBe(false);
  });

  it('describe horas y período en español', () => {
    expect(hoursLabel(1)).toBe('1 hora');
    expect(hoursLabel(15)).toBe('15 horas');
    expect(hoursLabel(2.25)).toBe('2.3 horas');
    expect(activityPeriod(null, null)).toBe('');
    expect(activityPeriod('2027-03-03', '2027-03-03')).toContain('el 3 de marzo de 2027');
    expect(activityPeriod('2027-03-03', '2027-05-20')).toMatch(/^del 3 de marzo de 2027 al 20 de mayo de 2027$/);
  });
});

describe('Módulo 8 · catastro (RF-59)', () => {
  it('acepta un FeatureCollection y rechaza lo demás con un mensaje claro', () => {
    expect('collection' in readGeoJson('{"type":"FeatureCollection","features":[{"type":"Feature"}]}')).toBe(true);
    expect(readGeoJson('no es json')).toEqual({ error: 'El archivo no es un JSON válido.' });
    expect((readGeoJson('{"type":"Feature"}') as { error: string }).error).toContain('FeatureCollection');
    expect((readGeoJson('{"type":"FeatureCollection","features":[]}') as { error: string }).error).toContain('no tiene zonas');
    const big = JSON.stringify({ type: 'FeatureCollection', features: Array.from({ length: 5001 }, () => ({})) });
    expect((readGeoJson(big) as { error: string }).error).toContain('5000');
  });
});
