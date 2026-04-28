import { CommonModule } from '@angular/common';
import { Component, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { Policy } from '../../core/api.models';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

type TourTarget = 'policies-actions' | 'policies-create' | 'policies-meters' | 'policies-filters' | 'policies-cards';

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
  selector: 'app-policies-list-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './policies-list-page.component.html',
  styleUrl: './policies-list-page.component.scss'
})
export class PoliciesListPageComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly zone = inject(NgZone);
  readonly session = inject(SessionService);

  readonly policies = signal<Policy[]>([]);
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly showCreate = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal<string>('all');
  readonly tourOpen = signal(false);
  readonly tourIndex = signal(0);
  readonly tourBubble = signal<TourBubblePosition>({ top: 120, left: 120 });

  private resizeHandler: (() => void) | null = null;
  private readonly tourSteps: PageTourStep[] = [
    {
      target: 'policies-actions',
      title: 'Crear políticas',
      body: 'Desde este botón arrancas una nueva política. Luego saltas al diseñador para modelar el flujo visual.'
    },
    {
      target: 'policies-create',
      title: 'Datos base',
      body: 'Aquí defines nombre, tipo de trámite y descripción. Eso crea la política antes de diseñar sus nodos y rutas.'
    },
    {
      target: 'policies-meters',
      title: 'Estado de las políticas',
      body: 'Estas métricas te muestran cuántas están en borrador, validadas, publicadas o archivadas.'
    },
    {
      target: 'policies-filters',
      title: 'Búsqueda rápida',
      body: 'Usa este bloque para encontrar una política por nombre, tipo o estado sin revisar toda la galería.'
    },
    {
      target: 'policies-cards',
      title: 'Galería operativa',
      body: 'Cada tarjeta resume una política y te deja diseñarla, validarla o publicarla con acciones directas.'
    }
  ];

  readonly form = this.fb.group({
    name: ['', Validators.required],
    description: ['', Validators.required],
    procedure_type: ['', Validators.required]
  });

  readonly stats = computed(() => {
    const list = this.policies();
    return {
      total: list.length,
      borrador: list.filter((p) => p.status === 'borrador').length,
      validada: list.filter((p) => p.status === 'validada').length,
      publicada: list.filter((p) => p.status === 'publicada').length,
      archivada: list.filter((p) => p.status === 'archivada').length
    };
  });

  readonly filtered = computed(() => {
    const term = this.search().toLowerCase().trim();
    const status = this.statusFilter();
    return this.policies().filter((policy) => {
      const matchesSearch =
        !term ||
        policy.name.toLowerCase().includes(term) ||
        policy.procedure_type.toLowerCase().includes(term) ||
        policy.description.toLowerCase().includes(term);
      const matchesStatus = status === 'all' || policy.status === status;
      return matchesSearch && matchesStatus;
    });
  });

  constructor() {
    this.refresh();
    this.bindTourListeners();
  }

  ngOnDestroy(): void {
    this.unbindTourListeners();
  }

  refresh(): void {
    this.loading.set(true);
    this.api.listPolicies().subscribe({
      next: (response) => this.policies.set(response.data ?? []),
      error: () => this.toast.error('No se pudieron cargar las políticas'),
      complete: () => this.loading.set(false)
    });
  }

  setStatus(value: string): void {
    this.statusFilter.set(value);
  }

  updateSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  toggleCreate(): void {
    if (!this.canCreatePolicies()) return;
    this.showCreate.update((value) => !value);
    if (this.tourOpen()) {
      setTimeout(() => this.syncTourPosition(), 0);
    }
  }

  open(policy: Policy): void {
    this.router.navigate(['/app/policies', policy._id]);
  }

  canCreatePolicies(): boolean {
    return this.session.hasPermission('policy.create');
  }

  canValidatePolicies(): boolean {
    return this.session.hasPermission('policy.validate');
  }

  canPublishPolicies(): boolean {
    return this.session.hasPermission('policy.publish');
  }

  createPolicy(): void {
    if (!this.canCreatePolicies()) {
      this.toast.warn('No tienes permiso para crear políticas');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.creating.set(true);
    const payload = this.form.getRawValue() as { name: string; description: string; procedure_type: string };
    this.api.createPolicy(payload).subscribe({
      next: (response) => {
        this.toast.success('Política creada', 'Ahora puedes diseñar su flujo');
        this.form.reset();
        this.showCreate.set(false);
        const policy = response.data;
        if (policy?._id) {
          this.refresh();
          this.router.navigate(['/app/policies', policy._id]);
        } else {
          this.refresh();
        }
      },
      error: () => this.toast.error('No se pudo crear la política'),
      complete: () => this.creating.set(false)
    });
  }

  validate(event: Event, policy: Policy): void {
    event.stopPropagation();
    if (!this.canValidatePolicies()) {
      this.toast.warn('No tienes permiso para validar políticas');
      return;
    }
    this.api.validatePolicy(policy._id).subscribe({
      next: (response) => {
        if (response.data.valid) this.toast.success('Política validada', 'Está lista para publicarse');
        else this.toast.warn('Hay observaciones', response.data.observations.join(' · '));
        this.refresh();
      }
    });
  }

  publish(event: Event, policy: Policy): void {
    event.stopPropagation();
    if (!this.canPublishPolicies()) {
      this.toast.warn('No tienes permiso para publicar políticas');
      return;
    }
    this.api.publishPolicy(policy._id).subscribe({
      next: () => {
        this.toast.success('Política publicada', `${policy.name} ya está disponible para tramitar`);
        this.refresh();
      }
    });
  }

  statusBadge(status: string): string {
    const map: Record<string, string> = {
      borrador: 'neutral',
      validada: 'info',
      publicada: 'success',
      archivada: 'danger'
    };
    return map[status] ?? 'neutral';
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
    const nextIndex = this.tourIndex() + 1;
    this.tourIndex.set(nextIndex);
    if (this.tourSteps[nextIndex].target === 'policies-create' && !this.showCreate()) {
      this.showCreate.set(true);
    }
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
    if (event.detail?.route !== 'policies') return;
    this.startTour();
  };

  private startTour(): void {
    if (!this.showCreate()) {
      this.showCreate.set(true);
    }
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
