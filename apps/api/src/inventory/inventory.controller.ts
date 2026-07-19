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
import { InventoryItemsService } from './inventory-items.service';
import { InventoryTransactionsService } from './inventory-transactions.service';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';
import {
  ListInventoryItemsDto,
  ListInventoryTransactionsDto,
} from './dto/list-inventory.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts).
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly items: InventoryItemsService,
    private readonly transactions: InventoryTransactionsService,
  ) {}

  // Stock levels: any authenticated role can read (a cashier needs to know
  // if something's in stock at the point of sale).
  @Get('items')
  findItems(@Query() query: ListInventoryItemsDto) {
    return this.items.findAllForBranch(
      query.branchId,
      query.lowStockOnly === 'true',
    );
  }

  @Get('items/:branchId/:variantId')
  findOneItem(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.items.findOne(branchId, variantId);
  }

  // The ledger itself (who moved what stock, when, why) is a
  // management/audit view, not a POS-terminal read.
  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('transactions')
  findTransactions(@Query() query: ListInventoryTransactionsDto) {
    return this.transactions.findAll(query);
  }

  // Recording a stock movement (receiving deliveries, manual adjustments,
  // corrections) is restricted the same way as the ledger read - sales will
  // write here too once the sales module exists, but via its own internal
  // call, not this public endpoint's role gate.
  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post('transactions')
  recordTransaction(@Body() dto: CreateInventoryTransactionDto) {
    return this.transactions.record(dto);
  }
}
