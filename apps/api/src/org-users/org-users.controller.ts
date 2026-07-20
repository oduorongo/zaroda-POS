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
import { OrgUsersService } from './org-users.service';
import { CreateOrgUserDto } from './dto/create-org-user.dto';
import { UpdateOrgUserDto } from './dto/update-org-user.dto';
import { SetPinDto } from './dto/set-pin.dto';

// JwtAuthGuard is global (see app.module.ts). findAll has no @Roles(),
// deliberately: a cashier switching PIN needs to see the same list a
// manager would. Everything that actually changes who has access
// (creating a membership, changing a role, resetting a PIN,
// deactivating/reactivating) is MANAGER/OWNER-only - the same tier as
// catalog management, not a cashier-floor operation.
@Controller('org-users')
export class OrgUsersController {
  constructor(private readonly orgUsers: OrgUsersService) {}

  @Get()
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.orgUsers.findAll({
      includeInactive: includeInactive === 'true',
    });
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post()
  create(@Body() dto: CreateOrgUserDto) {
    return this.orgUsers.create(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrgUserDto,
  ) {
    return this.orgUsers.updateRole(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch(':id/pin')
  setPin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPinDto) {
    return this.orgUsers.setPin(id, dto);
  }

  // Soft-delete, not a DELETE route - see OrgUsersService.setActive's
  // comment on why (an OrgUser is referenced by everything it ever did).
  @Roles(Role.MANAGER, Role.OWNER)
  @Patch(':id/deactivate')
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgUsers.deactivate(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch(':id/reactivate')
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgUsers.reactivate(id);
  }
}
