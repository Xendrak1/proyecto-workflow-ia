import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../core/api.service';
import { Role, SessionService } from '../core/session.service';
import { ToastService } from '../core/toast.service';
import { IconComponent } from '../shared/icon.component';

interface NavItem {
  label: string;
  path: string;
  icon: string;
  roles: Role[];
  description: string;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss'
})
export class ShellComponent {
  readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly mobileNavOpen = signal(false);
  readonly desktopNavCollapsed = signal(this.readDesktopNavCollapsed());

  readonly nav: NavItem[] = [
    {
      label: 'Mi bandeja',
      path: '/app/inbox',
      icon: 'inbox',
      roles: ['administrador', 'funcionario', 'supervisor'],
      description: 'Tareas asignadas'
    },
    {
      label: 'Trámites',
      path: '/app/tramites',
      icon: 'flow',
      roles: ['administrador', 'funcionario', 'supervisor'],
      description: 'Solicitudes en curso'
    },
    {
      label: 'Diseñar políticas',
      path: '/app/policies',
      icon: 'workflow',
      roles: ['administrador', 'supervisor'],
      description: 'Editor de procesos'
    },
    {
      label: 'Analítica',
      path: '/app/analytics',
      icon: 'chart',
      roles: ['administrador', 'supervisor'],
      description: 'Cuellos de botella'
    },
    {
      label: 'Equipo',
      path: '/app/team',
      icon: 'users',
      roles: ['administrador'],
      description: 'Usuarios y roles'
    }
  ];

  readonly visibleNav = computed(() => {
    const role = this.session.role();
    if (!role) return [];
    return this.nav.filter((item) => item.roles.includes(role));
  });

  constructor() {
    void this.hydrateUser();
  }

  private async hydrateUser(): Promise<void> {
    if (!this.session.isLoggedIn()) return;
    // Skip if we already have the userId (populated at login)
    if (this.session.userId()) return;
    try {
      const response = await firstValueFrom(this.api.listUsers());
      const me = response.data.find((user) => user.email === this.session.email());
      if (!me) return;
      this.session.patchSession({
        department: me.department ?? null,
        userId: me._id ?? null,
        fullName: me.full_name,
        subscriptionPlan: me.subscription_plan ?? 'starter'
      });
    } catch {
      // ignore — keep using existing session info
    }
  }

  logout(): void {
    this.session.clearSession();
    this.toast.info('Sesión cerrada', 'Hasta pronto');
    this.router.navigateByUrl('/login');
  }

  toggleMobileNav(): void {
    this.mobileNavOpen.update((open) => !open);
  }

  toggleDesktopNav(): void {
    const next = !this.desktopNavCollapsed();
    this.desktopNavCollapsed.set(next);
    if (typeof window !== 'undefined' && window.innerWidth <= 1024) {
      this.mobileNavOpen.set(true);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('workflow_ia_shell_collapsed', JSON.stringify(next));
    }
  }

  closeMobileNav(): void {
    this.mobileNavOpen.set(false);
  }

  formatRole(role: Role | null): string {
    if (!role) return '—';
    const map: Record<Role, string> = {
      administrador: 'Administrador',
      funcionario: 'Funcionario',
      supervisor: 'Supervisor',
      cliente: 'Cliente'
    };
    return map[role];
  }

  private readDesktopNavCollapsed(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      return JSON.parse(localStorage.getItem('workflow_ia_shell_collapsed') ?? 'false') === true;
    } catch {
      return false;
    }
  }
}
