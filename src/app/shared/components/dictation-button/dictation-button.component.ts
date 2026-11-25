import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, NgZone, OnDestroy, inject } from '@angular/core';
import type { AbstractControl } from '@angular/forms';
import { currentLanguage, t } from '../../../core/i18n/i18n';

/** Mínimo de la Web Speech API que usamos (no viene en los tipos de TypeScript). */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const LOCALES = { es: 'es-DO', en: 'en-US', ht: 'fr-HT' } as const;

/** Une el texto dictado al que ya había, con un espacio y la primera letra en mayúscula si empieza oración. */
export function appendDictation(current: string, spoken: string, maxLength: number): string {
  const piece = spoken.trim();
  if (!piece) return current;
  const base = current.replace(/\s+$/, '');
  const startsSentence = !base || /[.!?¿¡]$/.test(base);
  const text = startsSentence ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece;
  return `${base}${base ? ' ' : ''}${text}`.slice(0, maxLength);
}

/**
 * Botón de dictado por voz (RF-55): escribe en el campo lo que la persona dice.
 * Usa el reconocimiento de voz del navegador; si no existe (Firefox, algunos iPhone), no se muestra.
 */
@Component({
  selector: 'app-dictation-button',
  template: `
    @if (supported) {
      <button type="button" class="dictation" [class.is-listening]="listening" (click)="toggle()" [disabled]="disabled"
        [attr.aria-pressed]="listening" [attr.aria-label]="listening ? stopLabel : startLabel">
        <app-icon [name]="listening ? 'x' : 'mic'"></app-icon><span>{{ listening ? stopLabel : startLabel }}</span>
      </button>
      @if (message) { <small class="dictation__note" role="status">{{ message }}</small> }
    }
  `,
  styleUrls: ['./dictation-button.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DictationButtonComponent implements OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private recognition: SpeechRecognitionLike | null = null;

  @Input({ required: true }) control!: AbstractControl<string>;
  @Input() maxLength = 2000;
  @Input() disabled = false;

  readonly supported = !!this.constructorRef();
  readonly startLabel = t('voice.start');
  readonly stopLabel = t('voice.stop');
  listening = false;
  message = '';

  toggle(): void {
    if (this.listening) this.stop();
    else this.start();
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private start(): void {
    const Recognition = this.constructorRef();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = LOCALES[currentLanguage()];
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => this.zone.run(() => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const before = this.control.value ?? '';
        const next = appendDictation(before, result[0].transcript, this.maxLength);
        this.control.setValue(next);
        this.control.markAsDirty();
        if (next.length >= this.maxLength) {
          this.message = t('voice.full');
          this.stop();
        }
      }
      this.changeDetector.markForCheck();
    });
    recognition.onerror = (event) => this.zone.run(() => {
      this.message = event.error === 'not-allowed' || event.error === 'service-not-allowed' ? t('voice.denied') : event.error === 'no-speech' ? '' : t('voice.error');
      this.listening = false;
      this.changeDetector.markForCheck();
    });
    recognition.onend = () => this.zone.run(() => {
      this.listening = false;
      if (this.message === t('voice.listening')) this.message = '';
      this.changeDetector.markForCheck();
    });
    try {
      recognition.start();
      this.recognition = recognition;
      this.listening = true;
      this.message = t('voice.listening');
    } catch {
      this.message = t('voice.error');
    }
    this.changeDetector.markForCheck();
  }

  private stop(): void {
    this.recognition?.stop();
    this.recognition = null;
    this.listening = false;
    this.changeDetector.markForCheck();
  }

  private constructorRef(): SpeechRecognitionConstructor | null {
    if (typeof window === 'undefined') return null;
    const scope = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
  }
}
