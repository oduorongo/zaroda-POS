import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { KitchenStationsService } from './kitchen-stations.service';
import { CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/tab.dto';

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

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStationDto) {
    return this.stations.update(id, dto);
  }

  // Removes the station, or archives it when it has history (the answer says which).
  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.stations.remove(id);
  }

  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.stations.findAll({ branchId });
  }
}
