import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import * as L from 'leaflet';
import { REPORT_CATEGORIES, REPORT_STATUS_LABELS, type ReportCategoryValue } from '../../../../core/constants/catalogs';
import { DR_MAP_VIEW, DR_PROVINCES, isInsideDominicanRepublic } from '../../../../core/constants/geography';
import type { MyReport, PublicReport } from '../../../../core/models/report.model';
import { ProfileService } from '../../../../core/services/profile.service';
import { ReportMediaService } from '../../../../core/services/report-media.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { ReverseGeocodingService } from '../../../../core/services/reverse-geocoding.service';
import type { ProcessedMedia } from '../../../../core/utils/media';
import { MediaPickerComponent } from '../../../../shared/components/media-picker/media-picker.component';
import { friendlyDataError } from '../../../../core/utils/data-errors';

@Component({
  selector: 'app-new-report',
  templateUrl: './new-report.page.html',
  standalone: false,
})
export class NewReportPage implements OnInit, AfterViewInit, OnDestroy {
  private readonly formBuilder = inject(FormBuilder);
  private readonly reports = inject(ReportsService);
  private readonly reverseGeocoding = inject(ReverseGeocodingService);
  private readonly mediaService = inject(ReportMediaService);
  private readonly profiles = inject(ProfileService);
  private readonly zone = inject(NgZone);
  private readonly changeDetector = inject(ChangeDetectorRef);

  @ViewChild('pickerMap') private pickerMap?: ElementRef<HTMLDivElement>;
  @ViewChild(MediaPickerComponent) private mediaPicker?: MediaPickerComponent;

  /** Fotos y videos listos para subir (RF-10, RF-11, ya comprimidos según RF-12). */
  media: ProcessedMedia[] = [];
  mediaProcessing = false;
  /** Archivos que no se pudieron subir tras crear el reporte (se pueden reintentar). */
  failedMedia: ProcessedMedia[] = [];
  uploadedMediaUrls: { url: string; kind: 'image' | 'video' }[] = [];
  uploadingMedia = false;
  mediaError = '';
  private map?: L.Map;
  private marker?: L.Marker;
  private resizeObserver?: ResizeObserver;
  private addressLookupVersion = 0;

  readonly categories = REPORT_CATEGORIES;
  readonly provinces = DR_PROVINCES;
  readonly statusLabels = REPORT_STATUS_LABELS;

  authorName = '';
  sending = false;
  locating = false;
  message = '';
  locationHint = '';
  created: MyReport | null = null;
  publicView: PublicReport | null = null;

  readonly form = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(120)]],
    category: ['' as ReportCategoryValue | '', Validators.required],
    description: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(2000)]],
    latitude: [null as number | null, Validators.required],
    longitude: [null as number | null, Validators.required],
    address: ['', Validators.maxLength(200)],
    province: [''],
    municipality: ['', Validators.maxLength(80)],
    sector: ['', Validators.maxLength(80)],
    is_anonymous: [false],
  });

  async ngOnInit(): Promise<void> {
    try {
      const profile = await this.profiles.getMyProfile();
      this.authorName = profile.full_name || 'Tu nombre';
      // Rellena la zona con la del perfil para ahorrar pasos.
      this.form.patchValue({ province: profile.province ?? '', municipality: profile.municipality ?? '', sector: profile.sector ?? '' });
    } catch {
      this.authorName = 'Tu nombre';
    }
    this.changeDetector.markForCheck();
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.map?.remove();
  }

  get descriptionLength(): number {
    return this.form.controls.description.value.length;
  }

  get hasLocation(): boolean {
    return this.form.controls.latitude.value !== null;
  }

  selectCategory(value: ReportCategoryValue): void {
    this.form.controls.category.setValue(value);
    this.form.controls.category.markAsTouched();
  }

  useMyLocation(): void {
    if (!navigator.geolocation) {
      this.locationHint = 'Tu navegador no permite obtener la ubicación. Marca el lugar en el mapa.';
      return;
    }
    this.locating = true;
    this.locationHint = '';
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => this.zone.run(() => {
        this.locating = false;
        if (!isInsideDominicanRepublic(coords.latitude, coords.longitude)) {
          this.locationHint = 'Tu ubicación está fuera de República Dominicana. Marca el lugar en el mapa.';
          return;
        }
        this.setLocation(coords.latitude, coords.longitude, 16, `Ubicación obtenida con una precisión aproximada de ${Math.round(coords.accuracy)} m.`);
      }),
      () => this.zone.run(() => {
        this.locating = false;
        this.locationHint = 'No se pudo obtener tu ubicación. Revisa el permiso del navegador o marca el lugar en el mapa.';
      }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.message = !this.hasLocation ? 'Marca en el mapa dónde está el problema.' : 'Revisa los campos marcados.';
      return;
    }
    if (this.mediaProcessing) {
      this.message = 'Espera a que terminen de procesarse las fotos.';
      return;
    }
    this.sending = true;
    this.message = '';
    try {
      const value = this.form.getRawValue();
      this.created = await this.reports.create({
        title: value.title,
        description: value.description,
        category: value.category as ReportCategoryValue,
        latitude: value.latitude!,
        longitude: value.longitude!,
        address: value.address,
        province: value.province || null,
        municipality: value.municipality,
        sector: value.sector,
        is_anonymous: value.is_anonymous,
      });
      // Las fotos se suben después de crear el reporte: se guardan en la carpeta de ese reporte.
      if (this.media.length) await this.uploadMedia(this.media, 0);
      // Se lee desde la vista pública para mostrar exactamente lo que verán los demás.
      this.publicView = await this.reports.getPublic(this.created.id).catch(() => null);
    } catch (error) {
      this.message = friendlyDataError(error);
    } finally {
      this.sending = false;
      this.changeDetector.markForCheck();
    }
  }

  /** Vuelve a intentar subir los archivos que fallaron. */
  async retryMedia(): Promise<void> {
    if (!this.created || !this.failedMedia.length) return;
    await this.uploadMedia(this.failedMedia, this.uploadedMediaUrls.length);
    this.changeDetector.markForCheck();
  }

  private async uploadMedia(items: ProcessedMedia[], startPosition: number): Promise<void> {
    if (!this.created) return;
    this.uploadingMedia = true;
    this.mediaError = '';
    this.changeDetector.markForCheck();
    try {
      const result = await this.mediaService.upload(this.created.id, items, startPosition);
      for (const media of result.uploaded) {
        this.uploadedMediaUrls.push({ url: await this.mediaService.publicUrl(media.path), kind: media.kind });
      }
      this.failedMedia = result.failed.map((index) => items[index]);
      if (this.failedMedia.length) {
        this.mediaError = `${this.failedMedia.length === 1 ? 'Un archivo no se pudo subir' : this.failedMedia.length + ' archivos no se pudieron subir'}: ${friendlyDataError(result.firstError)}`;
      }
    } catch (error) {
      this.failedMedia = items;
      this.mediaError = friendlyDataError(error);
    } finally {
      this.uploadingMedia = false;
    }
  }

  startAnother(): void {
    this.addressLookupVersion++;
    this.locationHint = '';
    this.created = null;
    this.publicView = null;
    this.failedMedia = [];
    this.uploadedMediaUrls = [];
    this.mediaError = '';
    this.mediaPicker?.clear();
    this.form.reset({ ...this.form.getRawValue(), title: '', description: '', category: '', latitude: null, longitude: null, address: '', is_anonymous: false });
    this.marker?.remove();
    this.marker = undefined;
    this.changeDetector.markForCheck();
    setTimeout(() => this.map?.invalidateSize(), 0);
  }

  categoryLabel(value: string): string {
    return this.categories.find((category) => category.value === value)?.label ?? value;
  }

  private initMap(): void {
    if (!this.pickerMap) return;
    const bounds = L.latLngBounds(DR_MAP_VIEW);
    const element = this.pickerMap.nativeElement;
    this.map = L.map(element, { zoomControl: true, minZoom: 6, maxZoom: 18, maxBounds: bounds.pad(0.1) });
    // Vista inicial provisional; se encuadra el país cuando el contenedor ya tiene tamaño real.
    this.map.setView(bounds.getCenter(), 7);
    let framed = false;
    const frame = () => {
      this.map?.invalidateSize();
      if (!framed && element.clientWidth > 0 && element.clientHeight > 0) {
        framed = true;
        this.map?.fitBounds(bounds, { padding: [10, 10] });
      }
    };
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }).addTo(this.map);
    this.map.on('click', (event: L.LeafletMouseEvent) => this.zone.run(() => {
      if (!isInsideDominicanRepublic(event.latlng.lat, event.latlng.lng)) {
        this.locationHint = 'Elige un punto dentro de República Dominicana.';
        return;
      }
      this.setLocation(event.latlng.lat, event.latlng.lng);
    }));
    this.resizeObserver = new ResizeObserver(frame);
    this.resizeObserver.observe(element);
    requestAnimationFrame(frame);
  }

  private setLocation(lat: number, lng: number, zoom?: number, hintPrefix = ''): void {
    this.form.patchValue({ latitude: lat, longitude: lng });
    void this.fillAdministrativeAddress(lat, lng, hintPrefix);
    if (!this.map) return;
    const icon = L.divIcon({ className: 'pick-marker', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 28] });
    if (this.marker) {
      this.marker.setLatLng([lat, lng]);
    } else {
      this.marker = L.marker([lat, lng], { icon, draggable: true }).addTo(this.map);
      this.marker.on('dragend', () => this.zone.run(() => {
        const position = this.marker!.getLatLng();
        if (isInsideDominicanRepublic(position.lat, position.lng)) {
          this.setLocation(position.lat, position.lng);
        } else {
          this.marker!.setLatLng([
            this.form.controls.latitude.value ?? lat,
            this.form.controls.longitude.value ?? lng,
          ]);
        }
      }));
    }
    if (zoom) this.map.flyTo([lat, lng], zoom, { duration: .6 });
    this.changeDetector.markForCheck();
  }

  private async fillAdministrativeAddress(lat: number, lng: number, hintPrefix = ''): Promise<void> {
    const lookupVersion = ++this.addressLookupVersion;
    this.form.patchValue({ province: '', municipality: '', sector: '' });
    this.locationHint = [hintPrefix, 'Buscando provincia, municipio y sector…'].filter(Boolean).join(' ');
    this.changeDetector.markForCheck();

    const address = await this.reverseGeocoding.reverse(lat, lng);
    if (lookupVersion !== this.addressLookupVersion) return;
    if (!address) {
      this.locationHint = [hintPrefix, 'No pudimos identificar la zona automáticamente. Puedes completar los campos manualmente.'].filter(Boolean).join(' ');
      this.changeDetector.markForCheck();
      return;
    }

    const province = this.findProvince(address.province);
    const municipality = address.municipality;
    const sector = address.sector;
    const current = this.form.getRawValue();
    this.form.patchValue({
      province: current.province || province,
      municipality: current.municipality || municipality,
      sector: current.sector || sector,
    });

    const found = [
      this.form.controls.sector.value,
      this.form.controls.municipality.value,
      this.form.controls.province.value,
    ].filter(Boolean).join(', ');
    this.locationHint = found
      ? [hintPrefix, `Zona detectada: ${found}. Puedes ajustar los campos si hace falta.`].filter(Boolean).join(' ')
      : [hintPrefix, 'No encontramos datos administrativos para este punto. Completa los campos manualmente.'].filter(Boolean).join(' ');
    this.changeDetector.markForCheck();
  }

  private findProvince(value: string): string {
    const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const normalized = normalize(value).replace(/^provincia(?:\s+de)?\s+/, '').replace(/\s+province$/, '');
    return this.provinces.find((province) => normalize(province) === normalized) ?? '';
  }
}
