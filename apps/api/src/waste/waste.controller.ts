import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { WasteService } from './waste.service';
import { CreateWasteDto } from './dto/create-waste.dto';
import { ListWasteDto } from './dto/list-waste.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts). A
// stock-movement write, same tier as adjustments/repackaging.
@Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
@Controller('waste')
export class WasteController {
  constructor(private readonly waste: WasteService) {}

  @Post()
  create(@Body() dto: CreateWasteDto) {
    return this.waste.create(dto);
  }

  @Get()
  findAll(@Query() filters: ListWasteDto) {
    return this.waste.findAll(filters);
  }
}
