import { Controller, Get, Param, ParseUUIDPipe, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { ConRoleCode } from '@prisma/client';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { ConProjectGuard, ConRequest, ConRoles, ConstructionGuard } from '../common/con-access';
import { ReportQueryDto } from '../dto/query.dto';
import { DashboardsService } from './dashboards.service';
import { ReportsService } from './reports.service';
import { REPORT_ROLES, ReportKey, reportXlsx } from './reports.util';

const SITE_VIEW: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_QS', 'CON_ACCOUNTANT', 'CON_PROJECT_MGR', 'CON_SITE_ENGINEER', 'CON_SITE_SUPERVISOR', 'CON_STOREKEEPER', 'CON_TIMEKEEPER'];

@Controller('construction')
@UseGuards(ConstructionGuard, ConProjectGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly dashboards: DashboardsService,
    private readonly tenantPrisma: TenantScopedPrismaService,
  ) {}

  @ConRoles(...REPORT_ROLES)
  @Get('reports')
  catalog(@Req() req: ConRequest) {
    return this.reports.catalog(req.con!);
  }

  @ConRoles(...REPORT_ROLES)
  @Get('reports/:key')
  async report(@Req() req: ConRequest, @Param('key') key: string, @Query() q: ReportQueryDto) {
    const report = await this.reports.run(req.con!, key as ReportKey, q, !!q.format);
    if (q.format !== 'xlsx') return report;
    const org = await this.tenantPrisma.run((tx) => tx.organization.findFirst({ select: { name: true } }));
    const file = await reportXlsx(report, org?.name ?? '');
    return new StreamableFile(file, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: `attachment; filename="${key}-${new Date().toISOString().slice(0, 10)}.xlsx"` });
  }

  @ConRoles('CON_CONTRACTS_MGR')
  @Get('dashboard/director')
  director() {
    return this.dashboards.director();
  }

  @ConRoles(...SITE_VIEW)
  @Get('projects/:projectId/dashboard')
  project(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.dashboards.project(req.con!, projectId);
  }
}
