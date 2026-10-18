import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RestaurantDishesService } from './restaurant-dishes.service';

export class SetDishStationDto {
  /** null (or left out) puts the dish back on the branch's first station. */
  @IsOptional()
  @IsUUID()
  stationId?: string | null;
}

@Controller('restaurant/dishes')
export class RestaurantDishesController {
  constructor(private readonly dishes: RestaurantDishesService) {}

  @Roles(Role.MANAGER, Role.OWNER)
  @Get()
  list() {
    return this.dishes.list();
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Put(':variantId/station')
  setStation(@Param('variantId', ParseUUIDPipe) variantId: string, @Body() dto: SetDishStationDto) {
    return this.dishes.setStation(variantId, dto.stationId ?? null);
  }
}
