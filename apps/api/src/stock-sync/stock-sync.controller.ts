import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { StockSyncService } from './stock-sync.service';
import { MAX_STOCK_ROWS } from './stock-sync.util';

class StockRowsDto {
  /** True = only check the list and say what would change. */
  @IsBoolean()
  @IsOptional()
  dryRun?: boolean;

  /** One object per product: sku or barcode, and stock and/or price. */
  @IsArray()
  @ArrayMaxSize(MAX_STOCK_ROWS)
  rows!: Record<string, unknown>[];
}

class StockUpdateDto extends StockRowsDto {
  @IsUUID()
  branchId!: string;
}

class CreateSyncKeyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsUUID()
  branchId!: string;
}

/** Updating stock and prices from another POS: a spreadsheet in the back office, or the other system with a sync key. */
@Controller()
export class StockSyncController {
  constructor(private readonly sync: StockSyncService) {}

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('products/stock-update')
  @HttpCode(200)
  update(@Body() dto: StockUpdateDto) {
    return this.sync.update(dto);
  }

  @Roles(Role.OWNER)
  @Get('stock-sync/keys')
  keys() {
    return this.sync.listKeys();
  }

  @Roles(Role.OWNER)
  @Post('stock-sync/keys')
  createKey(@Body() dto: CreateSyncKeyDto) {
    return this.sync.createKey(dto);
  }

  @Roles(Role.OWNER)
  @Delete('stock-sync/keys/:id')
  revokeKey(@Param('id', ParseUUIDPipe) id: string) {
    return this.sync.revokeKey(id);
  }

  /** For the other POS: "Authorization: Bearer zsync_..." (or X-Sync-Key). Applies at once unless dryRun is true. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Put('stock-sync')
  push(@Headers('authorization') auth: string | undefined, @Headers('x-sync-key') header: string | undefined, @Body() dto: StockRowsDto) {
    return this.sync.updateWithKey(header ?? auth?.replace(/^Bearer\s+/i, ''), dto);
  }
}
