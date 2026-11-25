import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { FarmRoleCode } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { PayoutSettingsDto, PayrollPayDto } from '../construction/dto/payroll-portal.dto';
import { Farm, FarmFeature, FarmRequest, FarmRoles } from './farm-access';
import { FarmLabourService } from './farm-labour.service';
import { FarmSalesService } from './farm-sales.service';
import { addDays, todayKey } from './farm-livestock.util';
import { MusterDto, WageRunDto, WorkerDto } from './dto/labour.dto';
import { BuyerDto, BuyerPaymentDto, DeliveryDto, ProductTagsDto } from './dto/sales.dto';
import { VoidDto } from './dto/livestock.dto';

const { FARM_MANAGER, HERDSMAN, CROPS_OFFICER, SALES, STOREKEEPER, FEED_MILLER } = FarmRoleCode;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: string | undefined, fallback: string) => {
  if (!v) return fallback;
  if (!DAY.test(v)) throw new BadRequestException('Dates are YYYY-MM-DD');
  return v;
};

/** Zaroda Shamba F6 labour: casual workers, the muster roll and wage runs (Farmer plan and up). */
@Farm()
@FarmFeature('labour')
@Controller('farm/labour')
export class FarmLabourController {
  constructor(private readonly labour: FarmLabourService) {}

  @Get('workers')
  workers(@Req() req: FarmRequest, @Query('all') all?: string) {
    return this.labour.listWorkers(req.farm!, all === '1');
  }

  @FarmRoles(FARM_MANAGER)
  @Post('workers')
  addWorker(@Body() dto: WorkerDto) {
    return this.labour.saveWorker(dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Put('workers/:id')
  updateWorker(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WorkerDto) {
    return this.labour.saveWorker(dto, id);
  }

  @Get('muster')
  muster(@Req() req: FarmRequest, @Query('date') date?: string) {
    return this.labour.muster(req.farm!, day(date, todayKey()));
  }

  @FarmRoles(FARM_MANAGER, HERDSMAN, CROPS_OFFICER, FEED_MILLER, STOREKEEPER)
  @Put('muster')
  saveMuster(@Req() req: FarmRequest, @Body() dto: MusterDto) {
    return this.labour.saveMuster(req.farm!, dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Get('runs')
  runs() {
    return this.labour.listRuns();
  }

  @FarmRoles(FARM_MANAGER)
  @Get('runs/:id')
  run(@Param('id', ParseUUIDPipe) id: string) {
    return this.labour.getRun(id);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('runs')
  createRun(@Body() dto: WageRunDto) {
    return this.labour.createRun(dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Delete('runs/:id')
  removeRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.labour.removeRun(id);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('runs/:id/approve')
  approve(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.labour.approveRun(req.farm!, id);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('runs/:id/pay')
  pay(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayrollPayDto) {
    return this.labour.payRun(req.farm!, id, dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Get('payout-account')
  payout() {
    return this.labour.payoutSettings();
  }

  @FarmRoles(FARM_MANAGER)
  @Put('payout-account')
  savePayout(@Body() dto: PayoutSettingsDto) {
    return this.labour.savePayoutSettings(dto);
  }
}

/** Zaroda Shamba F6 sales: buyers on credit, deliveries, payments, statements (Mkulima and up); enterprise tags and the sales report. */
@Farm()
@FarmFeature('sales_credit')
@Controller('farm/sales')
export class FarmSalesController {
  constructor(private readonly sales: FarmSalesService) {}

  @Get('buyers')
  buyers(@Query('all') all?: string) {
    return this.sales.listBuyers(all === '1');
  }

  @FarmRoles(FARM_MANAGER, SALES)
  @Post('buyers')
  addBuyer(@Body() dto: BuyerDto) {
    return this.sales.saveBuyer(dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Patch('buyers/:id')
  updateBuyer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BuyerDto) {
    return this.sales.saveBuyer(dto, id);
  }

  @Get('buyers/:id/statement')
  statement(@Param('id', ParseUUIDPipe) id: string, @Query('from') from?: string) {
    return this.sales.buyerStatement(id, from ? day(from, from) : undefined);
  }

  @Get('deliveries')
  deliveries(@Query('from') from?: string, @Query('to') to?: string) {
    const end = day(to, todayKey());
    return this.sales.listDeliveries(day(from, addDays(end, -13)), end);
  }

  @FarmRoles(FARM_MANAGER, SALES, HERDSMAN)
  @Post('deliveries')
  deliver(@Req() req: FarmRequest, @Body() dto: DeliveryDto) {
    return this.sales.recordDelivery(req.farm!, dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('deliveries/:id/void')
  voidDelivery(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.sales.voidDelivery(id, dto);
  }

  @FarmRoles(FARM_MANAGER, SALES)
  @Post('payments')
  pay(@Body() dto: BuyerPaymentDto) {
    return this.sales.recordPayment(dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('payments/:id/void')
  voidPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.sales.voidPayment(id, dto);
  }

  @FarmFeature('sales_cash')
  @Get('tags')
  tags() {
    return this.sales.listTags();
  }

  @FarmFeature('sales_cash')
  @FarmRoles(FARM_MANAGER)
  @Put('tags')
  saveTags(@Body() dto: ProductTagsDto) {
    return this.sales.saveTags(dto);
  }

  @FarmFeature('sales_cash')
  @Get('report')
  report(@Query('from') from?: string, @Query('to') to?: string) {
    const end = day(to, todayKey());
    return this.sales.report(day(from, addDays(end, -29)), end);
  }
}

/** Safaricom's B2C answers for farm wages. The URL holds the farm and its secret. */
@Public()
@Controller('public/farm/wages/mpesa-b2c/:organizationId/:secret')
export class FarmWagesCallbackController {
  constructor(private readonly labour: FarmLabourService) {}

  @HttpCode(200)
  @Post('result')
  result(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('secret') secret: string, @Body() body: unknown) {
    return this.labour.b2cResult(organizationId, secret, body);
  }

  @HttpCode(200)
  @Post('timeout')
  timeout(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('secret') secret: string, @Body() body: unknown) {
    return this.labour.b2cResult(organizationId, secret, body, true);
  }
}
