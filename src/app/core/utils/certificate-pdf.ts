import type { Certificate } from '../services/platform.service';

/** Texto de un período de actividad: "del 3 de marzo al 20 de mayo de 2027". */
export function activityPeriod(first: string | null, last: string | null): string {
  if (!first || !last) return '';
  const format = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' });
  return first === last ? `el ${format(first)}` : `del ${format(first)} al ${format(last)}`;
}

/** "15 horas", "1 hora", "2.5 horas". */
export function hoursLabel(hours: number): string {
  const value = Math.round(hours * 10) / 10;
  return `${value.toLocaleString('es-DO')} ${value === 1 ? 'hora' : 'horas'}`;
}

/**
 * Genera y descarga la constancia en PDF (RF-62). jsPDF se carga solo cuando hace falta,
 * así no pesa en la app. Incluye el código y el enlace para verificarla.
 */
export async function downloadCertificatePdf(certificate: Certificate, verifyUrl: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const center = width / 2;

  doc.setProperties({ title: `Constancia de voluntariado ${certificate.code}`, subject: 'ConectaRD', creator: 'ConectaRD' });

  // Marco con los colores de la marca.
  doc.setFillColor(251, 250, 247);
  doc.rect(0, 0, width, height, 'F');
  doc.setDrawColor(0, 178, 169);
  doc.setLineWidth(1.4);
  doc.roundedRect(10, 10, width - 20, height - 20, 4, 4);
  doc.setDrawColor(233, 161, 59);
  doc.setLineWidth(0.5);
  doc.roundedRect(14, 14, width - 28, height - 28, 3, 3);

  doc.setTextColor(0, 130, 123);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('CONECTARD', center, 32, { align: 'center' });
  doc.setTextColor(19, 40, 43);
  doc.setFontSize(30);
  doc.text('Constancia de voluntariado', center, 50, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(78, 95, 97);
  doc.text('Se hace constar que', center, 66, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(19, 40, 43);
  doc.text(certificate.full_name, center, 80, { align: 'center', maxWidth: width - 60 });

  const period = activityPeriod(certificate.first_activity, certificate.last_activity);
  const parts = [
    `realizó trabajo voluntario${period ? ` ${period}` : ''} en actividades comunitarias registradas en ConectaRD:`,
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(78, 95, 97);
  doc.text(doc.splitTextToSize(parts.join(' '), width - 80), center, 94, { align: 'center' });

  // Cifras.
  const stats: [string, string][] = [
    [hoursLabel(certificate.hours), 'en jornadas con asistencia confirmada por código QR'],
    [String(certificate.events), certificate.events === 1 ? 'jornada comunitaria' : 'jornadas comunitarias'],
    [String(certificate.reports_helped), certificate.reports_helped === 1 ? 'reporte al que se sumó' : 'reportes a los que se sumó'],
  ];
  const boxWidth = 70;
  const gap = 10;
  const startX = center - (boxWidth * 3 + gap * 2) / 2;
  stats.forEach(([value, label], index) => {
    const x = startX + index * (boxWidth + gap);
    doc.setFillColor(227, 245, 243);
    doc.roundedRect(x, 110, boxWidth, 34, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(0, 130, 123);
    doc.text(value, x + boxWidth / 2, 124, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(78, 95, 97);
    doc.text(doc.splitTextToSize(label, boxWidth - 8), x + boxWidth / 2, 132, { align: 'center' });
  });

  // Código y verificación.
  const issued = new Date(certificate.issued_at).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' });
  doc.setFontSize(11);
  doc.setTextColor(78, 95, 97);
  doc.text(`Emitida el ${issued}.`, center, 160, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(19, 40, 43);
  doc.text(`Código de verificación: ${certificate.code}`, center, 170, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(0, 130, 123);
  doc.textWithLink(`Verifícala en ${verifyUrl}`, center, 178, { align: 'center', url: verifyUrl });
  doc.setTextColor(125, 138, 137);
  doc.setFontSize(8.5);
  doc.text('Las horas se calculan con la duración de cada jornada a la que asistió (máximo 12 horas por jornada).', center, 188, { align: 'center' });

  doc.save(`constancia-voluntariado-${certificate.code}.pdf`);
}
