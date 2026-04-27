import { Injectable, computed, signal } from '@angular/core';

export type Role = 'administrador' | 'funcionario' | 'supervisor' | 'cliente';

export interface SessionState {
  token: string;
  role: Role;
  email: string;
  fullName: string;
  subscriptionPlan: string;
  department: string | null;
  userId: string | null;
}

const STORAGE_KEY = 'workflow_ia_session_v2';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly state = signal<SessionState | null>(this.loadFromStorage());

  readonly snapshot = this.state.asReadonly();
  readonly isLoggedIn = computed(() => !!this.state());
  readonly role = computed<Role | null>(() => this.state()?.role ?? null);
  readonly fullName = computed(() => this.state()?.fullName ?? '');
  readonly email = computed(() => this.state()?.email ?? '');
  readonly subscriptionPlan = computed(() => this.state()?.subscriptionPlan ?? 'starter');
  readonly department = computed(() => this.state()?.department ?? null);
  readonly userId = computed(() => this.state()?.userId ?? null);
  readonly token = computed(() => this.state()?.token ?? null);

  readonly isAdmin = computed(() => this.role() === 'administrador');
  readonly isFuncionario = computed(() => this.role() === 'funcionario');
  readonly isSupervisor = computed(() => this.role() === 'supervisor');
  readonly isCliente = computed(() => this.role() === 'cliente');

  saveSession(payload: SessionState): void {
    this.state.set(payload);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  patchSession(patch: Partial<SessionState>): void {
    const next = { ...(this.state() ?? ({} as SessionState)), ...patch } as SessionState;
    if (!next.token || !next.email) return;
    this.saveSession(next);
  }

  clearSession(): void {
    this.state.set(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('workflow_ia_token');
    localStorage.removeItem('workflow_ia_role');
    localStorage.removeItem('workflow_ia_email');
    localStorage.removeItem('workflow_ia_name');
    localStorage.removeItem('workflow_ia_plan');
  }

  initials(): string {
    const name = this.fullName();
    if (!name) return '·';
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('');
  }

  private loadFromStorage(): SessionState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as SessionState;
      const legacyToken = localStorage.getItem('workflow_ia_token');
      if (legacyToken) {
        const legacy: SessionState = {
          token: legacyToken,
          role: (localStorage.getItem('workflow_ia_role') as Role) ?? 'funcionario',
          email: localStorage.getItem('workflow_ia_email') ?? '',
          fullName: localStorage.getItem('workflow_ia_name') ?? '',
          subscriptionPlan: localStorage.getItem('workflow_ia_plan') ?? 'starter',
          department: null,
          userId: null
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
        return legacy;
      }
      return null;
    } catch {
      return null;
    }
  }
}
