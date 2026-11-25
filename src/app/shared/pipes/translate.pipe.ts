import { Pipe, PipeTransform } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import type { MessageKey } from '../../core/i18n/messages';

/** {{ 'nav.home' | t }} o {{ 'alerts.max' | t: { n: 5 } }} (RF-56). El idioma se fija al cargar la app. */
@Pipe({ name: 't', standalone: false })
export class TranslatePipe implements PipeTransform {
  transform(key: MessageKey, params?: Record<string, string | number>): string {
    return t(key, params);
  }
}
