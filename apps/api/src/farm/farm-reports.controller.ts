import { BadRequestException, Controller, Get, Param, Query, Req, StreamableFile } from '@nestjs/common';
import { FarmRoleCode } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { Report as ConReport, reportXlsx } from '../construction/reports/reports.util';
import { Farm, FarmRequest, FarmRoles, upgradeError } from './farm-access';
import { FARM_FEATURES, cheapestWith } from './farm-plans.util';
import { FarmSetupService } from './farm-setup.service';
import { FarmReportsService } from './farm-reports.service';
import { FARM_REPORTS, FARM_REPORT_KEYS, FarmReportKey } from './farm-reports.util';
import { addDays, todayKey } from './farm-livestock.util';

const { FARM_MANAGER, AUDITOR } = FarmRoleCode;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Zaroda Shamba F7 reports. Each report needs its plan feature (basic or full); full reports come with Excel downloads. */
@Farm()
@FarmRoles(FARM_MANAGER, AUDITOR)
@Controller('farm/reports')
export class FarmReportsController {
  constructor(
    private readonly reports: FarmReportsService,
    private readonly setup: FarmSetupService,
    private readonly tenantPrisma: TenantScopedPrismaService,
  ) {}

  @Get()
  catalog(@Req() req: FarmRequest) {
    return FARM_REPORT_KEYS.map((key) => ({ key, title: FARM_REPORTS[key].title, period: FARM_REPORTS[key].period, allowed: req.farm!.plan.features.includes(FARM_REPORTS[key].feature) }));
  }

  @Get(':key')
  async report(@Req() req: FarmRequest, @Param('key') key: string, @Query('from') from?: string, @Query('to') to?: string, @Query('format') format?: string) {
    if (!FARM_REPORT_KEYS.includes(key as FarmReportKey)) throw new BadRequestException('Unknown report');
    const k = key as FarmReportKey;
    const farm = req.farm!;
    const feature = format === 'xlsx' ? 'reports_full' : FARM_REPORTS[k].feature;
    if (!farm.plan.features.includes(feature)) {
      const target = cheapestWith(await this.setup.activePlans(), (p) => p.features.includes(feature));
      throw upgradeError(`${format === 'xlsx' ? 'Downloads' : FARM_REPORTS[k].title} ${format === 'xlsx' ? 'are' : 'is'} not on your ${farm.plan.name} plan (${FARM_FEATURES[feature]}).${target ? ` Upgrade to ${target.name} to use it.` : ''}`, { feature, requiredPlan: target?.code ?? null });
    }
    const end = to && DAY.test(to) ? to : todayKey();
    const start = from && DAY.test(from) ? from : addDays(end, -29);
    if (start > end) throw new BadRequestException('The period ends before it starts');
    const report = await this.reports.run(farm, k, start, end);
    if (format !== 'xlsx') return report;
    const farmName = await this.tenantPrisma.run(async (tx) => (await tx.farmSettings.findFirst({ select: { farmName: true } }))?.farmName ?? (await tx.organization.findFirst({ select: { name: true } }))?.name ?? '');
    const file = await reportXlsx(report as unknown as ConReport, farmName);
    return new StreamableFile(file, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: `attachment; filename="farm-${k}-${end}.xlsx"` });
  }
}
