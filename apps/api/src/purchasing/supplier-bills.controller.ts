import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Role, SupplierBillStatus } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  CreateSupplierBillDto,
  CreditBillDto,
  PayBillDto,
  VoidBillDto,
} from './dto/supplier-bill.dto';
import { SupplierBillsService } from './supplier-bills.service';

// What the business owes is for managers and owners; an auditor can read it.
const READERS = [Role.SUPERVISOR, Role.MANAGER, Role.OWNER, Role.AUDITOR];
const WRITERS = [Role.MANAGER, Role.OWNER];

@Controller('supplier-bills')
export class SupplierBillsController {
  constructor(private readonly bills: SupplierBillsService) {}

  @Roles(...WRITERS)
  @Post()
  create(@Body() dto: CreateSupplierBillDto) {
    return this.bills.create(dto);
  }

  @Roles(...READERS)
  @Get()
  list(
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('overdue') overdue?: string,
  ) {
    const valid =
      status && (Object.values(SupplierBillStatus) as string[]).includes(status)
        ? (status as SupplierBillStatus)
        : undefined;
    return this.bills.list({
      supplierId,
      status: valid,
      overdue: overdue === 'true',
    });
  }

  // Before ':id' so "aging" is not read as an id.
  @Roles(...READERS)
  @Get('aging')
  aging() {
    return this.bills.aging();
  }

  @Roles(...READERS)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bills.findOne(id);
  }

  @Roles(...WRITERS)
  @Post(':id/payments')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayBillDto) {
    return this.bills.pay(id, dto);
  }

  @Roles(...WRITERS)
  @Post(':id/credits')
  credit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreditBillDto) {
    return this.bills.credit(id, dto);
  }

  @Roles(...WRITERS)
  @Post(':id/void')
  @HttpCode(200)
  voidBill(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidBillDto) {
    return this.bills.voidBill(id, dto);
  }
}
