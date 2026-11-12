import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { REPORT_STATUS_LABELS } from '../../../../core/constants/catalogs';
import { DR_PROVINCES } from '../../../../core/constants/geography';
import type { EventInput } from '../../../../core/models/community.model';
import type { PublicReport } from '../../../../core/models/report.model';
import { EventsService } from '../../../../core/services/events.service';
import { ProfileService } from '../../../../core/services/profile.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';

/** Crear o editar una jornada comunitaria ligada a uno o más reportes (RF-27). */
@Component({
  selector: 'app-event-form',
  templateUrl: './event-form.page.html',
  styleUrls: ['./event-form.page.scss'],
  standalone: false,
})
export class EventFormPage implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly eventsService = inject(EventsService);
  private readonly reportsService = inject(ReportsService);
  private readonly profiles = inject(ProfileService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly provinces = DR_PROVINCES;
  readonly statusLabels = REPORT_STATUS_LABELS;
  readonly today = toDateInput(new Date());

  eventId: string | null = null;
  previousReportIds: string[] = [];
  linked: PublicReport[] = [];
  search = '';
  results: PublicReport[] = [];
  searching = false;
  loading = true;
  saving = false;
  blocked = '';
  message = '';
  private searchTimer?: ReturnType<typeof setTimeout>;

  readonly form = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(120)]],
    description: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(2000)]],
    date: ['', Validators.required],
    start: ['08:00', Validators.required],
    end: ['12:00', Validators.required],
    location_name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(200)]],
    province: [''],
    municipality: ['', Validators.maxLength(80)],
    capacity: ['' as string | number],
  });

  get isEdit(): boolean {
    return !!this.eventId;
  }

  async ngOnInit(): Promise<void> {
    this.eventId = this.route.snapshot.paramMap.get('id');
    try {
      if (this.eventId) {
        const event = await this.eventsService.get(this.eventId);
        if (!event) {
          this.blocked = 'La jornada no existe.';
        } else if (!event.is_organizer && (await this.profiles.getMyProfile()).role !== 'administrator') {
          this.blocked = 'Solo quien organiza la jornada puede editarla.';
        } else if (event.status !== 'programado') {
          this.blocked = 'Esta jornada ya terminó o fue cancelada: no se puede editar.';
        } else {
          const start = new Date(event.starts_at);
          const end = new Date(event.ends_at);
          this.form.setValue({
            title: event.title,
            description: event.description,
            date: toDateInput(start),
            start: toTimeInput(start),
            end: toTimeInput(end),
            location_name: event.location_name,
            province: event.province ?? '',
            municipality: event.municipality ?? '',
            capacity: event.capacity ?? '',
          });
          this.previousReportIds = await this.eventsService.reportIds(event.id);
          this.linked = await this.reportsService.listPublicByIds(this.previousReportIds);
        }
      } else {
        // Nueva jornada: si viene desde un reporte, se liga y se toma su zona.
        const reportId = this.route.snapshot.queryParamMap.get('reporte');
        const report = reportId ? await this.reportsService.getPublic(reportId).catch(() => null) : null;
        if (report) {
          this.linked = [report];
          this.form.patchValue({
            title: `Jornada: ${report.title}`.slice(0, 120),
            location_name: [report.address, report.sector].filter(Boolean).join(', ').slice(0, 200),
            province: report.province ?? '',
            municipality: report.municipality ?? '',
          });
        } else {
          const profile = await this.profiles.getMyProfile().catch(() => null);
          this.form.patchValue({ province: profile?.province ?? '', municipality: profile?.municipality ?? '' });
        }
      }
    } catch (error) {
      this.blocked = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  // ---------- Reportes ligados ----------

  onSearch(value: string): void {
    this.search = value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (!value.trim()) {
      this.results = [];
      return;
    }
    this.searchTimer = setTimeout(() => void this.runSearch(), 300);
  }

  isLinked(report: PublicReport): boolean {
    return this.linked.some((item) => item.id === report.id);
  }

  link(report: PublicReport): void {
    if (!this.isLinked(report) && this.linked.length < 10) this.linked = [...this.linked, report];
  }

  unlink(report: PublicReport): void {
    this.linked = this.linked.filter((item) => item.id !== report.id);
  }

  place(report: PublicReport): string {
    return [...new Set([report.sector, report.municipality, report.province].filter(Boolean))].join(', ');
  }

  private async runSearch(): Promise<void> {
    this.searching = true;
    this.changeDetector.markForCheck();
    try {
      const found = await this.reportsService.listPublic({
        search: this.search,
        province: this.form.controls.province.value || null,
        limit: 12,
      });
      this.results = found.filter((report) => report.status !== 'rechazado' && report.status !== 'resuelto');
    } catch {
      this.results = [];
    } finally {
      this.searching = false;
      this.changeDetector.markForCheck();
    }
  }

  // ---------- Guardar ----------

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.message = 'Revisa los campos marcados.';
      return;
    }
    const value = this.form.getRawValue();
    const starts = new Date(`${value.date}T${value.start}`);
    const ends = new Date(`${value.date}T${value.end}`);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
      this.message = 'La fecha o la hora no son válidas.';
      return;
    }
    if (ends <= starts) {
      this.message = 'La hora de fin debe ser después de la hora de inicio.';
      return;
    }
    if (!this.isEdit && starts.getTime() < Date.now() - 3_600_000) {
      this.message = 'La jornada no puede empezar en el pasado.';
      return;
    }
    const capacity = value.capacity === '' || value.capacity === null ? null : Number(value.capacity);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 5000)) {
      this.message = 'El cupo debe ser un número entre 1 y 5000 (o déjalo vacío si no hay límite).';
      return;
    }
    // Punto en el mapa: el del primer reporte ligado (para "Cómo llegar").
    const anchor = this.linked[0];
    const input: EventInput = {
      title: value.title,
      description: value.description,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      location_name: value.location_name,
      province: value.province || null,
      municipality: value.municipality || null,
      latitude: anchor?.latitude ?? null,
      longitude: anchor?.longitude ?? null,
      capacity,
    };

    this.saving = true;
    this.message = '';
    try {
      const ids = this.linked.map((report) => report.id);
      if (this.eventId) {
        await this.eventsService.update(this.eventId, input, ids, this.previousReportIds);
        await this.router.navigate(['/jornadas', this.eventId]);
      } else {
        const id = await this.eventsService.create(input, ids);
        await this.router.navigate(['/jornadas', id]);
      }
    } catch (error) {
      this.message = friendlyDataError(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
