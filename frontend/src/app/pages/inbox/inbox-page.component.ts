import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { Task } from '../../core/api.models';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

type FilterMode = 'mine' | 'department' | 'all';

@Component({
  selector: 'app-inbox-page',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './inbox-page.component.html',
  styleUrl: './inbox-page.component.scss'
})
export class InboxPageComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  readonly session = inject(SessionService);

  readonly tasks = signal<Task[]>([]);
  readonly loading = signal(true);
  readonly filter = signal<FilterMode>(this.session.isFuncionario() ? 'department' : 'all');
  readonly autoRefresh = signal(true);
  readonly lastRefreshed = signal<Date | null>(null);

  private pollHandle: ReturnType<typeof setInterval> | null = null;

  readonly filtered = computed(() => {
    const mode = this.filter();
    const all = this.tasks();
    const department = this.session.department();
    const userId = this.session.userId();

    if (mode === 'all') return all;
    if (mode === 'mine') return all.filter((task) => task.assigned_user_id && task.assigned_user_id === userId);
    if (mode === 'department' && department) {
      return all.filter((task) => (task.assigned_department ?? '').toLowerCase() === department.toLowerCase());
    }
    return all;
  });

  readonly columns = computed(() => {
    const list = this.filtered();
    return {
      pendiente: list.filter((task) => task.status === 'pendiente'),
      en_proceso: list.filter((task) => task.status === 'en_proceso'),
      observada: list.filter((task) => task.status === 'observada'),
      completada: list.filter((task) => task.status === 'completada')
    };
  });

  readonly stats = computed(() => {
    const cols = this.columns();
    return {
      pendientes: cols.pendiente.length,
      enProceso: cols.en_proceso.length,
      observadas: cols.observada.length,
      completadas: cols.completada.length,
      total: this.filtered().length
    };
  });

  constructor() {
    this.refresh();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  refresh(): void {
    this.loading.set(true);
    this.api.listTasks().subscribe({
      next: (response) => {
        this.tasks.set(response.data ?? []);
        this.lastRefreshed.set(new Date());
      },
      error: () => this.toast.error('No se pudo cargar la bandeja'),
      complete: () => this.loading.set(false)
    });
  }

  setFilter(mode: FilterMode): void {
    this.filter.set(mode);
  }

  toggleAutoRefresh(): void {
    this.autoRefresh.update((value) => !value);
    if (this.autoRefresh()) this.startPolling();
    else this.stopPolling();
  }

  openTask(task: Task): void {
    if (!task._id) return;
    this.router.navigate(['/app/inbox', task._id]);
  }

  completeTaskQuick(event: Event, task: Task): void {
    event.stopPropagation();
    if (!task._id) return;
    this.api.completeTask(task._id).subscribe({
      next: () => {
        this.toast.success('Tarea completada', `${task.title} se enrutó al siguiente paso`);
        this.refresh();
      },
      error: () => this.toast.error('No se pudo completar la tarea')
    });
  }

  formatRelative(input: string | null | undefined): string {
    if (!input) return 'Sin actividad';
    const date = new Date(input);
    const diff = Date.now() - date.getTime();
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'hace instantes';
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.round(hours / 24);
    return `hace ${days} d`;
  }

  formatRefreshTime(): string {
    const ts = this.lastRefreshed();
    if (!ts) return '';
    return ts.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  private startPolling(): void {
    this.stopPolling();
    if (!this.autoRefresh()) return;
    this.pollHandle = setInterval(() => {
      this.api.listTasks().subscribe({
        next: (response) => {
          this.tasks.set(response.data ?? []);
          this.lastRefreshed.set(new Date());
        }
      });
    }, 12000);
  }

  private stopPolling(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }
}
