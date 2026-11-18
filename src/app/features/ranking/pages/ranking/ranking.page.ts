import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ROLE_LABELS } from '../../../../core/constants/catalogs';
import { DR_PROVINCES } from '../../../../core/constants/geography';
import { POINT_RULES, type RankingAudience, type RankingPeriod, type RankingRow } from '../../../../core/models/engagement.model';
import { AuthService } from '../../../../core/services/auth.service';
import { EngagementService } from '../../../../core/services/engagement.service';
import { friendlyDataError } from '../../../../core/utils/data-errors';

/** Ranking comunitario (RF-38): personas u organizaciones, por mes, año o histórico, y por provincia. Público. */
@Component({
  selector: 'app-ranking',
  templateUrl: './ranking.page.html',
  styleUrls: ['./ranking.page.scss'],
  standalone: false,
})
export class RankingPage implements OnInit {
  private readonly engagement = inject(EngagementService);
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly provinces = DR_PROVINCES;
  readonly roleLabels = ROLE_LABELS;
  readonly rules = POINT_RULES;
  readonly periods: { value: RankingPeriod; label: string }[] = [
    { value: 'mes', label: 'Este mes' },
    { value: 'anio', label: 'Este año' },
    { value: 'todo', label: 'Histórico' },
  ];

  signedIn = false;
  period: RankingPeriod = 'mes';
  audience: RankingAudience = 'personas';
  province = '';
  rows: RankingRow[] = [];
  loading = true;
  error = '';

  async ngOnInit(): Promise<void> {
    this.signedIn = !!this.auth.getCachedCurrentUser();
    await this.load();
  }

  get podium(): RankingRow[] {
    return this.rows.slice(0, 3);
  }

  get rest(): RankingRow[] {
    return this.rows.slice(3);
  }

  get me(): RankingRow | undefined {
    return this.rows.find((row) => row.is_me);
  }

  initials(name: string): string {
    return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  }

  async setPeriod(period: RankingPeriod): Promise<void> {
    this.period = period;
    await this.load();
  }

  async setAudience(audience: RankingAudience): Promise<void> {
    this.audience = audience;
    await this.load();
  }

  async setProvince(province: string): Promise<void> {
    this.province = province;
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.changeDetector.markForCheck();
    try {
      this.rows = await this.engagement.leaderboard(this.period, this.audience, this.province || null, 50);
    } catch (error) {
      this.error = friendlyDataError(error);
      this.rows = [];
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }
}
