import { plainText, splitRoutes } from './assistant-chat.component';

describe('Asistente (RF-47): formato de los mensajes', () => {
  it('convierte las rutas de la app en enlaces y deja el resto como texto', () => {
    expect(splitRoutes('Entra a /reportes/nuevo y luego a /explorar.')).toEqual([
      { text: 'Entra a ', route: null },
      { text: '/reportes/nuevo', route: '/reportes/nuevo' },
      { text: ' y luego a ', route: null },
      { text: '/explorar', route: '/explorar' },
      { text: '.', route: null },
    ]);
  });

  it('no convierte rutas desconocidas ni trozos de otras rutas', () => {
    expect(splitRoutes('Mira /admin o /explorarx o https://x.do/perfil/otro')).toEqual([
      { text: 'Mira /admin o /explorarx o https://x.do/perfil/otro', route: null },
    ]);
    expect(splitRoutes('')).toEqual([]);
  });

  it('no interpreta HTML: el texto queda tal cual', () => {
    const parts = splitRoutes('<img src=x onerror=alert(1)> /perfil');
    expect(parts[0]).toEqual({ text: '<img src=x onerror=alert(1)> ', route: null });
    expect(parts[1].route).toBe('/perfil');
  });

  it('quita marcas de Markdown sueltas', () => {
    expect(plainText('**Importante**: hazlo así\n## Pasos\n- Uno\n* Dos')).toBe('Importante: hazlo así\nPasos\n• Uno\n• Dos');
  });
});
