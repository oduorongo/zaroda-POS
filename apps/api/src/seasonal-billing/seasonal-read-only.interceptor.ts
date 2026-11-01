import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { from, Observable, switchMap } from 'rxjs';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { tenantContext } from '../common/tenant/tenant-context';
import { SeasonalBillingService } from './seasonal-billing.service';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Signing in and out, and seeing and paying the subscription, always work.
const ALWAYS_ALLOWED = ['/auth', '/subscription', '/public'];

/**
 * A business on a seasonal plan whose instalment is unpaid past its grace days is READ_ONLY: it can sign in and see its stock, sales
 * and reports, but every change (a sale, a stock edit...) is refused until it pays - then it is open again on the next request.
 * Nothing is ever deleted. Registered app-wide right after TenantContextInterceptor; does nothing for monthly plans or for requests
 * that are not a business's (platform admin, buyers, portals). SEASONAL_READ_ONLY=off switches it off.
 */
@Injectable()
export class SeasonalReadOnlyInterceptor implements NestInterceptor {
  constructor(
    private readonly billing: SeasonalBillingService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly config: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    const store = tenantContext.getStore();
    if (!store?.organizationId || READ_METHODS.has(request.method) || this.config.get<string>('SEASONAL_READ_ONLY') === 'off') return next.handle();
    if (ALWAYS_ALLOWED.some((p) => request.path === p || request.path.startsWith(`${p}/`))) return next.handle();
    // Taken now, while the tenant context is current (it is bound to the call, not to when the check below finishes).
    const handled = next.handle();
    return from(this.tenantPrisma.run((tx) => this.billing.isReadOnly(tx, store.organizationId))).pipe(
      switchMap((readOnly) => {
        if (readOnly)
          throw new ForbiddenException(
            'Your ZARODA POS term instalment is overdue, so the account is read-only: you can still see your stock, sales and reports, but not make sales or change anything. Pay under My subscription and it opens again at once. Nothing has been deleted.',
          );
        return handled;
      }),
    );
  }
}
