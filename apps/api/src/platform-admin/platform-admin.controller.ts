import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PlatformAdminAuthGuard } from './platform-admin-auth.guard';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { PlatformAdminLoginDto } from './dto/platform-admin-login.dto';

// Same throttle shape as tenant login (auth.controller.ts) - this is the
// one public, pre-JWT endpoint on this controller.
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

interface PlatformAdminRequest extends Request {
  user?: { platformAdminId: string };
}

// Every route below @Public() + @UseGuards(PlatformAdminAuthGuard)
// explicitly, rather than relying on the app-wide JwtAuthGuard/RolesGuard
// (see PlatformAdminAuthGuard's own comment) - those two guards assume
// the tenant JWT payload shape (organizationId/role) and have no concept
// of a platform admin at all.
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly auth: PlatformAdminAuthService,
    private readonly platformAdmin: PlatformAdminService,
    private readonly auditLog: PlatformAuditLogService,
  ) {}

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('auth/login')
  login(@Body() dto: PlatformAdminLoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('organizations')
  async listOrganizations(@Req() req: PlatformAdminRequest) {
    const result = await this.platformAdmin.listOrganizations();
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.listed_organizations',
      entityType: 'Organization',
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('organizations/:id')
  async getOrganization(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.platformAdmin.getOrganization(id);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.viewed_organization',
      entityType: 'Organization',
      entityId: id,
      organizationId: id,
    });
    return result;
  }
}
