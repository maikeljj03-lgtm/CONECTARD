import type { ReportComment } from '../models/community.model';
import { buildIcs, icsText } from '../utils/calendar';
import { isSafeReturnUrl } from '../utils/return-url';
import { shareTargets } from '../../shared/components/share-button/share-button.component';
import { buildThreads } from './community.service';
import { resourceProgress } from './resources.service';

const comment = (id: string, changes: Partial<ReportComment> = {}): ReportComment => ({
  id,
  report_id: 'r1',
  parent_id: null,
  body: 'Texto',
  is_deleted: false,
  is_report_author: false,
  author_name: 'Ana',
  author_avatar_url: null,
  author_role: 'citizen',
  is_mine: false,
  created_at: '2026-11-12T10:00:00.000Z',
  edited_at: null,
  ...changes,
});

describe('Comunidad (módulo 4)', () => {
  it('arma los hilos de comentarios con sus respuestas (RF-25)', () => {
    const threads = buildThreads([
      comment('a'),
      comment('b'),
      comment('a1', { parent_id: 'a' }),
      comment('a2', { parent_id: 'a' }),
    ]);
    expect(threads.map((t) => t.id)).toEqual(['a', 'b']);
    expect(threads[0].replies.map((r) => r.id)).toEqual(['a1', 'a2']);
  });

  it('un comentario eliminado solo se mantiene si tiene respuestas', () => {
    const threads = buildThreads([
      comment('a', { is_deleted: true, body: null }),
      comment('b', { is_deleted: true, body: null }),
      comment('b1', { parent_id: 'b' }),
      comment('b2', { parent_id: 'b', is_deleted: true }),
    ]);
    expect(threads.map((t) => t.id)).toEqual(['b']);
    expect(threads[0].replies.map((r) => r.id)).toEqual(['b1']);
  });

  it('calcula el avance de una solicitud de insumos sin pasarse del 100 % (RF-29, RF-30)', () => {
    expect(resourceProgress({ quantity: 20, received: 10, used: 5 })).toEqual({ received: 50, used: 25 });
    expect(resourceProgress({ quantity: 10, received: 15, used: 12 })).toEqual({ received: 100, used: 100 });
  });

  it('arma los enlaces para compartir en WhatsApp y redes con el texto codificado (RF-31)', () => {
    const targets = shareTargets('https://conectard.do/reporte/1', 'Hoyo & agua');
    const whatsapp = targets.find((t) => t.id === 'whatsapp')!;
    expect(whatsapp.url).toBe('https://wa.me/?text=Hoyo%20%26%20agua%20https%3A%2F%2Fconectard.do%2Freporte%2F1');
    expect(targets.find((t) => t.id === 'facebook')!.url).toContain('sharer.php?u=https%3A%2F%2Fconectard.do%2Freporte%2F1');
  });

  it('genera el archivo de calendario de una jornada (RF-27)', () => {
    const ics = buildIcs({
      id: 'e1', title: 'Limpieza, playa', description: 'Lleva guantes', location: 'Malecón',
      start: '2026-11-20T12:00:00.000Z', end: '2026-11-20T16:00:00.000Z', url: 'https://conectard.do/jornadas/e1',
    }, new Date('2026-11-12T00:00:00.000Z'));
    expect(ics).toContain('DTSTART:20261120T120000Z');
    expect(ics).toContain('DTEND:20261120T160000Z');
    expect(ics).toContain('SUMMARY:Limpieza\\, playa');
    expect(icsText('a;b\nc')).toBe('a\\;b\\nc');
  });

  it('solo vuelve a rutas internas después de iniciar sesión (sin redirecciones a otros sitios)', () => {
    expect(isSafeReturnUrl('/jornadas/1?asistencia=abc')).toBe(true);
    expect(isSafeReturnUrl('//evil.com')).toBe(false);
    expect(isSafeReturnUrl('https://evil.com')).toBe(false);
    expect(isSafeReturnUrl('/\\evil.com')).toBe(false);
    expect(isSafeReturnUrl('/auth/login')).toBe(false);
    expect(isSafeReturnUrl(null)).toBe(false);
  });
});
