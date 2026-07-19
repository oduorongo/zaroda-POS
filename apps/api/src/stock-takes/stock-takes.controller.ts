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
import { StockTakesService } from './stock-takes.service';
import { CreateStockTakeDto } from './dto/create-stock-take.dto';
import { RecordCountDto } from './dto/record-count.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts).
@Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
@Controller('stock-takes')
export class StockTakesController {
  constructor(private readonly stockTakes: StockTakesService) {}

  @Post()
  open(@Body() dto: CreateStockTakeDto) {
    return this.stockTakes.open(dto);
  }

  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.stockTakes.findAll({ branchId });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.stockTakes.findOne(id);
  }

  @Patch(':id/lines/:lineId')
  recordCount(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: RecordCountDto,
  ) {
    return this.stockTakes.recordCount(id, lineId, dto);
  }

  @Patch(':id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.stockTakes.complete(id);
  }
}
