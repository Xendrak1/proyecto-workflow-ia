import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Role, SessionService } from './session.service';

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
      router.navigateByUrl('/app');
      return false;
    }
    return true;
  };
};
