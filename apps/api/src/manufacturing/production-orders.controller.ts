import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ProductionOrderStatus, Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { ProductionOrdersService } from './production-orders.service';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { CompleteProductionOrderDto } from './dto/complete-production-order.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts).
@Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
@Controller('production-orders')
export class ProductionOrdersController {
  constructor(private readonly productionOrders: ProductionOrdersService) {}

  @Post()
  create(@Body() dto: CreateProductionOrderDto) {
    return this.productionOrders.create(dto);
  }

  @Get()
  findAll(
    @Query('branchId') branchId?: string,
    @Query('status') status?: ProductionOrderStatus,
  ) {
    return this.productionOrders.findAll({ branchId, status });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productionOrders.findOne(id);
  }

  @Patch(':id/start')
  start(@Param('id') id: string) {
    return this.productionOrders.start(id);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteProductionOrderDto) {
    return this.productionOrders.complete(id, dto);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.productionOrders.cancel(id);
  }
}
