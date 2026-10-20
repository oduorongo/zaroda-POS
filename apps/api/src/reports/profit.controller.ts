import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { ProfitQueryDto } from './dto/profit-query.dto';
import { ProfitService } from './profit.service';

/** The business's profit is for its owners, managers and auditors - not the till staff. */
@Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
@Controller('reports/profit')
export class ProfitController {
  constructor(private readonly profit: ProfitService) {}

  @Get()
  get(@Query() query: ProfitQueryDto) {
    return this.profit.profit(query);
  }
}
