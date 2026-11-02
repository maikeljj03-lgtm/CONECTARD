import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import type { User } from '@supabase/supabase-js';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit {
  user: User | null = null;
  loading = true;

  constructor(private readonly auth: AuthService, private readonly router: Router) {}

  async ngOnInit(): Promise<void> {
    try {
      this.user = await this.auth.getCurrentUser();
    } catch {
      this.user = null;
    }
    this.loading = false;
    if (!this.user) await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  get displayName(): string {
    return this.user?.user_metadata?.['full_name'] || this.user?.email || 'Tu cuenta';
  }
}
