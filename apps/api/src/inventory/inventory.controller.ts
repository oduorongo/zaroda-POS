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
import { InventoryItemsService } from './inventory-items.service';
import { InventoryTransactionsService } from './inventory-transactions.service';
import { BatchesService } from './batches.service';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import {
  ListConflictsDto,
  ListInventoryItemsDto,
  ListInventoryTransactionsDto,
  ListLowStockAlertsDto,
  SetLowStockThresholdDto,
} from './dto/list-inventory.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts).
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly items: InventoryItemsService,
    private readonly transactions: InventoryTransactionsService,
    private readonly batches: BatchesService,
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

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Patch('items/:branchId/:variantId/threshold')
  setLowStockThreshold(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: SetLowStockThresholdDto,
  ) {
    return this.items.setLowStockThreshold(
      branchId,
      variantId,
      dto.lowStockThreshold,
    );
  }

  // Management-facing, like the ledger below - a cashier doesn't need the
  // alert feed, just the lowStockOnly filter on items above.
  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('alerts')
  findLowStockAlerts(@Query() query: ListLowStockAlertsDto) {
    return this.items.findLowStockAlerts({
      branchId: query.branchId,
      includeResolved: query.includeResolved === 'true',
    });
  }

  // "Conflicts" = stock oversells (negative InventoryItem.quantity) - the
  // durable trace of DESIGN.md §6's "never lose a sale, resolve stock
  // conflicts after the fact" offline-sync philosophy. Same audience as
  // the alert feed above: a supervisor deciding whether to write off a
  // shortfall, cut a delivery, or adjust via a stock take.
  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('conflicts')
  findConflicts(@Query() query: ListConflictsDto) {
    return this.items.findConflicts({ branchId: query.branchId });
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

  // Batch/expiry tracking is a core capability (see schema.prisma's Batch
  // comment) - receiving a batch is a stock-movement operation, same tier
  // as recording any other transaction.
  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post('batches')
  createBatch(@Body() dto: CreateBatchDto) {
    return this.batches.create(dto);
  }

  @Get('batches')
  findBatches(@Query('variantId') variantId?: string) {
    return this.batches.findAll({ variantId });
  }
}
