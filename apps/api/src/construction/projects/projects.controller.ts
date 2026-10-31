import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Patch,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConPermitType, ConRoleCode } from '@prisma/client';
import { Request } from 'express';
import { ConFeature, ConProjectGuard, ConRequest, ConRoles, ConstructionGuard } from '../common/con-access';
import { BqItemDto, BqSectionDto, MemberDto, MilestoneDto, PartyDto, PermitDto, ProjectDto, ProjectPartyDto, ProjectStatusDto, TenderDto, TenderOutcomeDto } from '../dto/projects.dto';
import { BqService, MAX_BQ_BYTES } from './bq.service';
import { ProjectsService } from './projects.service';
import { TendersService } from './tenders.service';

const OFFICE: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_QS', 'CON_ACCOUNTANT', 'CON_PROCUREMENT', 'CON_COMPLIANCE', 'CON_SHE_OFFICER'];
const SITE: ConRoleCode[] = ['CON_PROJECT_MGR', 'CON_SITE_ENGINEER', 'CON_SITE_SUPERVISOR', 'CON_STOREKEEPER', 'CON_TIMEKEEPER'];
const ANYONE: ConRoleCode[] = [...OFFICE, ...SITE];
const TENDER_VIEW: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_QS', 'CON_COMPLIANCE', 'CON_ACCOUNTANT', 'CON_PROCUREMENT', 'CON_PROJECT_MGR'];
const TENDER_EDIT: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_QS', 'CON_COMPLIANCE'];
const PROJECT_EDIT: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_QS', 'CON_PROJECT_MGR'];
const BQ_VIEW: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_QS', 'CON_ACCOUNTANT', 'CON_PROCUREMENT', 'CON_PROJECT_MGR', 'CON_SITE_ENGINEER', 'CON_SITE_SUPERVISOR'];
const BQ_EDIT: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_QS'];
const PERMIT_EDIT: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_COMPLIANCE', 'CON_PROJECT_MGR'];
const TEAM_EDIT: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_PROJECT_MGR'];
const PARTY_EDIT: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_QS', 'CON_PROCUREMENT', 'CON_COMPLIANCE', 'CON_PROJECT_MGR'];

export async function readBody(req: Request, max: number, what: string) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > max) throw new PayloadTooLargeException(`${what} must be ${Math.round(max / 1024 / 1024)}MB or smaller`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export const mime = (h?: string) => (h ?? '').split(';')[0].trim().toLowerCase();
const fileNameOf = (h?: string) => (h ? decodeURIComponent(h) : undefined);

@Controller('construction')
@UseGuards(ConstructionGuard)
export class TendersController {
  constructor(private readonly tenders: TendersService) {}

  @ConFeature('tenders')
  @ConRoles(...TENDER_VIEW)
  @Get('tenders')
  list() {
    return this.tenders.list();
  }

  @ConFeature('tenders')
  @ConRoles(...TENDER_EDIT)
  @Post('tenders')
  create(@Req() req: ConRequest, @Body() dto: TenderDto) {
    return this.tenders.save(req.con!, dto);
  }

  @ConFeature('tenders')
  @ConRoles(...TENDER_EDIT)
  @Put('tenders/:id')
  update(@Req() req: ConRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TenderDto) {
    return this.tenders.save(req.con!, dto, id);
  }

  @ConFeature('tenders')
  @ConRoles(...TENDER_EDIT)
  @Post('tenders/:id/outcome')
  @HttpCode(200)
  outcome(@Req() req: ConRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TenderOutcomeDto) {
    return this.tenders.outcome(req.con!, id, dto);
  }
}

@Controller('construction')
@UseGuards(ConstructionGuard, ConProjectGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly bq: BqService,
  ) {}

  // ── Parties ──

  @ConRoles(...ANYONE)
  @Get('parties')
  parties() {
    return this.projects.listParties();
  }

  @ConRoles(...PARTY_EDIT)
  @Post('parties')
  addParty(@Body() dto: PartyDto) {
    return this.projects.saveParty(dto);
  }

  @ConRoles(...PARTY_EDIT)
  @Put('parties/:id')
  updateParty(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PartyDto) {
    return this.projects.saveParty(dto, id);
  }

  // ── Projects ──

  @ConFeature('projects')
  @ConRoles(...ANYONE)
  @Get('projects')
  list(@Req() req: ConRequest) {
    return this.projects.list(req.con!);
  }

  @ConFeature('projects')
  @ConRoles('CON_CONTRACTS_MGR', 'CON_QS')
  @Post('projects')
  create(@Req() req: ConRequest, @Body() dto: ProjectDto) {
    return this.projects.create(req.con!, dto);
  }

  @ConFeature('projects')
  @ConRoles(...ANYONE)
  @Get('projects/:projectId')
  get(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.projects.get(projectId);
  }

  @ConFeature('projects')
  @ConRoles(...PROJECT_EDIT)
  @Put('projects/:projectId')
  update(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: ProjectDto) {
    return this.projects.update(req.con!, projectId, dto);
  }

  @ConFeature('projects')
  @ConRoles('CON_CONTRACTS_MGR', 'CON_PROJECT_MGR')
  @Post('projects/:projectId/status')
  @HttpCode(200)
  status(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: ProjectStatusDto) {
    return this.projects.setStatus(req.con!, projectId, dto);
  }

  @ConRoles(...PROJECT_EDIT)
  @Post('projects/:projectId/parties')
  linkParty(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: ProjectPartyDto) {
    return this.projects.linkParty(projectId, dto);
  }

  @ConRoles(...PROJECT_EDIT)
  @Delete('projects/:projectId/parties/:linkId')
  unlinkParty(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('linkId', ParseUUIDPipe) linkId: string) {
    return this.projects.unlinkParty(projectId, linkId);
  }

  @ConRoles(...TEAM_EDIT)
  @Post('projects/:projectId/members')
  addMember(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: MemberDto) {
    return this.projects.addMember(projectId, dto);
  }

  @ConRoles(...TEAM_EDIT)
  @Delete('projects/:projectId/members/:memberId')
  removeMember(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.projects.removeMember(projectId, memberId);
  }

  // ── Permits ──

  @ConRoles(...PERMIT_EDIT)
  @Put('projects/:projectId/permits/:type')
  permit(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('type', new ParseEnumPipe(ConPermitType)) type: ConPermitType, @Body() dto: PermitDto) {
    return this.projects.updatePermit(projectId, type, dto);
  }

  @ConRoles(...PERMIT_EDIT)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('projects/:projectId/permits/:type/file')
  async permitUpload(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('type', new ParseEnumPipe(ConPermitType)) type: ConPermitType,
    @Headers('content-type') contentType: string | undefined,
    @Headers('x-file-name') fileName: string | undefined,
    @Req() req: Request,
  ) {
    return this.projects.uploadPermitFile(projectId, type, mime(contentType), await readBody(req, 10 * 1024 * 1024, 'Documents'), fileNameOf(fileName));
  }

  @ConRoles(...ANYONE)
  @Get('projects/:projectId/permits/:type/file')
  async permitFile(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('type', new ParseEnumPipe(ConPermitType)) type: ConPermitType) {
    const f = await this.projects.permitFile(projectId, type);
    return new StreamableFile(f.stream, { type: f.contentType, disposition: `inline; filename="${f.fileName.replace(/[^\w.\- ]/g, '_')}"` });
  }

  // ── Programme ──

  @ConRoles(...TEAM_EDIT)
  @Post('projects/:projectId/milestones')
  addMilestone(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: MilestoneDto) {
    return this.projects.saveMilestone(projectId, dto);
  }

  @ConRoles(...TEAM_EDIT)
  @Put('projects/:projectId/milestones/:id')
  updateMilestone(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MilestoneDto) {
    return this.projects.saveMilestone(projectId, dto, id);
  }

  @ConRoles(...TEAM_EDIT)
  @Delete('projects/:projectId/milestones/:id')
  removeMilestone(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.removeMilestone(projectId, id);
  }

  // ── BQ ──

  @ConRoles(...BQ_VIEW)
  @Get('projects/:projectId/bq')
  getBq(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.bq.get(projectId);
  }

  /** The .xlsx or .csv is the raw body. ?save=true replaces the BQ; without it nothing is saved and the preview comes back. */
  @ConRoles(...BQ_EDIT)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('projects/:projectId/bq/import')
  @HttpCode(200)
  async importBq(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('save') save: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Headers('x-file-name') fileName: string | undefined,
    @Req() req: Request,
  ) {
    return this.bq.import(projectId, mime(contentType), fileNameOf(fileName), await readBody(req, MAX_BQ_BYTES, 'BQ files'), save === 'true');
  }

  @ConRoles(...BQ_EDIT)
  @Post('projects/:projectId/bq/sections')
  addSection(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: BqSectionDto) {
    return this.bq.saveSection(projectId, dto);
  }

  @ConRoles(...BQ_EDIT)
  @Patch('projects/:projectId/bq/sections/:id')
  updateSection(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BqSectionDto) {
    return this.bq.saveSection(projectId, dto, id);
  }

  @ConRoles(...BQ_EDIT)
  @Delete('projects/:projectId/bq/sections/:id')
  removeSection(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.bq.removeSection(projectId, id);
  }

  @ConRoles(...BQ_EDIT)
  @Post('projects/:projectId/bq/items')
  addItem(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: BqItemDto) {
    return this.bq.saveItem(projectId, dto);
  }

  @ConRoles(...BQ_EDIT)
  @Put('projects/:projectId/bq/items/:id')
  updateItem(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BqItemDto) {
    return this.bq.saveItem(projectId, dto, id);
  }

  @ConRoles(...BQ_EDIT)
  @Delete('projects/:projectId/bq/items/:id')
  removeItem(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.bq.removeItem(projectId, id);
  }
}
