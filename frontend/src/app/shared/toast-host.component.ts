import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';

import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-host" *ngIf="toast.toasts().length">
      <div class="toast" *ngFor="let item of toast.toasts()" [ngClass]="item.tone">
        <strong>{{ item.title }}</strong>
        <span *ngIf="item.description">{{ item.description }}</span>
      </div>
    </div>
  `
})
export class ToastHostComponent {
  readonly toast = inject(ToastService);
}
