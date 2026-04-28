import { CommonModule } from '@angular/common';
import { Component, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { Policy, Tramite } from '../../core/api.models';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

type StatusFilter = 'todos' | 'en_proceso' | 'completado' | 'observado';
type TourTarget = 'tramites-actions' | 'tramites-create' | 'tramites-meters' | 'tramites-filters' | 'tramites-list';

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
  selector: 'app-tramites-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './tramites-page.component.html',
  styleUrl: './tramites-page.component.scss'
})
export class TramitesPageComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  readonly session = inject(SessionService);

  readonly tramites = signal<Tramite[]>([]);
  readonly policies = signal<Policy[]>([]);
  readonly loading = signal(true);
  readonly showCreate = signal(false);
  readonly searchTerm = signal('');
  readonly statusFilter = signal<StatusFilter>('todos');
  readonly tourOpen = signal(false);
  readonly tourIndex = signal(0);
  readonly tourBubble = signal<TourBubblePosition>({ top: 120, left: 120 });

  private resizeHandler: (() => void) | null = null;
  private readonly tourSteps: PageTourStep[] = [
    {
      target: 'tramites-actions',
      title: 'Crear nuevos trámites',
      body: 'Desde aquí inicias solicitudes nuevas. El sistema usará la política publicada para generar tareas automáticamente.'
    },
    {
      target: 'tramites-create',
      title: 'Formulario de arranque',
      body: 'Cuando abras este panel, defines al solicitante y el tipo de trámite. Eso dispara el flujo completo.'
    },
    {
      target: 'tramites-meters',
      title: 'Estado general',
      body: 'Estas métricas te dejan ver rápido cuántos trámites están en curso, completados o con observaciones.'
    },
    {
      target: 'tramites-filters',
      title: 'Búsqueda y filtros',
      body: 'Aquí filtras por texto y por estado para ubicar un caso concreto sin recorrer toda la tabla.'
    },
    {
      target: 'tramites-list',
      title: 'Listado trazable',
      body: 'Cada fila muestra quién solicitó el trámite, qué política está corriendo y en qué nodo va. Desde aquí entras al detalle.'
    }
  ];

  readonly canCreate = computed(() => this.session.hasPermission('tramite.create'));

  readonly publishedPolicies = computed(() =>
    this.policies().filter((policy) => policy.status === 'publicada')
  );

  readonly procedureTypes = computed(() =>
    Array.from(new Set(this.publishedPolicies().map((p) => p.procedure_type)))
  );

  readonly filtered = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const status = this.statusFilter();
    return this.tramites().filter((tramite) => {
      const matchesTerm =
        !term ||
        tramite.code.toLowerCase().includes(term) ||
        tramite.applicant_name.toLowerCase().includes(term) ||
        tramite.applicant_document.toLowerCase().includes(term) ||
        tramite.procedure_type.toLowerCase().includes(term);
      const matchesStatus = status === 'todos' || tramite.status === status;
      return matchesTerm && matchesStatus;
    });
  });

  readonly stats = computed(() => {
    const all = this.tramites();
    return {
      total: all.length,
      enCurso: all.filter((t) => t.status === 'en_proceso').length,
      completados: all.filter((t) => t.status === 'completado').length,
      observados: all.filter((t) => t.status === 'observado').length
    };
  });

  readonly form = this.fb.group({
    applicant_name: ['', Validators.required],
    applicant_document: ['', Validators.required],
    procedure_type: ['', Validators.required]
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
    this.api.listTramites().subscribe({
      next: (response) => this.tramites.set(response.data ?? []),
      error: () => this.toast.error('No se pudo cargar la lista de trámites'),
      complete: () => this.loading.set(false)
    });
    this.api.listPolicies().subscribe({
      next: (response) => {
        this.policies.set(response.data ?? []);
        const types = this.procedureTypes();
        if (types.length && !this.form.value.procedure_type) {
          this.form.patchValue({ procedure_type: types[0] });
        }
      }
    });
  }

  setSearch(value: string): void {
    this.searchTerm.set(value);
  }

  setStatus(filter: StatusFilter): void {
    this.statusFilter.set(filter);
  }

  toggleCreate(): void {
    this.showCreate.update((open) => !open);
    if (this.tourOpen()) {
      setTimeout(() => this.syncTourPosition(), 0);
    }
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    this.api
      .createTramite({
        applicant_name: raw.applicant_name as string,
        applicant_document: raw.applicant_document as string,
        procedure_type: raw.procedure_type as string
      })
      .subscribe({
        next: (response) => {
          this.toast.success('Trámite iniciado', `Código ${response.data.code}`);
          this.form.reset({
            applicant_name: '',
            applicant_document: '',
            procedure_type: this.form.value.procedure_type ?? ''
          });
          this.showCreate.set(false);
          this.refresh();
        },
        error: () => this.toast.error('No se pudo crear el trámite')
      });
  }

  openTramite(tramite: Tramite): void {
    this.router.navigate(['/app/tramites', tramite.code]);
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

  formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    return date.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
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
    if (this.tourSteps[nextIndex].target === 'tramites-create' && !this.showCreate()) {
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
    if (event.detail?.route !== 'tramites') return;
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
