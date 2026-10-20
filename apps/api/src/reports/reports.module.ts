import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ProfitController } from './profit.controller';
import { ProfitService } from './profit.service';

@Module({
  controllers: [ReportsController, ProfitController],
  providers: [ReportsService, ProfitService],
})
export class ReportsModule {}
