import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConRoleCode } from '@prisma/client';
import { Request } from 'express';
import { ConFeature, ConProjectGuard, ConRoles, ConstructionGuard } from '../common/con-access';
import { ClientItemDto, ClientMoveDto, CrossingDto, LineAssetDto, ProgressDto, SectionDto, StaffLicenceDto, WayleaveDto } from '../dto/lines.dto';
import { fileNameOf, mime, readBody } from '../projects/projects.controller';
import { LinesService } from './lines.service';

// docs/construction/07 s5: who may view and change each part of a power-line job.
const LINE_VIEW: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_PROJECT_MGR', 'CON_QS', 'CON_COMPLIANCE', 'CON_SHE_OFFICER', 'CON_SITE_ENGINEER', 'CON_SITE_SUPERVISOR'];
const SITE_EDIT: ConRoleCode[] = ['CON_PROJECT_MGR', 'CON_SITE_ENGINEER', 'CON_SITE_SUPERVISOR'];
const LAND_VIEW: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_PROJECT_MGR', 'CON_QS', 'CON_COMPLIANCE', 'CON_SITE_ENGINEER', 'CON_SITE_SUPERVISOR'];
const LAND_EDIT: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_PROJECT_MGR', 'CON_COMPLIANCE'];
const MAT_VIEW: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_PROJECT_MGR', 'CON_QS', 'CON_ACCOUNTANT', 'CON_PROCUREMENT', 'CON_SITE_ENGINEER', 'CON_SITE_SUPERVISOR', 'CON_STOREKEEPER'];
const MAT_EDIT: ConRoleCode[] = ['CON_PROJECT_MGR', 'CON_SITE_SUPERVISOR', 'CON_STOREKEEPER'];
const UPLOAD = { default: { limit: 20, ttl: 60_000 } };

/** Power-line work on a project: sections and progress, wayleaves, crossings, as-built assets, client-supplied materials. */
@Controller('construction')
@UseGuards(ConstructionGuard, ConProjectGuard)
export class LinesController {
  constructor(private readonly lines: LinesService) {}

  @ConFeature('projects')
  @ConRoles(...LINE_VIEW)
  @Get('projects/:projectId/power-line')
  overview(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.lines.overview(projectId);
  }

  @ConFeature('projects')
  @ConRoles(...SITE_EDIT)
  @Post('projects/:projectId/sections')
  addSection(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: SectionDto) {
    return this.lines.saveSection(projectId, dto);
  }

  @ConFeature('projects')
  @ConRoles(...SITE_EDIT)
  @Put('projects/:projectId/sections/:id')
  updateSection(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SectionDto) {
    return this.lines.saveSection(projectId, dto, id);
  }

  @ConFeature('projects')
  @ConRoles(...SITE_EDIT)
  @Put('projects/:projectId/sections/:sectionId/progress/:date')
  progress(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('sectionId', ParseUUIDPipe) sectionId: string, @Param('date') onDate: string, @Body() dto: ProgressDto) {
    return this.lines.saveProgress(projectId, sectionId, /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : 'invalid', dto);
  }

  @ConFeature('projects')
  @ConRoles(...LAND_EDIT)
  @Post('projects/:projectId/wayleaves')
  addWayleave(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: WayleaveDto) {
    return this.lines.saveWayleave(projectId, dto);
  }

  @ConFeature('projects')
  @ConRoles(...LAND_EDIT)
  @Put('projects/:projectId/wayleaves/:id')
  updateWayleave(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WayleaveDto) {
    return this.lines.saveWayleave(projectId, dto, id);
  }

  @ConFeature('projects')
  @ConRoles(...LAND_EDIT)
  @Throttle(UPLOAD)
  @Post('projects/:projectId/wayleaves/:id/file')
  async wayleaveUpload(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Headers('content-type') contentType: string | undefined, @Headers('x-file-name') fileName: string | undefined, @Req() req: Request) {
    return this.lines.uploadFile(projectId, 'wayleaves', id, mime(contentType), await readBody(req, 10 * 1024 * 1024, 'Documents'), fileNameOf(fileName));
  }

  @ConFeature('projects')
  @ConRoles(...LAND_VIEW)
  @Get('projects/:projectId/wayleaves/:id/file')
  async wayleaveFile(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    const f = await this.lines.file(projectId, 'wayleaves', id);
    return new StreamableFile(f.stream, { type: f.contentType, disposition: `inline; filename="${f.fileName.replace(/[^\w.\- ]/g, '_')}"` });
  }

  @ConFeature('projects')
  @ConRoles(...LAND_EDIT)
  @Post('projects/:projectId/crossings')
  addCrossing(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: CrossingDto) {
    return this.lines.saveCrossing(projectId, dto);
  }

  @ConFeature('projects')
  @ConRoles(...LAND_EDIT)
  @Put('projects/:projectId/crossings/:id')
  updateCrossing(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CrossingDto) {
    return this.lines.saveCrossing(projectId, dto, id);
  }

  @ConFeature('projects')
  @ConRoles(...LAND_EDIT)
  @Throttle(UPLOAD)
  @Post('projects/:projectId/crossings/:id/file')
  async crossingUpload(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Headers('content-type') contentType: string | undefined, @Headers('x-file-name') fileName: string | undefined, @Req() req: Request) {
    return this.lines.uploadFile(projectId, 'crossings', id, mime(contentType), await readBody(req, 10 * 1024 * 1024, 'Documents'), fileNameOf(fileName));
  }

  @ConFeature('projects')
  @ConRoles(...LAND_VIEW)
  @Get('projects/:projectId/crossings/:id/file')
  async crossingFile(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    const f = await this.lines.file(projectId, 'crossings', id);
    return new StreamableFile(f.stream, { type: f.contentType, disposition: `inline; filename="${f.fileName.replace(/[^\w.\- ]/g, '_')}"` });
  }

  @ConFeature('projects')
  @ConRoles(...SITE_EDIT)
  @Post('projects/:projectId/line-assets')
  addAsset(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: LineAssetDto) {
    return this.lines.saveAsset(projectId, dto);
  }

  @ConFeature('projects')
  @ConRoles(...SITE_EDIT)
  @Put('projects/:projectId/line-assets/:id')
  updateAsset(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LineAssetDto) {
    return this.lines.saveAsset(projectId, dto, id);
  }

  @ConFeature('projects')
  @ConRoles(...SITE_EDIT)
  @Delete('projects/:projectId/line-assets/:id')
  removeAsset(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.lines.removeAsset(projectId, id);
  }

  @ConFeature('procurement')
  @ConRoles(...MAT_VIEW)
  @Get('projects/:projectId/client-materials')
  clientMaterials(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.lines.clientMaterials(projectId);
  }

  @ConFeature('procurement')
  @ConRoles(...MAT_EDIT)
  @Post('projects/:projectId/client-materials/items')
  addClientItem(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: ClientItemDto) {
    return this.lines.addClientItem(projectId, dto);
  }

  @ConFeature('procurement')
  @ConRoles(...MAT_EDIT)
  @Post('projects/:projectId/client-materials/moves')
  addClientMove(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: ClientMoveDto) {
    return this.lines.addClientMove(projectId, dto);
  }

  @ConFeature('procurement')
  @ConRoles(...MAT_EDIT)
  @Delete('projects/:projectId/client-materials/moves/:id')
  removeClientMove(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.lines.removeClientMove(projectId, id);
  }
}

/** Electricians' licences (EPRA), kept by Compliance like staff NCA cards. */
@Controller('construction')
@UseGuards(ConstructionGuard)
export class StaffLicencesController {
  constructor(private readonly lines: LinesService) {}

  @ConRoles('CON_DIRECTOR', 'CON_COMPLIANCE')
  @Get('staff-licences')
  list() {
    return this.lines.listStaffLicences();
  }

  @ConRoles('CON_COMPLIANCE')
  @Post('staff-licences')
  add(@Body() dto: StaffLicenceDto) {
    return this.lines.saveStaffLicence(dto);
  }

  @ConRoles('CON_COMPLIANCE')
  @Put('staff-licences/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StaffLicenceDto) {
    return this.lines.saveStaffLicence(dto, id);
  }

  @ConRoles('CON_COMPLIANCE')
  @Delete('staff-licences/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.lines.removeStaffLicence(id);
  }
}
