import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS, ROLE_LABELS } from '../../../../core/constants/catalogs';
import { AUDIT_ICONS, AUDIT_LABELS, formatHours, type AdminDashboard, type AuditAction } from '../../../../core/models/admin.model';
import type { ReportStatus } from '../../../../core/models/report.model';
import { AdminService } from '../../../../core/services/admin.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';
import { timeAgo } from '../../../../core/utils/geo';
import { STATUS_COLORS } from '../../../../shared/components/community-scene/community-scene.component';
import type { ChartSeries } from '../../components/area-chart/area-chart.component';
import type { DonutSegment } from '../../components/donut-chart/donut-chart.component';

const STATUS_ORDER: ReportStatus[] = ['reportado', 'en_revision', 'en_proceso', 'resuelto', 'rechazado'];
const ROLE_COLORS: Record<string, string> = {
  citizen: '#8a9693', volunteer: '#00b2a9', organization: '#e9a13b', institution: '#4d7fb8', administrator: '#13282b',
};

/** Resumen de la consola: métricas de impacto (RF-40), tiempos de respuesta (RF-43) y colas pendientes. */
@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: false,
})
export class AdminDashboardPage implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly auditLabels = AUDIT_LABELS;
  readonly auditIcons = AUDIT_ICONS;
  readonly formatHours = formatHours;

  data: AdminDashboard | null = null;
  loading = true;
  error = '';
  updatedAt: Date | null = null;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = !this.data;
    this.error = '';
    this.changeDetector.markForCheck();
    try {
      this.data = await this.admin.dashboard();
      this.updatedAt = new Date();
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  // ---------- Series y segmentos para las gráficas ----------

  get dailySeries(): ChartSeries[] {
    const daily = this.data?.reports.daily ?? [];
    return [
      { label: 'Reportes nuevos', color: '#00b2a9', values: daily.map((d) => d.created) },
      { label: 'Resueltos', color: '#e9a13b', values: daily.map((d) => d.resolved) },
    ];
  }

  get dailyLabels(): string[] {
    return (this.data?.reports.daily ?? []).map((d) => {
      const [, month, day] = d.day.split('-');
      return `${Number(day)}/${Number(month)}`;
    });
  }

  get created30(): number {
    return (this.data?.reports.daily ?? []).reduce((sum, d) => sum + d.created, 0);
  }

  get resolved30(): number {
    return (this.data?.reports.daily ?? []).reduce((sum, d) => sum + d.resolved, 0);
  }

  get statusSegments(): DonutSegment[] {
    const byStatus = this.data?.reports.by_status ?? {};
    return STATUS_ORDER.map((status) => ({ label: REPORT_STATUS_LABELS[status], value: byStatus[status] ?? 0, color: STATUS_COLORS[status] }));
  }

  get roleSegments(): DonutSegment[] {
    const byRole = this.data?.users.by_role ?? {};
    return Object.keys(ROLE_COLORS).map((role) => ({ label: ROLE_LABELS[role], value: byRole[role as keyof typeof byRole] ?? 0, color: ROLE_COLORS[role] }));
  }

  get resolvedRate(): number {
    const r = this.data?.reports;
    if (!r) return 0;
    const considered = r.total - (r.by_status.rechazado ?? 0);
    return considered > 0 ? Math.round(((r.by_status.resuelto ?? 0) / considered) * 100) : 0;
  }

  get pendingTotal(): number {
    const q = this.data?.queues;
    return q ? q.flags + q.verifications + q.volunteers : 0;
  }

  categoryLabel(value: string): string {
    return REPORT_CATEGORIES.find((item) => item.value === value)?.label ?? value;
  }

  categoryIcon(value: string): string {
    return REPORT_CATEGORIES.find((item) => item.value === value)?.icon ?? 'more';
  }

  barWidth(value: number, list: { n: number }[]): number {
    const max = Math.max(1, ...list.map((item) => item.n));
    return Math.round((value / max) * 100);
  }

  ago(iso: string): string {
    return timeAgo(iso);
  }

  auditIcon(action: string): string {
    return this.auditIcons[action as AuditAction] ?? 'history';
  }

  auditLabel(action: string): string {
    return this.auditLabels[action as AuditAction] ?? action;
  }
}
