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
import { RestaurantTablesService } from './restaurant-tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';

// JwtAuthGuard/RolesGuard are global. Reading the floor and updating a
// table's status (seating a walk-in, marking it needs cleaning) are
// routine register-floor operations open to any authenticated role -
// only adding/removing tables from the floor plan is restricted.
@Controller('restaurant/tables')
export class RestaurantTablesController {
  constructor(private readonly tables: RestaurantTablesService) {}

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post()
  create(@Body() dto: CreateTableDto) {
    return this.tables.create(dto);
  }

  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.tables.findAll({ branchId });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tables.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTableStatusDto,
  ) {
    return this.tables.updateStatus(id, dto);
  }
}
