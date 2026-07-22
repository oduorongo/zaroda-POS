import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RosterService } from './roster.service';
import { CreateRosterShiftDto } from './dto/create-roster-shift.dto';
import { UpdateRosterShiftDto } from './dto/update-roster-shift.dto';
import { ListRosterShiftsDto } from './dto/list-roster-shifts.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts). Building
// the roster is a supervisory task; any authenticated staff member can
// still read it (no @Roles on the GET) to see their own published shifts.
@Controller('roster')
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  @Get()
  findAll(@Query() query: ListRosterShiftsDto) {
    return this.roster.findAll(query);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post()
  create(@Body() dto: CreateRosterShiftDto) {
    return this.roster.create(dto);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRosterShiftDto) {
    return this.roster.update(id, dto);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Patch(':id/publish')
  publish(@Param('id') id: string) {
    return this.roster.setPublished(id, true);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Patch(':id/unpublish')
  unpublish(@Param('id') id: string) {
    return this.roster.setPublished(id, false);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.roster.remove(id);
  }
}
