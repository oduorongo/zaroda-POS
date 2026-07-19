import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { StockTransfersService } from './stock-transfers.service';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts).
@Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
@Controller('stock-transfers')
export class StockTransfersController {
  constructor(private readonly stockTransfers: StockTransfersService) {}

  @Post()
  create(@Body() dto: CreateStockTransferDto) {
    return this.stockTransfers.create(dto);
  }

  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.stockTransfers.findAll({ branchId });
  }
}
