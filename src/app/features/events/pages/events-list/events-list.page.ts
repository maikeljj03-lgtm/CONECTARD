import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ROLE_LABELS } from '../../../../core/constants/catalogs';
import { DR_PROVINCES } from '../../../../core/constants/geography';
import type { CommunityEvent } from '../../../../core/models/community.model';
import { AuthService } from '../../../../core/services/auth.service';
import { EventsService } from '../../../../core/services/events.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';

type Tab = 'proximas' | 'mias' | 'pasadas';

/** Jornadas comunitarias (RF-27): próximas, las mías (organizo o me inscribí) y pasadas. Pública. */
@Component({
  selector: 'app-events-list',
  templateUrl: './events-list.page.html',
  styleUrls: ['./events-list.page.scss'],
  standalone: false,
})
export class EventsListPage implements OnInit {
  private readonly eventsService = inject(EventsService);
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly provinces = DR_PROVINCES;
  readonly roleLabels = ROLE_LABELS;

  signedIn = false;
  tab: Tab = 'proximas';
  province = '';
  events: CommunityEvent[] = [];
  loading = true;
  error = '';

  async ngOnInit(): Promise<void> {
    this.signedIn = !!this.auth.getCachedCurrentUser();
    await this.load();
  }

  async setTab(tab: Tab): Promise<void> {
    this.tab = tab;
    await this.load();
  }

  async setProvince(province: string): Promise<void> {
    this.province = province;
    await this.load();
  }

  spotsLeft(event: CommunityEvent): number | null {
    return event.capacity === null ? null : Math.max(0, event.capacity - event.attendee_count);
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.changeDetector.markForCheck();
    try {
      this.events = await this.eventsService.list({
        past: this.tab === 'pasadas',
        mine: this.tab === 'mias',
        province: this.province || null,
      });
    } catch (error) {
      this.error = friendlyDataError(error);
      this.events = [];
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }
}
