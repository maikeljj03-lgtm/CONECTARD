import { Injectable, inject } from '@angular/core';
import type { Profile, ProfileUpdate } from '../models/profile.model';
import { AuthService } from './auth.service';

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly auth = inject(AuthService);

  async getMyProfile(): Promise<Profile> {
    const client = await this.auth.supabase();
    const user = await this.auth.getCurrentUser();
    if (!user) throw new Error('Inicia sesión para ver tu perfil.');
    const { data, error } = await client.from('profiles').select('*').eq('id', user.id).single();
    if (error) throw error;
    return data as Profile;
  }

  async updateMyProfile(changes: ProfileUpdate): Promise<Profile> {
    const client = await this.auth.supabase();
    const user = await this.auth.getCurrentUser();
    if (!user) throw new Error('Inicia sesión para editar tu perfil.');
    const clean = (value: string | null) => (value && value.trim() ? value.trim() : null);
    const { data, error } = await client
      .from('profiles')
      .update({
        full_name: changes.full_name.trim(),
        province: clean(changes.province),
        municipality: clean(changes.municipality),
        sector: clean(changes.sector),
        bio: clean(changes.bio),
      })
      .eq('id', user.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as Profile;
  }

  validateAvatar(file: File): string | null {
    if (!AVATAR_TYPES.includes(file.type)) return 'La foto debe ser JPG, PNG o WebP.';
    if (file.size > AVATAR_MAX_BYTES) return 'La foto no puede pesar más de 2 MB.';
    return null;
  }

  /** Sube la foto a avatars/<uid>/ y guarda su URL pública en el perfil. */
  async uploadAvatar(file: File): Promise<Profile> {
    const problem = this.validateAvatar(file);
    if (problem) throw new Error(problem);
    const client = await this.auth.supabase();
    const user = await this.auth.getCurrentUser();
    if (!user) throw new Error('Inicia sesión para cambiar tu foto.');

    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${user.id}/avatar-${Date.now()}.${extension}`;
    const { error: uploadError } = await client.storage.from('avatars').upload(path, file, {
      contentType: file.type,
      upsert: false,
      cacheControl: '3600',
    });
    if (uploadError) throw uploadError;

    const { data: publicUrl } = client.storage.from('avatars').getPublicUrl(path);
    const { data, error } = await client
      .from('profiles')
      .update({ avatar_url: publicUrl.publicUrl })
      .eq('id', user.id)
      .select('*')
      .single();
    if (error) throw error;

    // Borra fotos anteriores del usuario (no es crítico si falla).
    const { data: files } = await client.storage.from('avatars').list(user.id);
    const old = (files ?? []).map((item) => `${user.id}/${item.name}`).filter((name) => name !== path);
    if (old.length) await client.storage.from('avatars').remove(old);

    return data as Profile;
  }
}
