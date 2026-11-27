import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { FarmRoleCode } from '@prisma/client';
import { Farm, FarmRoles } from './farm-access';
import { CreateFarmInputDto, MarkFarmInputDto, ReceiveFarmInputDto } from './dto/inputs.dto';
import { FarmInputsService } from './farm-inputs.service';

const { FARM_MANAGER, STOREKEEPER, CROPS_OFFICER, FEED_MILLER, VET, HERDSMAN, AUDITOR } = FarmRoleCode;

/** Farm inputs (seed, fertiliser, sprays, vet drugs, bought feed): on every plan. Storekeepers and managers keep the list and take deliveries. */
@Farm()
@FarmRoles(FARM_MANAGER, STOREKEEPER, CROPS_OFFICER, FEED_MILLER, VET, HERDSMAN, AUDITOR)
@Controller('farm/inputs')
export class FarmInputsController {
  constructor(private readonly inputs: FarmInputsService) {}

  @Get()
  list() {
    return this.inputs.list();
  }

  @Get('ids')
  ids() {
    return this.inputs.ids();
  }

  @FarmRoles(FARM_MANAGER, STOREKEEPER)
  @Post()
  create(@Body() dto: CreateFarmInputDto) {
    return this.inputs.create(dto);
  }

  @FarmRoles(FARM_MANAGER, STOREKEEPER)
  @Put('mark')
  mark(@Body() dto: MarkFarmInputDto) {
    return this.inputs.mark(dto.productId, dto.kind ?? null);
  }

  @FarmRoles(FARM_MANAGER, STOREKEEPER)
  @Post(':productId/receive')
  receive(@Param('productId', ParseUUIDPipe) productId: string, @Body() dto: ReceiveFarmInputDto) {
    return this.inputs.receive(productId, dto);
  }
}
