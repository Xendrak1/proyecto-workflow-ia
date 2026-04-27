import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Policy, Task, Tramite } from '../../core/api.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

interface TimelineStep {
  code: string;
  name: string;
  lane: string;
  task: Task | null;
  status: 'completed' | 'current' | 'pending';
}

@Component({
  selector: 'app-tramite-detail-page',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './tramite-detail-page.component.html',
  styleUrl: './tramite-detail-page.component.scss'
})
export class TramiteDetailPageComponent implements OnInit {
  @Input() tramiteCode = '';

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly tramite = signal<Tramite | null>(null);
  readonly tasks = signal<Task[]>([]);
  readonly policy = signal<Policy | null>(null);
  readonly loading = signal(true);

  readonly timeline = computed<TimelineStep[]>(() => {
    const policy = this.policy();
    const tramite = this.tramite();
    if (!policy || !tramite) return [];

    const sortedNodes = [...(policy.nodes ?? [])];
    const tasksByNode = new Map<string, Task>();
    for (const task of this.tasks()) {
      tasksByNode.set(task.node_code, task);
    }

    const currentCode = tramite.current_node_code;
    return sortedNodes.map((node) => {
      const task = tasksByNode.get(node.code) ?? null;
      let status: TimelineStep['status'] = 'pending';
      if (task?.status === 'completada') status = 'completed';
      else if (node.code === currentCode || task?.status === 'en_proceso') status = 'current';
      else if (!task && currentCode) {
        const order = sortedNodes.findIndex((n) => n.code === node.code);
        const currentOrder = sortedNodes.findIndex((n) => n.code === currentCode);
        if (currentOrder > -1 && order < currentOrder) status = 'completed';
      }
      return {
        code: node.code,
        name: node.name,
        lane: node.lane,
        task,
        status
      };
    });
  });

  readonly progress = computed(() => {
    const items = this.timeline();
    if (!items.length) return 0;
    const done = items.filter((step) => step.status === 'completed').length;
    return Math.round((done / items.length) * 100);
  });

  ngOnInit(): void {
    if (this.tramiteCode) void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const tramiteResponse = await firstValueFrom(this.api.getTramite(this.tramiteCode));
      this.tramite.set(tramiteResponse.data);
      const [tasks, policies] = await Promise.all([
        firstValueFrom(this.api.getTramiteTasks(this.tramiteCode)),
        firstValueFrom(this.api.listPolicies())
      ]);
      this.tasks.set(tasks.data ?? []);
      const policy =
        policies.data.find((p) => p._id === tramiteResponse.data.policy_id) ?? null;
      this.policy.set(policy);
    } catch {
      this.toast.error('No se pudo cargar el trámite');
    } finally {
      this.loading.set(false);
    }
  }

  back(): void {
    this.router.navigateByUrl('/app/tramites');
  }

  openTask(task: Task | null): void {
    if (!task?._id) return;
    this.router.navigate(['/app/inbox', task._id]);
  }

  badgeForStatus(status: string): string {
    const map: Record<string, string> = {
      registrado: 'neutral',
      en_proceso: 'info',
      completado: 'success',
      observado: 'warn',
      rechazado: 'danger'
    };
    return map[status] ?? 'neutral';
  }

  badgeForTask(status: string | undefined): string {
    if (!status) return 'neutral';
    const map: Record<string, string> = {
      pendiente: 'neutral',
      en_proceso: 'info',
      observada: 'warn',
      completada: 'success'
    };
    return map[status] ?? 'neutral';
  }

  formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    return date.toLocaleString('es-BO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
