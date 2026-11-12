// Archivo de calendario (.ics) para agregar una jornada al calendario del teléfono o la computadora.

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  url: string;
}

/** Fecha en formato iCalendar UTC: 20261112T150000Z. */
export function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Escapa el texto según RFC 5545 (barra, punto y coma, coma y saltos de línea). */
export function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function buildIcs(event: CalendarEvent, now: Date = new Date()): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ConectaRD//Jornadas//ES',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.id}@conectard`,
    `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(event.start)}`,
    `DTEND:${icsDate(event.end)}`,
    `SUMMARY:${icsText(event.title)}`,
    `DESCRIPTION:${icsText(`${event.description}\n\n${event.url}`)}`,
    `LOCATION:${icsText(event.location)}`,
    `URL:${event.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
