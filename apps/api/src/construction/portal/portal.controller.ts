import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/public.decorator';
import { ConFeature, ConRequest, ConRoles, ConstructionGuard } from '../common/con-access';
import { PortalCertifyDto, PortalCodeRequestDto, PortalCodeVerifyDto, PortalDecisionDto, PortalInstructionDto, PortalSubValuationDto, PortalUserDto, PortalUserUpdateDto } from '../dto/payroll-portal.dto';
import { ConPortalGuard, PortalRequest } from './portal-access';
import { PortalAuthService } from './portal-auth.service';
import { PortalService } from './portal.service';

@Controller('construction-portal/auth')
export class PortalAuthController {
  constructor(private readonly auth: PortalAuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('request-code')
  @HttpCode(200)
  requestCode(@Body() dto: PortalCodeRequestDto) {
    return this.auth.requestCode(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: PortalCodeVerifyDto) {
    return this.auth.verifyCode(dto.email, dto.code);
  }
}

@Controller('construction-portal')
@UseGuards(ConPortalGuard)
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Public()
  @Get('me')
  me(@Req() req: PortalRequest) {
    return this.portal.me(req.portal!);
  }

  @Public()
  @Get('projects/:projectId')
  project(@Req() req: PortalRequest, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.portal.project(req.portal!, projectId);
  }

  @Public()
  @Get('projects/:projectId/photos')
  photos(@Req() req: PortalRequest, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.portal.photos(req.portal!, projectId);
  }

  @Public()
  @Get('projects/:projectId/photos/:id/file')
  async photoFile(@Req() req: PortalRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    const f = await this.portal.photoFile(req.portal!, projectId, id);
    return new StreamableFile(f.stream, { type: f.contentType, disposition: 'inline' });
  }

  @Public()
  @Get('projects/:projectId/valuations')
  valuations(@Req() req: PortalRequest, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.portal.valuations(req.portal!, projectId);
  }

  @Public()
  @Get('projects/:projectId/valuations/:id')
  valuation(@Req() req: PortalRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.valuation(req.portal!, projectId, id);
  }

  @Public()
  @Post('projects/:projectId/valuations/:id/certify')
  @HttpCode(200)
  certify(@Req() req: PortalRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PortalCertifyDto) {
    return this.portal.certify(req.portal!, projectId, id, dto);
  }

  @Public()
  @Get('projects/:projectId/variations')
  variations(@Req() req: PortalRequest, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.portal.variations(req.portal!, projectId);
  }

  @Public()
  @Post('projects/:projectId/variations/:id/decision')
  @HttpCode(200)
  decide(@Req() req: PortalRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PortalDecisionDto) {
    return this.portal.decideVariation(req.portal!, projectId, id, dto);
  }

  @Public()
  @Get('projects/:projectId/instructions')
  instructions(@Req() req: PortalRequest, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.portal.instructions(req.portal!, projectId);
  }

  @Public()
  @Post('projects/:projectId/instructions')
  addInstruction(@Req() req: PortalRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: PortalInstructionDto) {
    return this.portal.addInstruction(req.portal!, projectId, dto);
  }

  @Public()
  @Get('projects/:projectId/subcontracts')
  subcontracts(@Req() req: PortalRequest, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.portal.subcontracts(req.portal!, projectId);
  }

  @Public()
  @Post('projects/:projectId/subcontracts/:id/valuations')
  addSubValuation(@Req() req: PortalRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PortalSubValuationDto) {
    return this.portal.addSubValuation(req.portal!, projectId, id, dto);
  }
}

const MANAGE = ['CON_CONTRACTS_MGR', 'CON_PROJECT_MGR'] as const;

/** The builder's staff give and take away portal access. Portal users are free: they never count toward the plan's users. */
@Controller('construction/portal-users')
@UseGuards(ConstructionGuard)
export class PortalUsersController {
  constructor(private readonly portal: PortalService) {}

  @ConFeature('portal')
  @ConRoles(...MANAGE)
  @Get()
  list(@Req() req: ConRequest) {
    return this.portal.listUsers(req.con!);
  }

  @ConFeature('portal')
  @ConRoles(...MANAGE)
  @Post()
  invite(@Req() req: ConRequest, @Body() dto: PortalUserDto) {
    return this.portal.invite(req.con!, dto);
  }

  @ConFeature('portal')
  @ConRoles(...MANAGE)
  @Put(':id')
  update(@Req() req: ConRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PortalUserUpdateDto) {
    return this.portal.updateUser(req.con!, id, dto);
  }
}
