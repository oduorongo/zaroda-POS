import { ExecutionContext, HttpException } from '@nestjs/common';
import { TenantRateLimitGuard } from './tenant-rate-limit.guard';

function contextWithUser(organizationId: string | undefined) {
  const request = { user: organizationId ? { organizationId } : undefined };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('TenantRateLimitGuard', () => {
  it('allows requests with no established tenant (pre-auth routes)', () => {
    const guard = new TenantRateLimitGuard();
    expect(guard.canActivate(contextWithUser(undefined))).toBe(true);
  });

  it('allows requests under the per-organization limit', () => {
    const guard = new TenantRateLimitGuard();
    const ctx = contextWithUser('org-a');
    for (let i = 0; i < 999; i++) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('blocks the 1001st request within the window for one organization', () => {
    const guard = new TenantRateLimitGuard();
    const ctx = contextWithUser('org-a');
    for (let i = 0; i < 1000; i++) guard.canActivate(ctx);
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });

  it('tracks each organization independently', () => {
    const guard = new TenantRateLimitGuard();
    const ctxA = contextWithUser('org-a');
    const ctxB = contextWithUser('org-b');
    for (let i = 0; i < 1000; i++) guard.canActivate(ctxA);
    expect(() => guard.canActivate(ctxA)).toThrow(HttpException);
    // org-b's own budget is untouched by org-a exhausting theirs.
    expect(guard.canActivate(ctxB)).toBe(true);
  });
});
