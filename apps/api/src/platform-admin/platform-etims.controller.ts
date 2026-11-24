import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { EtimsEnvironment } from '@prisma/client';
import { Request } from 'express';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { EtimsPlatformService } from '../etims/etims-platform.service';
import { PlatformAdminAuthGuard } from './platform-admin-auth.guard';
import { PlatformAuditLogService } from './platform-audit-log.service';

interface PlatformAdminRequest extends Request {
  user?: { platformAdminId: string };
}

export class SaveEtimsGatewayDto {
  @IsString()
  @MinLength(4)
  @MaxLength(200)
  consumerKey!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(200)
  consumerSecret!: string;
}

const Env = new ParseEnumPipe(EtimsEnvironment);

/** KRA eTIMS for the platform admin: ZARODA's GavaConnect keys, the test button, and each business's connection and live approval. */
@Controller('platform-admin/etims')
@Public()
@UseGuards(PlatformAdminAuthGuard)
export class PlatformEtimsController {
  constructor(
    private readonly etims: EtimsPlatformService,
    private readonly auditLog: PlatformAuditLogService,
  ) {}

  @Get('gateways')
  gateways() {
    return this.etims.gateways();
  }

  @Put('gateways/:environment')
  async save(@Req() req: PlatformAdminRequest, @Param('environment', Env) environment: EtimsEnvironment, @Body() dto: SaveEtimsGatewayDto) {
    const adminId = req.user!.platformAdminId;
    const result = await this.etims.saveGateway(environment, dto.consumerKey, dto.consumerSecret, adminId);
    await this.auditLog.log({ platformAdminId: adminId, action: 'platform_admin.etims_keys_saved', entityType: 'EtimsGateway', entityId: environment });
    return result;
  }

  @Delete('gateways/:environment')
  async clear(@Req() req: PlatformAdminRequest, @Param('environment', Env) environment: EtimsEnvironment) {
    const adminId = req.user!.platformAdminId;
    const result = await this.etims.clearGateway(environment, adminId);
    await this.auditLog.log({ platformAdminId: adminId, action: 'platform_admin.etims_keys_cleared', entityType: 'EtimsGateway', entityId: environment });
    return result;
  }

  @Post('gateways/:environment/test')
  @HttpCode(200)
  test(@Param('environment', Env) environment: EtimsEnvironment) {
    return this.etims.test(environment);
  }

  @Get('businesses')
  businesses() {
    return this.etims.businesses();
  }

  @Post('businesses/:id/live')
  @HttpCode(200)
  async approve(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    const adminId = req.user!.platformAdminId;
    const result = await this.etims.setLive(id, true, adminId);
    await this.auditLog.log({ platformAdminId: adminId, action: 'platform_admin.etims_live_approved', entityType: 'EtimsSetting', entityId: id, organizationId: id });
    return result;
  }

  @Delete('businesses/:id/live')
  async withdraw(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    const adminId = req.user!.platformAdminId;
    const result = await this.etims.setLive(id, false, adminId);
    await this.auditLog.log({ platformAdminId: adminId, action: 'platform_admin.etims_live_withdrawn', entityType: 'EtimsSetting', entityId: id, organizationId: id });
    return result;
  }
}
