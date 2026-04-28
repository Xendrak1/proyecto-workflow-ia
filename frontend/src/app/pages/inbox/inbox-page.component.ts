import { CommonModule } from '@angular/common';
import { Component, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { Task } from '../../core/api.models';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

type FilterMode = 'mine' | 'department' | 'all';
type StatusFilter = 'all' | 'pendiente' | 'en_proceso' | 'observada' | 'completada';
type TourTarget = 'head-actions' | 'meters' | 'pending-column' | 'completed-column' | 'pending-card-actions';

interface InboxTourStep {
  target: TourTarget;
  title: string;
  body: string;
}

interface TourBubblePosition {
  top: number;
  left: number;
}

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
  private readonly zone = inject(NgZone);
  readonly session = inject(SessionService);

  readonly tasks = signal<Task[]>([]);
  readonly loading = signal(true);
  readonly filter = signal<FilterMode>(this.session.isFuncionario() ? 'department' : 'all');
  readonly statusFilter = signal<StatusFilter>('all');
  readonly autoRefresh = signal(true);
  readonly lastRefreshed = signal<Date | null>(null);
  readonly tourOpen = signal(false);
  readonly tourIndex = signal(0);
  readonly tourTarget = signal<TourTarget>('head-actions');
  readonly tourBubble = signal<TourBubblePosition>({ top: 120, left: 120 });

  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private resizeHandler: (() => void) | null = null;
  private readonly tourSteps: InboxTourStep[] = [
    {
      target: 'head-actions',
      title: 'Filtros y refresco',
      body: 'Aquí cambias entre tareas de tu área, tuyas o todas, pausas el auto-refresh y actualizas manualmente la bandeja.'
    },
    {
      target: 'meters',
      title: 'Resumen operativo',
      body: 'Estos bloques te dicen cuántas tareas tienes en cada estado. Puedes usar sus botones para saltar directo al primer caso pendiente de esa categoría.'
    },
    {
      target: 'pending-column',
      title: 'Columna de pendientes',
      body: 'Aquí aterrizan las tareas urgentes. Esta es la columna que más vas a vigilar durante la operación diaria.'
    },
    {
      target: 'pending-card-actions',
      title: 'Acciones rápidas',
      body: 'Dentro de cada tarjeta puedes entrar a atenderla o completarla al instante si ya tienes toda la información necesaria.'
    },
    {
      target: 'completed-column',
      title: 'Historial cerrado',
      body: 'Las completadas te dejan revisar trazabilidad, confirmar cierres y mostrar evidencia de que el flujo sí está operando.'
    }
  ];

  readonly filtered = computed(() => {
    const mode = this.filter();
    const all = this.tasks();
    const department = this.session.department();
    const userId = this.session.userId();

    let filtered = all;
    if (mode === 'mine') {
      filtered = all.filter((task) => task.assigned_user_id && task.assigned_user_id === userId);
    } else if (mode === 'department' && department) {
      filtered = all.filter((task) => (task.assigned_department ?? '').toLowerCase() === department.toLowerCase());
    }

    const status = this.statusFilter();
    if (status === 'all') return filtered;
    return filtered.filter((task) => task.status === status);
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
    this.bindTourListeners();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.unbindTourListeners();
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

  setStatusFilter(status: StatusFilter): void {
    this.statusFilter.set(status);
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

  openFirstInStatus(status: Exclude<StatusFilter, 'all'>): void {
    this.statusFilter.set(status);
    const task = this.columns()[status][0];
    if (task) {
      this.openTask(task);
    }
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

  currentTourStep(): InboxTourStep {
    return this.tourSteps[this.tourIndex()] ?? this.tourSteps[0];
  }

  isTourFocus(target: TourTarget): boolean {
    return this.tourOpen() && this.currentTourStep().target === target;
  }

  nextTourStep(): void {
    if (this.tourIndex() >= this.tourSteps.length - 1) {
      this.closeTour();
      return;
    }
    this.tourIndex.update((value) => value + 1);
    this.syncTourPosition();
  }

  previousTourStep(): void {
    if (this.tourIndex() <= 0) return;
    this.tourIndex.update((value) => value - 1);
    this.syncTourPosition();
  }

  closeTour(): void {
    this.tourOpen.set(false);
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

  private bindTourListeners(): void {
    if (typeof window === 'undefined') return;
    const handler = () => {
      this.zone.run(() => this.syncTourPosition());
    };
    this.resizeHandler = handler;
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    window.addEventListener('workflow-ia:start-tour', this.handleTourRequest as EventListener);
  }

  private unbindTourListeners(): void {
    if (typeof window === 'undefined') return;
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      window.removeEventListener('scroll', this.resizeHandler, true);
    }
    window.removeEventListener('workflow-ia:start-tour', this.handleTourRequest as EventListener);
  }

  private readonly handleTourRequest = (event: CustomEvent<{ route?: string; force?: boolean }>) => {
    if (event.detail?.route !== 'inbox') return;
    this.startTour();
  };

  private startTour(): void {
    this.tourIndex.set(0);
    this.tourOpen.set(true);
    setTimeout(() => this.syncTourPosition(), 0);
  }

  private syncTourPosition(): void {
    if (!this.tourOpen() || typeof document === 'undefined' || typeof window === 'undefined') return;
    const target = this.currentTourStep().target;
    this.tourTarget.set(target);
    const element = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const bubbleWidth = 360;
    const spacing = 18;
    let left = rect.left;
    let top = rect.bottom + spacing;

    if (left + bubbleWidth > window.innerWidth - 24) {
      left = Math.max(16, window.innerWidth - bubbleWidth - 24);
    }
    if (top + 240 > window.innerHeight - 16) {
      top = Math.max(16, rect.top - 240 - spacing);
    }

    this.tourBubble.set({
      left,
      top
    });
  }
}
