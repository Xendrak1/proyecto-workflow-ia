import { Injectable, signal } from '@angular/core';

export type ToastTone = 'info' | 'success' | 'warn' | 'error';

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  readonly toasts = signal<ToastItem[]>([]);

  show(title: string, description?: string, tone: ToastTone = 'info'): void {
    const id = this.nextId++;
    this.toasts.update((items) => [...items, { id, title, description, tone }]);
    setTimeout(() => this.dismiss(id), 4200);
  }

  success(title: string, description?: string): void {
    this.show(title, description, 'success');
  }
  error(title: string, description?: string): void {
    this.show(title, description, 'error');
  }
  warn(title: string, description?: string): void {
    this.show(title, description, 'warn');
  }
  info(title: string, description?: string): void {
    this.show(title, description, 'info');
  }

  dismiss(id: number): void {
    this.toasts.update((items) => items.filter((toast) => toast.id !== id));
  }
}
