import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

const PATHS: Record<string, string> = {
  inbox:
    'M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z',
  workflow:
    'M5 7h6v6H5z M13 17h6v-6h-6zM11 7l4 4M9 13l4 4',
  flow:
    'M4 4h6v6H4zM14 14h6v6h-6zM10 7h4M14 17h-4M10 10v4',
  list:
    'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  chart:
    'M3 3v18h18 M7 14l4-4 3 3 5-7',
  zap:
    'M13 2 3 14h7l-1 8 10-12h-7l1-8z',
  search:
    'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3',
  plus:
    'M12 5v14 M5 12h14',
  check:
    'M20 6 9 17l-5-5',
  x:
    'M18 6 6 18M6 6l12 12',
  clock:
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 6v6l4 2',
  alert:
    'M12 9v4 M12 17h.01 M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z',
  target:
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  trending:
    'M22 7 13.5 15.5 8.5 10.5 2 17 M16 7h6v6',
  logout:
    'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  arrowLeft: 'M19 12H5 M12 19l-7-7 7-7',
  arrowRight: 'M5 12h14 M12 5l7 7-7 7',
  arrowUpRight: 'M7 17 17 7 M7 7h10v10',
  edit: 'M12 20h9 M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
  trash:
    'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6',
  play: 'M5 3l14 9-14 9V3z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  shield:
    'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  sparkles:
    'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M5.6 5.6l2.8 2.8 M15.6 15.6l2.8 2.8 M5.6 18.4l2.8-2.8 M15.6 8.4l2.8-2.8',
  mic:
    'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v4 M8 23h8',
  layers:
    'M12 2 2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  stop: 'M5 5h14v14H5z',
  zoomIn: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3 M11 8v6 M8 11h6',
  zoomOut: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3 M8 11h6',
  refresh:
    'M3 12a9 9 0 0 1 15-6.7L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15 6.7L3 16 M3 21v-5h5',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7z',
  doc:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8'
};

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      [attr.width]="size"
      [attr.height]="size"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      [attr.aria-hidden]="true"
    >
      <ng-container *ngFor="let segment of segments">
        <path [attr.d]="segment"></path>
      </ng-container>
    </svg>
  `,
  styles: [':host { display: inline-flex; line-height: 0; }']
})
export class IconComponent {
  @Input() name = 'inbox';
  @Input() size = 18;

  get segments(): string[] {
    const data = PATHS[this.name] ?? PATHS['inbox'];
    return data
      .split(/(?=M\s*-?\d)/)
      .map((segment) => segment.trim())
      .filter(Boolean);
  }
}
