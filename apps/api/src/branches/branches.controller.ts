import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

// JwtAuthGuard/RolesGuard are both global. Reads: any authenticated role -
// terminal setup and every backoffice screen with a branch filter need this
// list. Only creating/renaming a branch is MANAGER/OWNER-only, same tier as
// catalog management. No DELETE: Branch cascades onto everything it owns
// (sales, inventory, shifts...) via the schema's onDelete: Cascade - a
// mistaken delete would be catastrophic and unrecoverable, so this pilot
// doesn't expose one at all rather than build a "are you sure" flow around
// something this destructive.
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  findAll() {
    return this.branches.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.findOne(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post()
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(id, dto);
  }
}
