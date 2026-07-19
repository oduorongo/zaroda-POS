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
import { LayawaysService } from './layaways.service';
import { CreateLayawayDto } from './dto/create-layaway.dto';
import { RecordLayawayPaymentDto } from './dto/record-layaway-payment.dto';
import { CancelLayawayDto } from './dto/cancel-layaway.dto';
import { ListLayawaysDto } from './dto/list-layaways.dto';

// JwtAuthGuard is global. Create/pay/complete are register-floor operations
// open to any authenticated role (including cashier); cancellation is
// restricted, same reasoning as void-sale, since it writes off a
// customer's paid-in deposit without a refund happening automatically.
@Controller('layaways')
export class LayawaysController {
  constructor(private readonly layaways: LayawaysService) {}

  @Post()
  create(@Body() dto: CreateLayawayDto) {
    return this.layaways.create(dto);
  }

  @Get()
  findAll(@Query() query: ListLayawaysDto) {
    return this.layaways.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.layaways.findOne(id);
  }

  @Post(':id/payments')
  recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordLayawayPaymentDto,
  ) {
    return this.layaways.recordPayment(id, dto);
  }

  @Patch(':id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.layaways.complete(id);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Patch(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelLayawayDto,
  ) {
    return this.layaways.cancel(id, dto);
  }
}
