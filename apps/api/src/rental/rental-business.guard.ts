import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { PrismaService } from '../common/prisma/prisma.service';

const TTL_MS = 60_000;

/**
 * Rentals' staff routes are only for rental businesses (industryType RENTAL), checked on the server like Build's ConGuard.
 * A business's type does not change, so it is remembered for a minute instead of costing a database trip on every request.
 * Public pages, the tenant portal and payment callbacks are separate controllers and are not affected.
 */
@Injectable()
export class RentalBusinessGuard implements CanActivate {
  private static readonly seen = new Map<string, { type: string | null; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user?.organizationId) throw new ForbiddenException();
    if ((await this.typeOf(user.organizationId)) !== 'RENTAL') {
      throw new ForbiddenException('This is only for rental businesses (ZARODA RENTALS).');
    }
    return true;
  }

  private async typeOf(organizationId: string): Promise<string | null> {
    const hit = RentalBusinessGuard.seen.get(organizationId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.type;
    // organizations has a narrow read exception when no business is set (rls.sql), the same one sign-in uses.
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { industryType: true } });
    const type = org?.industryType ?? null;
    RentalBusinessGuard.seen.set(organizationId, { type, at: Date.now() });
    return type;
  }
}
