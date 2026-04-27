import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { ApiService } from '../../core/api.service';
import { User } from '../../core/api.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

type RoleFilter = 'todos' | 'administrador' | 'supervisor' | 'funcionario' | 'cliente';

@Component({
  selector: 'app-team-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './team-page.component.html',
  styleUrl: './team-page.component.scss'
})
export class TeamPageComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly users = signal<User[]>([]);
  readonly loading = signal(true);
  readonly searchTerm = signal('');
  readonly roleFilter = signal<RoleFilter>('todos');
  readonly showCreate = signal(false);

  readonly filtered = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const role = this.roleFilter();
    return this.users().filter((user) => {
      const matchesTerm =
        !term ||
        user.full_name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        (user.department ?? '').toLowerCase().includes(term);
      const matchesRole = role === 'todos' || user.role === role;
      return matchesTerm && matchesRole;
    });
  });

  readonly stats = computed(() => {
    const all = this.users();
    return {
      total: all.length,
      administradores: all.filter((u) => u.role === 'administrador').length,
      funcionarios: all.filter((u) => u.role === 'funcionario').length,
      supervisores: all.filter((u) => u.role === 'supervisor').length
    };
  });

  readonly form = this.fb.group({
    full_name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    role: ['funcionario', Validators.required],
    department: [''],
    subscription_plan: ['starter']
  });

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.api.listUsers().subscribe({
      next: (response) => this.users.set(response.data ?? []),
      error: () => this.toast.error('No se pudo cargar el equipo'),
      complete: () => this.loading.set(false)
    });
  }

  setSearch(value: string): void {
    this.searchTerm.set(value);
  }

  setRole(role: RoleFilter): void {
    this.roleFilter.set(role);
  }

  toggleCreate(): void {
    this.showCreate.update((value) => !value);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    this.api
      .createUser({
        full_name: raw.full_name as string,
        email: raw.email as string,
        password: raw.password as string,
        role: raw.role as string,
        department: raw.department || null,
        subscription_plan: raw.subscription_plan as string
      })
      .subscribe({
        next: () => {
          this.toast.success('Miembro creado', `${raw.full_name} ya puede iniciar sesión.`);
          this.form.reset({
            full_name: '',
            email: '',
            password: '',
            role: 'funcionario',
            department: '',
            subscription_plan: 'starter'
          });
          this.showCreate.set(false);
          this.refresh();
        },
        error: () => this.toast.error('No se pudo crear el usuario')
      });
  }

  changePlan(user: User, plan: string): void {
    if (!user._id) return;
    this.api.updateUserPlan(user._id, plan).subscribe({
      next: () => {
        this.toast.success('Plan actualizado', `${user.full_name} ahora está en el plan ${plan}`);
        this.refresh();
      },
      error: () => this.toast.error('No se pudo actualizar el plan')
    });
  }

  initials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  badgeForRole(role: string): string {
    const map: Record<string, string> = {
      administrador: 'primary',
      supervisor: 'info',
      funcionario: 'success',
      cliente: 'neutral'
    };
    return map[role] ?? 'neutral';
  }

  badgeForPlan(plan: string | undefined): string {
    if (!plan) return 'neutral';
    const map: Record<string, string> = {
      starter: 'neutral',
      pro: 'info',
      enterprise: 'violet'
    };
    return map[plan] ?? 'neutral';
  }
}
