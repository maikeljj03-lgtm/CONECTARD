// Exportación a CSV (RF-41). Compatible con Excel en español: separador ";" y BOM UTF-8
// para que las tildes y la ñ se vean bien.

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

/** Escapa un valor: comillas dobles si tiene separador, comillas o saltos de línea; neutraliza fórmulas. */
export function csvCell(value: string | number | boolean | null | undefined, separator = ';'): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Evita la "inyección de fórmulas" al abrir el archivo en Excel.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (text.includes(separator) || text.includes('"') || /[\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[], separator = ';'): string {
  const lines = [columns.map((column) => csvCell(column.header, separator)).join(separator)];
  for (const row of rows) lines.push(columns.map((column) => csvCell(column.value(row), separator)).join(separator));
  return lines.join('\r\n');
}

/** Descarga el CSV en el navegador. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Nombre de archivo con la fecha: conectard-reportes-2026-11-17.csv */
export function csvFilename(base: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `conectard-${base}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
