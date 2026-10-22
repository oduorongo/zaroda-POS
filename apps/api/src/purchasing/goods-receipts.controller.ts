import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CreateGoodsReceiptDto } from './dto/goods-receipt.dto';
import { GoodsReceiptsService } from './goods-receipts.service';

// Receiving moves real stock, so it is for supervisors and above (as receiving against an order always was); auditors can read.
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(private readonly receipts: GoodsReceiptsService) {}

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post()
  create(@Body() dto: CreateGoodsReceiptDto) {
    return this.receipts.create(dto);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get()
  list(
    @Query('branchId') branchId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('purchaseOrderId') purchaseOrderId?: string,
  ) {
    return this.receipts.list({ branchId, supplierId, purchaseOrderId });
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.findOne(id);
  }
}
