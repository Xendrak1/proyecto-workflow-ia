import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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

interface GuideContent {
  title: string;
  summary: string;
  steps: string[];
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
  readonly activeGuide = signal<GuideContent | null>(null);

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
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.maybeOpenGuideForRoute(event.urlAfterRedirects);
      }
    });
    this.maybeOpenGuideForRoute(this.router.url);
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

  openCurrentGuide(force = false): void {
    if (this.handleRouteSpecificGuide(this.router.url, force)) {
      return;
    }
    const guide = this.guideForUrl(this.router.url);
    if (!guide) return;
    if (force) {
      this.markGuideSeen(this.router.url);
    }
    this.activeGuide.set(guide);
  }

  closeGuide(): void {
    this.activeGuide.set(null);
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

  private maybeOpenGuideForRoute(url: string): void {
    if (this.handleRouteSpecificGuide(url, false)) {
      return;
    }
    const guide = this.guideForUrl(url);
    if (!guide) return;
    if (this.hasSeenGuide(url)) return;
    this.markGuideSeen(url);
    this.activeGuide.set(guide);
  }

  private handleRouteSpecificGuide(url: string, force: boolean): boolean {
    if (typeof window === 'undefined') return false;
    const route =
      url.includes('/app/policies/') ? 'policy-designer'
      : url.includes('/app/policies') ? 'policies'
      : url.includes('/app/inbox') ? 'inbox'
      : url.includes('/app/tramites') ? 'tramites'
      : url.includes('/app/analytics') ? 'analytics'
      : url.includes('/app/team') ? 'team'
      : null;
    if (!route) return false;
    if (!force && this.hasSeenGuide(url)) return true;
    this.markGuideSeen(url);
    window.dispatchEvent(
      new CustomEvent('workflow-ia:start-tour', {
        detail: {
          route,
          force
        }
      })
    );
    return true;
  }

  private guideForUrl(url: string): GuideContent | null {
    if (url.includes('/app/inbox')) {
      return {
        title: 'Guía · mi bandeja',
        summary: 'Aquí monitoreas tus tareas vivas y entras al detalle para trabajar cada paso.',
        steps: [
          'Usa los bloques superiores para filtrar rápidamente pendientes, en proceso, observadas y cerradas.',
          'Abre una tarea para completar el formulario, adjuntar evidencias y finalizar el paso.',
          'La bandeja se refresca con frecuencia, pero puedes actualizar manualmente cuando lo necesites.'
        ]
      };
    }
    if (url.includes('/app/tramites')) {
      return {
        title: 'Guía · trámites',
        summary: 'En esta vista sigues el estado general de las solicitudes que están recorriendo el workflow.',
        steps: [
          'Revisa quién inició el trámite, qué tipo de procedimiento es y en qué punto se encuentra.',
          'Usa esta vista para validar trazabilidad antes de entrar a una tarea concreta.',
          'Si necesitas detalle operativo, abre la tarea asociada desde la bandeja.'
        ]
      };
    }
    if (url.includes('/app/policies/')) {
      return {
        title: 'Guía · diseñador de políticas',
        summary: 'Aquí modelas el flujo por carriles, conectas nodos y ajustas formularios e IA.',
        steps: [
          'Cada calle representa un área o responsable; los nodos muestran los pasos del proceso.',
          'Usa Nodo para crear pasos, Ruta para conectarlos y Campos para definir el formulario del funcionario.',
          'La pestaña IA te ayuda a proponer o adaptar el flujo; luego revisas y aplicas al diagrama.'
        ]
      };
    }
    if (url.includes('/app/policies')) {
      return {
        title: 'Guía · políticas',
        summary: 'Esta sección reúne las políticas de negocio que puedes diseñar, validar o publicar.',
        steps: [
          'Primero identifica la política que quieres revisar o editar.',
          'Desde aquí puedes entrar al diseñador o gestionar el ciclo de validación y publicación.',
          'Las políticas activas son la base de los trámites que luego ejecutan los funcionarios.'
        ]
      };
    }
    if (url.includes('/app/analytics')) {
      return {
        title: 'Guía · analítica',
        summary: 'La analítica te muestra carga, cuellos de botella y recomendaciones para intervenir el proceso.',
        steps: [
          'Revisa los KPI de tareas y cierres para medir el ritmo general del sistema.',
          'Observa los nodos críticos y la lectura IA para detectar saturaciones o desvíos.',
          'Usa JSON o CSV para exportar el reporte y compartirlo con docentes, supervisores o dirección.'
        ]
      };
    }
    if (url.includes('/app/team')) {
      return {
        title: 'Guía · equipo',
        summary: 'Aquí administras usuarios, roles y planes de trabajo dentro de la plataforma.',
        steps: [
          'Crea usuarios con su rol correspondiente y asígnales departamento cuando haga falta.',
          'Verifica que cada miembro tenga el plan adecuado para lo que necesita operar.',
          'Mantén esta vista actualizada para que la bandeja y los trámites se enruten correctamente.'
        ]
      };
    }
    return null;
  }

  private guideKey(url: string): string {
    if (url.includes('/app/policies/')) return 'policy-detail';
    if (url.includes('/app/policies')) return 'policies';
    if (url.includes('/app/inbox')) return 'inbox';
    if (url.includes('/app/tramites')) return 'tramites';
    if (url.includes('/app/analytics')) return 'analytics';
    if (url.includes('/app/team')) return 'team';
    return 'generic';
  }

  private hasSeenGuide(url: string): boolean {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(`workflow_ia_guide_${this.guideKey(url)}`) === '1';
  }

  private markGuideSeen(url: string): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`workflow_ia_guide_${this.guideKey(url)}`, '1');
  }
}
