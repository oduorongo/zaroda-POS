import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { SalonResourcesService } from './salon-resources.service';
import { CreateResourceDto } from './dto/create-resource.dto';

@Controller('salon/resources')
export class SalonResourcesController {
  constructor(private readonly resources: SalonResourcesService) {}

  // Adding/removing bookable resources is a floor-plan-level change, same
  // tier as the restaurant module's tables/stations.
  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post()
  create(@Body() dto: CreateResourceDto) {
    return this.resources.create(dto);
  }

  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.resources.findAll({ branchId });
  }
}
