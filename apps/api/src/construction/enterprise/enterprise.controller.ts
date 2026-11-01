import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Public } from '../../auth/public.decorator';
import { tenantContext } from '../../common/tenant/tenant-context';
import { ConFeature, ConProjectGuard, ConRoles, ConstructionGuard } from '../common/con-access';
import { CommercialService } from '../commercial/commercial.service';
import { ApiKeyDto, AssignCustomRolesDto, AssignOfficeDto, CustomRoleDto, OfficeDto } from '../dto/enterprise.dto';
import { ReportQueryDto } from '../dto/query.dto';
import { ProjectsService } from '../projects/projects.service';
import { ReportsService } from '../reports/reports.service';
import { ReportKey } from '../reports/reports.util';
import { ApiKeyRequest, ConApiKeyGuard } from './api-key.guard';
import { EnterpriseService } from './enterprise.service';

/** Enterprise settings - the Director's alone (always passes @ConRoles). */
@Controller('construction')
@UseGuards(ConstructionGuard, ConProjectGuard)
export class EnterpriseController {
  constructor(private readonly enterprise: EnterpriseService) {}

  @ConFeature('multi_branch')
  @ConRoles('CON_DIRECTOR')
  @Get('offices')
  offices() {
    return this.enterprise.offices();
  }

  @ConFeature('multi_branch')
  @ConRoles('CON_DIRECTOR')
  @Post('offices')
  addOffice(@Body() dto: OfficeDto) {
    return this.enterprise.saveOffice(dto);
  }

  @ConFeature('multi_branch')
  @ConRoles('CON_DIRECTOR')
  @Put('offices/:id')
  updateOffice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OfficeDto) {
    return this.enterprise.saveOffice(dto, id);
  }

  @ConFeature('multi_branch')
  @ConRoles('CON_DIRECTOR')
  @Delete('offices/:id')
  removeOffice(@Param('id', ParseUUIDPipe) id: string) {
    return this.enterprise.removeOffice(id);
  }

  @ConFeature('multi_branch')
  @ConRoles('CON_DIRECTOR')
  @Put('staff/:orgUserId/office')
  staffOffice(@Param('orgUserId', ParseUUIDPipe) orgUserId: string, @Body() dto: AssignOfficeDto) {
    return this.enterprise.setStaffOffice(orgUserId, dto);
  }

  @ConFeature('multi_branch')
  @ConRoles('CON_DIRECTOR')
  @Put('projects/:projectId/office')
  projectOffice(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: AssignOfficeDto) {
    return this.enterprise.setProjectOffice(projectId, dto);
  }

  @ConFeature('custom_roles')
  @ConRoles('CON_DIRECTOR')
  @Get('custom-roles')
  customRoles() {
    return this.enterprise.customRoles();
  }

  @ConFeature('custom_roles')
  @ConRoles('CON_DIRECTOR')
  @Post('custom-roles')
  addCustomRole(@Body() dto: CustomRoleDto) {
    return this.enterprise.saveCustomRole(dto);
  }

  @ConFeature('custom_roles')
  @ConRoles('CON_DIRECTOR')
  @Put('custom-roles/:id')
  updateCustomRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomRoleDto) {
    return this.enterprise.saveCustomRole(dto, id);
  }

  @ConFeature('custom_roles')
  @ConRoles('CON_DIRECTOR')
  @Delete('custom-roles/:id')
  removeCustomRole(@Param('id', ParseUUIDPipe) id: string) {
    return this.enterprise.removeCustomRole(id);
  }

  @ConFeature('custom_roles')
  @ConRoles('CON_DIRECTOR')
  @Put('staff/:orgUserId/custom-roles')
  staffCustomRoles(@Param('orgUserId', ParseUUIDPipe) orgUserId: string, @Body() dto: AssignCustomRolesDto) {
    return this.enterprise.setStaffCustomRoles(orgUserId, dto);
  }

  @ConFeature('api')
  @ConRoles('CON_DIRECTOR')
  @Get('api-keys')
  apiKeys() {
    return this.enterprise.apiKeys();
  }

  @ConFeature('api')
  @ConRoles('CON_DIRECTOR')
  @Post('api-keys')
  createApiKey(@Body() dto: ApiKeyDto) {
    return this.enterprise.createApiKey(dto);
  }

  @ConFeature('api')
  @ConRoles('CON_DIRECTOR')
  @Delete('api-keys/:id')
  revokeApiKey(@Param('id', ParseUUIDPipe) id: string) {
    return this.enterprise.revokeApiKey(id);
  }
}

/** The read-only Enterprise API, by key. 60 requests a minute. */
@Controller('construction-api/v1')
@Public()
@UseGuards(ConApiKeyGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class ConstructionApiController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly commercial: CommercialService,
    private readonly reports: ReportsService,
  ) {}

  private as<T>(req: ApiKeyRequest, scope: string, fn: () => Promise<T>): Promise<T> {
    const k = req.apiKey!;
    if (!k.scopes.includes(scope)) throw new ForbiddenException(`This key may not read ${scope}`);
    return tenantContext.run({ organizationId: k.organizationId, orgUserId: k.con.orgUserId, role: Role.AUDITOR }, fn);
  }

  @Get('projects')
  list(@Req() req: ApiKeyRequest) {
    return this.as(req, 'projects', () => this.projects.list(req.apiKey!.con));
  }

  @Get('projects/:projectId')
  get(@Req() req: ApiKeyRequest, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.as(req, 'projects', () => this.projects.get(req.apiKey!.con, projectId));
  }

  @Get('projects/:projectId/ipcs')
  ipcs(@Req() req: ApiKeyRequest, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.as(req, 'ipcs', async () => (await this.commercial.listValuations(projectId)).filter((v) => v.status === 'CERTIFIED' || v.status === 'PAID'));
  }

  @Get('reports/:key')
  report(@Req() req: ApiKeyRequest, @Param('key') key: string, @Query() q: ReportQueryDto) {
    if (q.format) throw new ForbiddenException('Download Excel or PDF from the app; the API returns the table as JSON');
    return this.as(req, 'reports', () => this.reports.run(req.apiKey!.con, key as ReportKey, q));
  }
}
