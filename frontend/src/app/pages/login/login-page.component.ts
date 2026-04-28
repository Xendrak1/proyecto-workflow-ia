import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { Role, SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

interface QuickAccount {
  email: string;
  role: string;
  description: string;
}

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss'
})
export class LoginPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly showPassword = signal(false);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]]
  });

  readonly quickAccounts: QuickAccount[] = [
    {
      email: 'admin@workflowia.com',
      role: 'Administrador',
      description: 'Diseña políticas, gestiona usuarios y ve toda la operación.'
    }
  ];

  readonly highlights = [
    {
      icon: 'workflow',
      title: 'Diseño visual de procesos',
      description: 'Construye políticas como diagramas de actividad con calles, decisiones y rutas paralelas.'
    },
    {
      icon: 'sparkles',
      title: 'Asistencia con IA',
      description: 'Describe tu flujo con texto o voz y el sistema propone los nodos y transiciones.'
    },
    {
      icon: 'inbox',
      title: 'Bandeja viva del funcionario',
      description: 'Tareas en colores con auto-actualización: rojo lo urgente, ámbar lo activo, verde lo cerrado.'
    },
    {
      icon: 'chart',
      title: 'Cuellos de botella detectados',
      description: 'Analítica con métricas de saturación por nodo, lane y política.'
    }
  ];

  togglePassword(): void {
    this.showPassword.update((value) => !value);
  }

  useQuickAccount(account: QuickAccount): void {
    this.form.patchValue({ email: account.email });
  }

  submit(): void {
    if (this.form.invalid || this.loading()) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    this.api.login(this.form.getRawValue() as { email: string; password: string }).subscribe({
      next: (response) => {
        this.session.saveSession({
          token: response.access_token,
          role: response.role as Role,
          email: response.email,
          fullName: response.full_name,
          subscriptionPlan: response.subscription_plan,
          department: response.department ?? null,
          userId: response.user_id ?? null,
          permissions: response.permissions ?? []
        });
        this.toast.success(`Bienvenido, ${response.full_name}`, 'Sesión iniciada correctamente');
        this.router.navigateByUrl('/app');
      },
      error: (error) => {
        this.errorMessage.set(error?.error?.detail ?? 'No se pudo iniciar sesión.');
        this.loading.set(false);
      },
      complete: () => this.loading.set(false)
    });
  }
}
