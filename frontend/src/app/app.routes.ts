import { Routes } from '@angular/router';

import { authGuard, guestGuard, roleGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login-page.component').then((m) => m.LoginPageComponent)
  },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inbox' },
      {
        path: 'inbox',
        loadComponent: () => import('./pages/inbox/inbox-page.component').then((m) => m.InboxPageComponent)
      },
      {
        path: 'inbox/:taskId',
        loadComponent: () =>
          import('./pages/inbox/task-detail-page.component').then((m) => m.TaskDetailPageComponent)
      },
      {
        path: 'policies',
        canActivate: [roleGuard(['administrador', 'supervisor'])],
        loadComponent: () =>
          import('./pages/policies/policies-list-page.component').then((m) => m.PoliciesListPageComponent)
      },
      {
        path: 'policies/:policyId',
        canActivate: [roleGuard(['administrador', 'supervisor'])],
        loadComponent: () =>
          import('./pages/policies/policy-designer-page.component').then((m) => m.PolicyDesignerPageComponent)
      },
      {
        path: 'tramites',
        loadComponent: () =>
          import('./pages/tramites/tramites-page.component').then((m) => m.TramitesPageComponent)
      },
      {
        path: 'tramites/:tramiteCode',
        loadComponent: () =>
          import('./pages/tramites/tramite-detail-page.component').then((m) => m.TramiteDetailPageComponent)
      },
      {
        path: 'analytics',
        canActivate: [roleGuard(['administrador', 'supervisor'])],
        loadComponent: () =>
          import('./pages/analytics/analytics-page.component').then((m) => m.AnalyticsPageComponent)
      },
      {
        path: 'team',
        canActivate: [roleGuard(['administrador'])],
        loadComponent: () => import('./pages/team/team-page.component').then((m) => m.TeamPageComponent)
      }
    ]
  },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' }
];
