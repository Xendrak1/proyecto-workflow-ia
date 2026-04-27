import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { Policy } from '../../core/api.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-policies-list-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './policies-list-page.component.html',
  styleUrl: './policies-list-page.component.scss'
})
export class PoliciesListPageComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly policies = signal<Policy[]>([]);
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly showCreate = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal<string>('all');

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
    this.showCreate.update((value) => !value);
  }

  open(policy: Policy): void {
    this.router.navigate(['/app/policies', policy._id]);
  }

  createPolicy(): void {
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
}
