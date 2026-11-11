import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import type { Profile } from '../../../../core/models/profile.model';
import { RolesService } from '../../../../core/services/roles.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';

/** Revisión de solicitudes de voluntariado (RF-03). */
@Component({
  selector: 'app-admin-volunteers',
  templateUrl: './volunteers.page.html',
  standalone: false,
})
export class AdminVolunteersPage implements OnInit {
  private readonly roles = inject(RolesService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  requests: Profile[] = [];
  notes: Record<string, string> = {};
  loading = true;
  busyId = '';
  error = '';
  feedback = '';

  async ngOnInit(): Promise<void> {
    try {
      this.requests = await this.roles.listVolunteerRequests();
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  initials(name: string): string {
    return (name.trim() || '?').split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  }

  place(profile: Profile): string {
    return [profile.sector, profile.municipality, profile.province].filter(Boolean).join(', ') || 'Zona no indicada';
  }

  async review(profile: Profile, approve: boolean): Promise<void> {
    const notes = this.notes[profile.id] ?? '';
    if (!approve && !notes.trim()) {
      this.error = 'Escribe el motivo del rechazo para que la persona sepa qué hacer.';
      return;
    }
    this.busyId = profile.id;
    this.error = '';
    this.feedback = '';
    try {
      await this.roles.reviewVolunteer(profile.id, approve, notes);
      this.requests = this.requests.filter((item) => item.id !== profile.id);
      const name = profile.full_name || 'La persona';
      this.feedback = approve ? `${name} ya es voluntario.` : `Se rechazó la solicitud de ${name}.`;
    } catch (error) {
      this.error = friendlyDataError(error);
    } finally {
      this.busyId = '';
      this.changeDetector.markForCheck();
    }
  }
}
