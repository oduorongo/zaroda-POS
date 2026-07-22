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
import { PurchaseOrderStatus, Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts). Raising,
// receiving, and cancelling a PO all move real stock or commit spend, so
// they're gated the same as any other stock-movement/write endpoint; plain
// reads are open to any authenticated role.
@Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrders: PurchaseOrdersService) {}

  @Post()
  create(@Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrders.create(dto);
  }

  @Get()
  findAll(
    @Query('branchId') branchId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: PurchaseOrderStatus,
  ) {
    return this.purchaseOrders.findAll({ branchId, supplierId, status });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.purchaseOrders.findOne(id);
  }

  @Post(':id/receive')
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceivePurchaseOrderDto,
  ) {
    return this.purchaseOrders.receive(id, dto);
  }

  @Patch(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.purchaseOrders.cancel(id);
  }
}
