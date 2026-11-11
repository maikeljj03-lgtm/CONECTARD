import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ProfileService } from '../../../core/services/profile.service';

/** Barra superior de las páginas internas (perfil, reportes, administración). */
@Component({
  selector: 'app-topbar',
  standalone: false,
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.scss'],
  host: { class: 'app-topbar' },
})
export class TopbarComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  isAdmin = false;

  ngOnInit(): void {
    void this.profiles.getMyProfile()
      .then((profile) => {
        this.isAdmin = profile.role === 'administrator';
        this.changeDetector.markForCheck();
      })
      .catch(() => undefined);
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/landing', { replaceUrl: true });
  }
}
