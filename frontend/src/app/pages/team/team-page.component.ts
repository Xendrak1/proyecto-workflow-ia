import { CommonModule } from '@angular/common';
import { Component, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { ApiService } from '../../core/api.service';
import { User } from '../../core/api.models';
import { PermissionKey, ROLE_DEFAULT_PERMISSIONS, Role } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

type RoleFilter = 'todos' | 'administrador' | 'supervisor' | 'funcionario' | 'cliente';
type TourTarget = 'team-actions' | 'team-create' | 'team-meters' | 'team-filters' | 'team-list';

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
  selector: 'app-team-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './team-page.component.html',
  styleUrl: './team-page.component.scss'
})
export class TeamPageComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly zone = inject(NgZone);

  readonly users = signal<User[]>([]);
  readonly loading = signal(true);
  readonly searchTerm = signal('');
  readonly roleFilter = signal<RoleFilter>('todos');
  readonly showCreate = signal(false);
  readonly editingUserId = signal<string | null>(null);
  readonly tourOpen = signal(false);
  readonly tourIndex = signal(0);
  readonly tourBubble = signal<TourBubblePosition>({ top: 120, left: 120 });
  readonly permissionOptions: Array<{ key: PermissionKey; label: string; description: string }> = [
    { key: 'nav.inbox', label: 'Ver bandeja', description: 'Permite entrar a la bandeja de tareas.' },
    { key: 'nav.tramites', label: 'Ver trámites', description: 'Permite entrar al módulo de trámites.' },
    { key: 'nav.policies', label: 'Ver políticas', description: 'Permite entrar al editor y listado de políticas.' },
    { key: 'nav.analytics', label: 'Ver analítica', description: 'Permite consultar métricas y cuellos de botella.' },
    { key: 'nav.team', label: 'Ver equipo', description: 'Permite entrar al panel de usuarios.' },
    { key: 'tramite.create', label: 'Crear trámites', description: 'Permite iniciar solicitudes nuevas.' },
    { key: 'task.edit', label: 'Editar tareas', description: 'Permite capturar datos y guardar avances en tareas.' },
    { key: 'task.complete', label: 'Completar tareas', description: 'Permite cerrar y enrutar tareas.' },
    { key: 'task.evidence', label: 'Subir evidencias', description: 'Permite adjuntar respaldos y archivos.' },
    { key: 'policy.create', label: 'Crear políticas', description: 'Permite crear nuevas políticas.' },
    { key: 'policy.validate', label: 'Validar políticas', description: 'Permite ejecutar validación del flujo.' },
    { key: 'policy.publish', label: 'Publicar políticas', description: 'Permite publicar políticas operativas.' },
    { key: 'user.manage', label: 'Gestionar usuarios', description: 'Permite editar usuarios, planes y permisos.' }
  ];

  private resizeHandler: (() => void) | null = null;
  private readonly tourSteps: PageTourStep[] = [
    {
      target: 'team-actions',
      title: 'Alta de miembros',
      body: 'Con este botón agregas usuarios nuevos al sistema para asignarles rol, área y plan.'
    },
    {
      target: 'team-create',
      title: 'Formulario de creación',
      body: 'Aquí defines credenciales y perfil inicial del nuevo miembro antes de que empiece a operar.'
    },
    {
      target: 'team-meters',
      title: 'Composición del equipo',
      body: 'Estas tarjetas resumen cuántos administradores, supervisores y funcionarios tienes activos.'
    },
    {
      target: 'team-filters',
      title: 'Búsqueda y segmentación',
      body: 'Usa estos filtros para encontrar personas por rol o departamento y revisar el equipo sin ruido.'
    },
    {
      target: 'team-list',
      title: 'Gestión de planes',
      body: 'En la tabla cambias planes, revisas roles y validas que cada usuario quede correctamente asignado.'
    }
  ];

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
  readonly editForm = this.fb.group({
    full_name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: [''],
    role: ['funcionario', Validators.required],
    department: [''],
    subscription_plan: ['starter'],
    status: ['activo']
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

  startEdit(user: User): void {
    this.editingUserId.set(user._id ?? null);
    this.editForm.reset({
      full_name: user.full_name,
      email: user.email,
      password: '',
      role: user.role,
      department: user.department ?? '',
      subscription_plan: user.subscription_plan ?? 'starter',
      status: user.status ?? 'activo'
    });
  }

  cancelEdit(): void {
    this.editingUserId.set(null);
    this.editForm.reset({
      full_name: '',
      email: '',
      password: '',
      role: 'funcionario',
      department: '',
      subscription_plan: 'starter',
      status: 'activo'
    });
  }

  saveEdit(user: User): void {
    if (!user._id) return;
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    const raw = this.editForm.getRawValue();
    this.api.updateUser(user._id, {
      full_name: raw.full_name as string,
      email: raw.email as string,
      password: (raw.password as string)?.trim() || null,
      role: raw.role as string,
      department: (raw.department as string) || null,
      subscription_plan: raw.subscription_plan as string,
      status: raw.status as string,
      permissions: this.permissionsForUser(user)
    }).subscribe({
      next: () => {
        this.toast.success('Usuario actualizado', `${raw.full_name} quedó guardado con sus nuevos accesos.`);
        this.cancelEdit();
        this.refresh();
      },
      error: () => this.toast.error('No se pudo actualizar el usuario')
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

  permissionCount(user: User): number {
    return this.permissionsForUser(user).length;
  }

  permissionsForUser(user: User): PermissionKey[] {
    const role = (user.role as Role) ?? 'funcionario';
    return (user.permissions?.length ? user.permissions : ROLE_DEFAULT_PERMISSIONS[role] ?? []) as PermissionKey[];
  }

  hasPermission(user: User, permission: PermissionKey): boolean {
    return this.permissionsForUser(user).includes(permission);
  }

  togglePermission(user: User, permission: PermissionKey): void {
    const current = this.permissionsForUser(user);
    const next = current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission];
    user.permissions = next;
  }

  applyRoleDefaults(user: User): void {
    user.permissions = [...(ROLE_DEFAULT_PERMISSIONS[(user.role as Role) ?? 'funcionario'] ?? [])];
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
    if (this.tourSteps[nextIndex].target === 'team-create' && !this.showCreate()) {
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
    if (event.detail?.route !== 'team') return;
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
