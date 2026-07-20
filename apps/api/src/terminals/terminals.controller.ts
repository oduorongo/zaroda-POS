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
import { TerminalsService } from './terminals.service';
import { CreateTerminalDto, UpdateTerminalDto } from './dto/terminal.dto';

// Same access tier as branches: reads open to any authenticated role
// (terminal setup needs to list them), creating/renaming is MANAGER/OWNER-
// only. No DELETE, same reasoning as branches - a terminal cascades onto
// its own shifts/sales/cashier sessions.
@Controller('terminals')
export class TerminalsController {
  constructor(private readonly terminals: TerminalsService) {}

  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.terminals.findAll({ branchId });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.terminals.findOne(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post()
  create(@Body() dto: CreateTerminalDto) {
    return this.terminals.create(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTerminalDto,
  ) {
    return this.terminals.update(id, dto);
  }
}
