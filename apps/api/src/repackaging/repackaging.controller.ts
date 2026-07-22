import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RepackagingService } from './repackaging.service';
import { CreateRepackagingDto } from './dto/create-repackaging.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts).
@Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
@Controller('repackaging')
export class RepackagingController {
  constructor(private readonly repackaging: RepackagingService) {}

  @Post()
  create(@Body() dto: CreateRepackagingDto) {
    return this.repackaging.create(dto);
  }

  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.repackaging.findAll({ branchId });
  }
}
