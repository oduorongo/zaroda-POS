import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, from, switchMap } from 'rxjs';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { RentalPlatformBillingService } from './rental-platform-billing.service';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A landlord with a ZARODA invoice unpaid past its due date can still see everything but cannot change anything
 * (adding, editing, recording payments...) until it is paid. Nothing is deleted. Applied to the landlord's own
 * rental controllers only - never to the payment callbacks, the tenant portal, or the billing screen itself, so
 * money already paid is still recorded and the landlord can still see and settle the invoice.
 *
 * Does nothing unless RENTAL_ENFORCE_READ_ONLY=on, which stays off until landlords can pay their invoice online.
 */
@Injectable()
export class RentalReadOnlyInterceptor implements NestInterceptor {
  constructor(
    private readonly billing: RentalPlatformBillingService,
    private readonly tenantPrisma: TenantScopedPrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (READ_METHODS.has(request.method) || !this.billing.enforcesReadOnly()) return next.handle();

    const { organizationId } = getTenantStore();
    return from(this.tenantPrisma.run((tx) => this.billing.isReadOnly(tx, organizationId))).pipe(
      switchMap((readOnly) => {
        if (readOnly) {
          throw new ForbiddenException(
            'Your Zaroda rentals invoice is overdue, so your account is read-only: you can still see everything but cannot change anything. Open Rentals > Plan to see the invoice. Nothing has been deleted.',
          );
        }
        return next.handle();
      }),
    );
  }
}
