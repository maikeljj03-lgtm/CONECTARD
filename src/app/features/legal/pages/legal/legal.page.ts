import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LEGAL_CONTACT_EMAIL, LegalDocument, PRIVACY_POLICY, TERMS_OF_USE } from '../../legal.content';

/** Muestra los Términos de uso o la Política de privacidad (RF-50), según la ruta. */
@Component({
  selector: 'app-legal',
  templateUrl: './legal.page.html',
  styleUrls: ['./legal.page.scss'],
  standalone: false,
})
export class LegalPage {
  private readonly route = inject(ActivatedRoute);

  readonly document: LegalDocument =
    this.route.snapshot.data['document'] === 'terminos' ? TERMS_OF_USE : PRIVACY_POLICY;
  readonly otherDocument: LegalDocument = this.document.kind === 'terminos' ? PRIVACY_POLICY : TERMS_OF_USE;
  readonly contactEmail = LEGAL_CONTACT_EMAIL;
  readonly otherPath = this.document.kind === 'terminos' ? '/privacidad' : '/terminos';

  scrollTo(event: Event, id: string): void {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
