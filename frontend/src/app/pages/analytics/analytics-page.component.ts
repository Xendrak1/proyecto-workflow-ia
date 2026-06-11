import { CommonModule } from '@angular/common';
import { Component, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { BottleneckData, IntelligentReport, Policy, RoutingIntelligence, Summary, Task, Tramite } from '../../core/api.models';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

interface DepartmentLoad {
  department: string;
  total: number;
  pendientes: number;
  enProceso: number;
  completadas: number;
}

type TourTarget = 'analytics-actions' | 'analytics-kpi' | 'analytics-load' | 'analytics-bottlenecks';

interface PageTourStep {
  target: TourTarget;
  title: string;
  body: string;
}

interface TourBubblePosition {
  top: number;
  left: number;
}

@Component({
  selector: 'app-analytics-page',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './analytics-page.component.html',
  styleUrl: './analytics-page.component.scss'
})
export class AnalyticsPageComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly zone = inject(NgZone);
  private readonly session = inject(SessionService);

  readonly summary = signal<Summary | null>(null);
  readonly bottleneckData = signal<BottleneckData | null>(null);
  readonly routingIntelligence = signal<RoutingIntelligence | null>(null);
  readonly intelligentReport = signal<IntelligentReport | null>(null);
  readonly policies = signal<Policy[]>([]);
  readonly tasks = signal<Task[]>([]);
  readonly tramites = signal<Tramite[]>([]);
  readonly loading = signal(true);
  readonly exporting = signal<'csv' | 'json' | null>(null);
  readonly generatingReport = signal(false);
  readonly tourOpen = signal(false);
  readonly tourIndex = signal(0);
  readonly tourBubble = signal<TourBubblePosition>({ top: 120, left: 120 });

  private resizeHandler: (() => void) | null = null;
  reportPrompt = 'Necesito un reporte de riesgos de demora, prioridades y anomalías por trámite para esta semana.';
  private readonly tourSteps: PageTourStep[] = [
    {
      target: 'analytics-actions',
      title: 'Actualizar y exportar',
      body: 'Desde aquí refrescas el tablero y exportas el reporte en JSON o CSV para compartir evidencia del sistema.'
    },
    {
      target: 'analytics-kpi',
      title: 'Indicadores clave',
      body: 'Estos KPI muestran el pulso general: trámites, tareas, pendientes y tasa de cierre.'
    },
    {
      target: 'analytics-load',
      title: 'Carga operativa',
      body: 'Aquí ves qué departamentos o tipos de trámite concentran más trabajo para detectar saturación.'
    },
    {
      target: 'analytics-bottlenecks',
      title: 'Cuellos de botella e IA',
      body: 'Este bloque resume nodos críticos y la lectura de IA para que puedas justificar decisiones de mejora.'
    }
  ];

  readonly completionRate = computed(() => {
    const data = this.summary();
    if (!data || !data.total_tasks) return 0;
    return Math.round((data.completed_tasks / data.total_tasks) * 100);
  });

  readonly departmentLoad = computed<DepartmentLoad[]>(() => {
    const map = new Map<string, DepartmentLoad>();
    for (const task of this.tasks()) {
      const department = task.assigned_department ?? 'Sin asignar';
      const item =
        map.get(department) ?? {
          department,
          total: 0,
          pendientes: 0,
          enProceso: 0,
          completadas: 0
        };
      item.total += 1;
      if (task.status === 'pendiente') item.pendientes += 1;
      else if (task.status === 'en_proceso') item.enProceso += 1;
      else if (task.status === 'completada') item.completadas += 1;
      map.set(department, item);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  });

  readonly maxDepartmentLoad = computed(() => {
    const items = this.departmentLoad();
    if (!items.length) return 1;
    return Math.max(...items.map((item) => item.total));
  });

  readonly proceduresMix = computed(() => {
    const map = new Map<string, number>();
    for (const tramite of this.tramites()) {
      map.set(tramite.procedure_type, (map.get(tramite.procedure_type) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([procedure, count]) => ({ procedure, count }))
      .sort((a, b) => b.count - a.count);
  });

  readonly maxProcedure = computed(() => {
    const items = this.proceduresMix();
    if (!items.length) return 1;
    return items[0].count;
  });

  readonly criticalNodesEnriched = computed(() => {
    const data = this.bottleneckData();
    if (!data) return [];
    const nodeMeta = new Map<string, { name: string; lane: string; policy: string }>();
    for (const policy of this.policies()) {
      for (const node of policy.nodes ?? []) {
        nodeMeta.set(node.code, {
          name: node.name,
          lane: node.lane,
          policy: policy.name
        });
      }
    }
    return data.critical_nodes.map((node) => ({
      ...node,
      meta: nodeMeta.get(node._id) ?? null
    }));
  });

  constructor() {
    void this.refresh();
    this.bindTourListeners();
  }

  ngOnDestroy(): void {
    this.unbindTourListeners();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const [summary, bottlenecks, policies, tasks, tramites] = await Promise.allSettled([
        firstValueFrom(this.api.getSummary()),
        firstValueFrom(this.api.getBottlenecks()),
        firstValueFrom(this.api.listPolicies()),
        firstValueFrom(this.api.listTasks()),
        firstValueFrom(this.api.listTramites())
      ]);

      let hadError = false;

      if (summary.status === 'fulfilled') this.summary.set(summary.value.data);
      else hadError = true;

      if (bottlenecks.status === 'fulfilled') this.bottleneckData.set(bottlenecks.value.data);
      else hadError = true;

      if (policies.status === 'fulfilled') this.policies.set(policies.value.data ?? []);
      else hadError = true;

      if (tasks.status === 'fulfilled') this.tasks.set(tasks.value.data ?? []);
      else hadError = true;

      if (tramites.status === 'fulfilled') this.tramites.set(tramites.value.data ?? []);
      else hadError = true;

      const intelligence = await firstValueFrom(this.api.getRoutingIntelligence()).catch(() => null);
      if (intelligence) this.routingIntelligence.set(intelligence.data);
      else hadError = true;

      if (hadError) {
        this.toast.warn('Algunas analíticas tardaron o fallaron', 'Se mostraron los datos que sí pudieron recuperarse.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  async exportReport(format: 'csv' | 'json'): Promise<void> {
    this.exporting.set(format);
    try {
      const blob = await firstValueFrom(this.api.exportAnalyticsReport(format));
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = format === 'csv' ? 'workflow-report.csv' : 'workflow-report.json';
      link.click();
      window.URL.revokeObjectURL(url);
      this.toast.success('Reporte exportado', `Se descargó el reporte en formato ${format.toUpperCase()}.`);
    } catch {
      this.toast.error('No se pudo exportar el reporte');
    } finally {
      this.exporting.set(null);
    }
  }

  async generateSmartReport(): Promise<void> {
    const prompt = this.reportPrompt.trim();
    if (!prompt) {
      this.toast.warn('Escribe qué reporte necesitas');
      return;
    }
    this.generatingReport.set(true);
    try {
      const response = await firstValueFrom(
        this.api.generateIntelligentReport({
          prompt,
          actor_name: this.session.fullName() || this.session.email()
        })
      );
      this.intelligentReport.set(response.data);
      this.routingIntelligence.set(response.data.snapshot);
      this.toast.success('Reporte inteligente generado');
    } catch {
      this.toast.error('No se pudo generar el reporte inteligente');
    } finally {
      this.generatingReport.set(false);
    }
  }

  currentTourStep(): PageTourStep {
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

  private bindTourListeners(): void {
    if (typeof window === 'undefined') return;
    const handler = () => this.zone.run(() => this.syncTourPosition());
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

  private readonly handleTourRequest = (event: CustomEvent<{ route?: string }>) => {
    if (event.detail?.route !== 'analytics') return;
    this.startTour();
  };

  private startTour(): void {
    this.tourIndex.set(0);
    this.tourOpen.set(true);
    setTimeout(() => this.syncTourPosition(), 0);
  }

  private syncTourPosition(): void {
    if (!this.tourOpen() || typeof document === 'undefined' || typeof window === 'undefined') return;
    const element = document.querySelector<HTMLElement>(`[data-tour="${this.currentTourStep().target}"]`);
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
    this.tourBubble.set({ top, left });
  }
}
