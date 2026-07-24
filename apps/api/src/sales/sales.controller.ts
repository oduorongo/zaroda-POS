import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { VoidSaleDto } from './dto/void-sale.dto';
import { CreateRefundDto } from './dto/create-refund.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts).
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  // No @Roles() - this is the register itself, every cashier rings up sales.
  @Post()
  create(@Body() dto: CreateSaleDto) {
    return this.sales.create(dto);
  }

  @Get()
  findAll(
    @Query('branchId') branchId?: string,
    @Query('shiftId') shiftId?: string,
    @Query('clientId') clientId?: string,
  ) {
    return this.sales.findAll({ branchId, shiftId, clientId });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.findOne(id);
  }

  // Voids are sensitive and always audit-logged (DESIGN.md §3) - a plain
  // cashier can ring up a sale but not unwind one.
  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Patch(':id/void')
  voidSale(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidSaleDto) {
    return this.sales.void(id, dto);
  }

  // Not role-gated at the endpoint level - the approver identity carried
  // in the body is re-verified against the database inside
  // SalesService.refund() (same pattern as a sale's discount approver),
  // so a cashier can submit the request but the refund is only actually
  // created if the named approver genuinely holds supervisor+.
  @Post(':id/refunds')
  refund(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRefundDto) {
    return this.sales.refund(id, dto);
  }
}
