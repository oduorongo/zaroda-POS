import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { ReportsService } from './reports.service';
import { ReportFiltersDto } from './dto/report-filters.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts). Reports
// reveal financial data across the whole branch/org, not just a cashier's
// own shift (unlike shifts' X/Z-report) - restricted the same way as the
// inventory ledger and sale voids.
@Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER, Role.AUDITOR)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales-by-product')
  salesByProduct(@Query() filters: ReportFiltersDto) {
    return this.reports.salesByProduct(filters);
  }

  @Get('sales-by-branch')
  salesByBranch(@Query() filters: ReportFiltersDto) {
    return this.reports.salesByBranch(filters);
  }

  @Get('sales-by-cashier')
  salesByCashier(@Query() filters: ReportFiltersDto) {
    return this.reports.salesByCashier(filters);
  }

  @Get('sales-by-hour')
  salesByHour(@Query() filters: ReportFiltersDto) {
    return this.reports.salesByHour(filters);
  }
}
