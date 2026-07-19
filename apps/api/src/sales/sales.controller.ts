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
  ) {
    return this.sales.findAll({ branchId, shiftId });
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
}
