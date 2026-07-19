import { AsyncLocalStorage } from 'node:async_hooks';
import { Role } from '@prisma/client';

export interface TenantStore {
  organizationId: string;
  orgUserId: string;
  role: Role;
}

/**
 * Request-scoped tenant identity, carried via AsyncLocalStorage rather than
 * a Nest request-scoped provider so plain service code (not just
 * controllers) can read "who is this request for" without threading it
 * through every function signature. Populated by TenantContextInterceptor
 * once the JWT guard has run (see that file for why an interceptor, not
 * middleware, is the right place to do this).
 */
export const tenantContext = new AsyncLocalStorage<TenantStore>();

export function getTenantStore(): TenantStore {
  const store = tenantContext.getStore();
  if (!store) {
    throw new Error(
      'No tenant context available - this code path ran outside an authenticated request ' +
        '(TenantContextInterceptor never ran). Public/unauthenticated routes must not call ' +
        'anything that depends on tenant context.',
    );
  }
  return store;
}
