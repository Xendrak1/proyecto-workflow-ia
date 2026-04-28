import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { PermissionKey, Role, SessionService } from './session.service';

function fallbackRoute(session: SessionService): string {
  if (session.hasPermission('nav.inbox')) return '/app/inbox';
  if (session.hasPermission('nav.tramites')) return '/app/tramites';
  if (session.hasPermission('nav.policies')) return '/app/policies';
  if (session.hasPermission('nav.analytics')) return '/app/analytics';
  if (session.hasPermission('nav.team')) return '/app/team';
  return '/login';
}

export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  if (session.isLoggedIn()) return true;
  router.navigateByUrl('/login');
  return false;
};

export const guestGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  if (!session.isLoggedIn()) return true;
  router.navigateByUrl('/app');
  return false;
};

export const roleGuard = (allowed: Role[]): CanActivateFn => {
  return () => {
    const session = inject(SessionService);
    const router = inject(Router);
    if (!session.isLoggedIn()) {
      router.navigateByUrl('/login');
      return false;
    }
    if (!allowed.includes(session.role()!)) {
      router.navigateByUrl(fallbackRoute(session));
      return false;
    }
    return true;
  };
};

export const permissionGuard = (required: PermissionKey[]): CanActivateFn => {
  return () => {
    const session = inject(SessionService);
    const router = inject(Router);
    if (!session.isLoggedIn()) {
      router.navigateByUrl('/login');
      return false;
    }
    const allowed = required.every((permission) => session.hasPermission(permission));
    if (!allowed) {
      router.navigateByUrl(fallbackRoute(session));
      return false;
    }
    return true;
  };
};
