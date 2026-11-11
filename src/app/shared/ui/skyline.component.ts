import { ChangeDetectionStrategy, Component } from '@angular/core';

interface Building { x: number; w: number; h: number; }

// Silueta de ciudad con palmeras, inspirada en los bocetos del equipo.
// Usa currentColor: el color lo define quien la coloca.
const BUILDINGS: Building[] = [
  { x: 0, w: 70, h: 46 }, { x: 64, w: 48, h: 78 }, { x: 108, w: 60, h: 58 }, { x: 196, w: 44, h: 104 },
  { x: 236, w: 70, h: 64 }, { x: 300, w: 38, h: 88 }, { x: 384, w: 64, h: 52 }, { x: 444, w: 52, h: 120 },
  { x: 492, w: 66, h: 72 }, { x: 552, w: 40, h: 94 }, { x: 640, w: 72, h: 60 }, { x: 708, w: 46, h: 132 },
  { x: 750, w: 64, h: 84 }, { x: 812, w: 50, h: 56 }, { x: 900, w: 58, h: 98 }, { x: 954, w: 72, h: 66 },
  { x: 1022, w: 42, h: 116 }, { x: 1110, w: 66, h: 70 }, { x: 1172, w: 50, h: 92 }, { x: 1218, w: 64, h: 54 },
  { x: 1300, w: 46, h: 108 }, { x: 1342, w: 98, h: 62 },
];

const PALMS = [168, 352, 604, 862, 1076, 1270];

@Component({
  selector: 'app-skyline',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'app-skyline', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 1440 170" preserveAspectRatio="xMidYMax slice" focusable="false">
      <g class="skyline__city">
        @for (b of buildings; track b.x) {
          <rect [attr.x]="b.x" [attr.y]="170 - b.h" [attr.width]="b.w" [attr.height]="b.h" rx="3" />
        }
      </g>
      <g class="skyline__palms" fill="none" stroke-linecap="round" stroke-linejoin="round">
        @for (x of palms; track x) {
          <g [attr.transform]="'translate(' + x + ' 0)'">
            <path d="M0 170 C4 140 6 112 -2 84" stroke-width="5" />
            <g class="skyline__fronds">
              <path d="M-2 84 C-14 72 -32 70 -46 80 C-34 74 -18 76 -2 86 Z" />
              <path d="M-2 84 C-12 66 -26 58 -40 58 C-28 64 -16 72 -2 86 Z" />
              <path d="M-2 84 C-4 68 -12 56 -22 50 C-14 60 -8 70 -2 86 Z" />
              <path d="M-2 84 C4 66 14 58 26 54 C16 62 8 72 -2 86 Z" />
              <path d="M-2 84 C12 70 30 66 44 72 C30 72 14 76 -2 86 Z" />
              <path d="M-2 84 C14 78 30 82 40 94 C28 86 12 84 -2 86 Z" />
            </g>
          </g>
        }
      </g>
    </svg>
  `,
})
export class SkylineComponent {
  readonly buildings = BUILDINGS;
  readonly palms = PALMS;
}
