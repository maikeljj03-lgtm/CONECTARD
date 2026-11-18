import { formatHours } from '../models/admin.model';
import { csvCell, csvFilename, toCsv } from './csv';

describe('Exportación a CSV (RF-41) y tiempos de la consola', () => {
  it('escapa separadores, comillas y saltos de línea', () => {
    expect(csvCell('Hoyo; grande')).toBe('"Hoyo; grande"');
    expect(csvCell('Dijo "hola"')).toBe('"Dijo ""hola"""');
    expect(csvCell('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12)).toBe('12');
  });

  it('neutraliza fórmulas para que Excel no las ejecute', () => {
    expect(csvCell('=HYPERLINK("http://malo")')).toBe(`"'=HYPERLINK(""http://malo"")"`);
    expect(csvCell('+1-2')).toBe("'+1-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('arma el archivo con encabezados y filas separadas por ;', () => {
    const csv = toCsv([{ a: 'Ñoño', b: 3 }], [{ header: 'Nombre', value: (r) => r.a }, { header: 'Total', value: (r) => r.b }]);
    expect(csv).toBe('Nombre;Total\r\nÑoño;3');
  });

  it('pone la fecha en el nombre del archivo', () => {
    expect(csvFilename('reportes', new Date(2026, 10, 7))).toBe('conectard-reportes-2026-11-07.csv');
  });

  it('muestra los tiempos de respuesta de forma legible', () => {
    expect(formatHours(null)).toBe('—');
    expect(formatHours(0.25)).toBe('15 min');
    expect(formatHours(21.54)).toBe('21.5 h');
    expect(formatHours(86.2)).toBe('3.6 días');
  });
});
