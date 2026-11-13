import { Injectable } from '@angular/core';
import { DR_PROVINCES } from '../constants/geography';

export interface AdministrativeAddress {
  province: string;
  municipality: string;
  sector: string;
}

interface NominatimAddress {
  state?: string;
  province?: string;
  region?: string;
  county?: string;
  municipality?: string;
  city?: string;
  town?: string;
  village?: string;
  city_district?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  residential?: string;
  hamlet?: string;
}

interface NominatimResponse {
  address?: NominatimAddress;
}

/** Obtiene la dirección administrativa aproximada de un punto usando Nominatim/OSM. */
@Injectable({ providedIn: 'root' })
export class ReverseGeocodingService {
  private readonly cache = new Map<string, AdministrativeAddress | null>();
  private lastRequestAt = 0;
  private requestQueue: Promise<void> = Promise.resolve();

  reverse(latitude: number, longitude: number): Promise<AdministrativeAddress | null> {
    const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key) ?? null);

    const request = this.requestQueue.then(async () => {
      if (this.cache.has(key)) return this.cache.get(key) ?? null;
      const delay = Math.max(0, 1100 - (Date.now() - this.lastRequestAt));
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      this.lastRequestAt = Date.now();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const params = new URLSearchParams({
          format: 'jsonv2',
          addressdetails: '1',
          zoom: '18',
          'accept-language': 'es',
          lat: String(latitude),
          lon: String(longitude),
        });
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return null;
        const data = await response.json() as NominatimResponse;
        const result = this.toAdministrativeAddress(data.address ?? {});
        this.cache.set(key, result);
        return result;
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    });

    this.requestQueue = request.then(() => undefined, () => undefined);
    return request;
  }

  private toAdministrativeAddress(address: NominatimAddress): AdministrativeAddress | null {
    const provinceCandidate = this.clean(address.state ?? address.province ?? address.region);
    const county = this.clean(address.county);
    const countyProvince = this.matchProvince(county);
    const province = this.matchProvince(provinceCandidate) || countyProvince || provinceCandidate;
    let municipality = this.clean(address.municipality ?? address.city ?? address.town ?? address.village);

    // En algunos sectores OSM entrega la provincia como county; evita guardarla también como municipio.
    const countyIsProvince = county && (countyProvince || this.normalize(county) === this.normalize(province));
    if (!municipality && county && !countyIsProvince) municipality = county;
    const sector = this.clean(address.suburb ?? address.neighbourhood ?? address.quarter ?? address.residential ?? address.hamlet ?? address.city_district);

    if (!province && !municipality && !sector) return null;
    return { province, municipality, sector };
  }

  private clean(value: string | undefined): string {
    return (value ?? '').replace(/^Provincia(?:\s+de)?\s+/i, '').trim();
  }

  private normalize(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  private matchProvince(value: string): string {
    const normalized = this.normalize(value)
      .replace(/^provincia(?:\s+de)?\s+/, '')
      .replace(/\s+province$/, '');
    return DR_PROVINCES.find((province) => this.normalize(province) === normalized) ?? '';
  }
}
