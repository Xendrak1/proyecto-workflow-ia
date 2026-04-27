import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { BottleneckData, Policy, Summary, Task, Tramite } from '../../core/api.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

interface DepartmentLoad {
  department: string;
  total: number;
  pendientes: number;
  enProceso: number;
  completadas: number;
}

@Component({
  selector: 'app-analytics-page',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './analytics-page.component.html',
  styleUrl: './analytics-page.component.scss'
})
export class AnalyticsPageComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly summary = signal<Summary | null>(null);
  readonly bottleneckData = signal<BottleneckData | null>(null);
  readonly policies = signal<Policy[]>([]);
  readonly tasks = signal<Task[]>([]);
  readonly tramites = signal<Tramite[]>([]);
  readonly loading = signal(true);
  readonly exporting = signal<'csv' | 'json' | null>(null);

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
}
