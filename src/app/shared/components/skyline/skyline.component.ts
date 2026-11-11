import { ChangeDetectionStrategy, Component } from '@angular/core';

interface Building { x: number; w: number; h: number; }

// Silueta de ciudad con palmeras, inspirada en los bocetos del equipo.
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
  templateUrl: './skyline.component.html',
  styleUrls: ['./skyline.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'app-skyline', 'aria-hidden': 'true' },
})
export class SkylineComponent {
  readonly buildings = BUILDINGS;
  readonly palms = PALMS;
}
