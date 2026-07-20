import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { KitchenStationsService } from './kitchen-stations.service';
import { CreateStationDto } from './dto/create-station.dto';

@Controller('restaurant/stations')
export class KitchenStationsController {
  constructor(private readonly stations: KitchenStationsService) {}

  // Adding/removing prep areas is a floor-plan-level change, same tier as
  // creating a table.
  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post()
  create(@Body() dto: CreateStationDto) {
    return this.stations.create(dto);
  }

  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.stations.findAll({ branchId });
  }
}
