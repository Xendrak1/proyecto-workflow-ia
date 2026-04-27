import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { Policy, Tramite } from '../../core/api.models';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

type StatusFilter = 'todos' | 'en_proceso' | 'completado' | 'observado';

@Component({
  selector: 'app-tramites-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './tramites-page.component.html',
  styleUrl: './tramites-page.component.scss'
})
export class TramitesPageComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  readonly session = inject(SessionService);

  readonly tramites = signal<Tramite[]>([]);
  readonly policies = signal<Policy[]>([]);
  readonly loading = signal(true);
  readonly showCreate = signal(false);
  readonly searchTerm = signal('');
  readonly statusFilter = signal<StatusFilter>('todos');

  readonly canCreate = computed(
    () => this.session.isAdmin() || this.session.isSupervisor() || this.session.isFuncionario() || this.session.isCliente()
  );

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
}
