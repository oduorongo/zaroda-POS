import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Public pricing for the marketing site's Pricing page - reads the same
 * Plan rows platform-admin's Billing screen manages, so pricing is never
 * duplicated/hardcoded in two places. No RLS involved (Plan carries none,
 * see schema.prisma), and nothing here is tenant-specific.
 */
@Controller('public/plans')
export class PublicPlansController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  findActive() {
    return this.prisma.plan.findMany({
      where: { active: true },
      orderBy: { priceKes: 'asc' },
      select: {
        tier: true,
        name: true,
        priceKes: true,
        billingPeriodDays: true,
        maxDevices: true,
        maxBranches: true,
      },
    });
  }
}
