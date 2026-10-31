import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, StreamableFile, UseGuards, Delete } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConRoleCode } from '@prisma/client';
import { Request } from 'express';
import { ConFeature, ConProjectGuard, ConRequest, ConRoles, ConstructionGuard } from '../common/con-access';
import { DiaryDto, DoshsReportDto, IncidentDto, InstructionDto, InstructionStatusDto, MusterDto, PpeIssueDto, ToolboxTalkDto, WorkPermitDto, WorkerDto } from '../dto/site.dto';
import { mime, readBody } from '../projects/projects.controller';
import { LabourService } from './labour.service';
import { SafetyService } from './safety.service';
import { SiteService } from './site.service';
import { MAX_PHOTO_BYTES } from './site.util';

const PM: ConRoleCode = 'CON_PROJECT_MGR';
const ENG: ConRoleCode = 'CON_SITE_ENGINEER';
const SUP: ConRoleCode = 'CON_SITE_SUPERVISOR';
const TIME: ConRoleCode = 'CON_TIMEKEEPER';
const DIARY_VIEW: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_QS', 'CON_SHE_OFFICER', PM, ENG, SUP];
const DIARY_EDIT: ConRoleCode[] = [PM, ENG, SUP];
const INSTRUCTION_EDIT: ConRoleCode[] = [PM, ENG, 'CON_QS'];
const LABOUR_VIEW: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_ACCOUNTANT', 'CON_COMPLIANCE', 'CON_SHE_OFFICER', PM, ENG, SUP, TIME];
const LABOUR_EDIT: ConRoleCode[] = [PM, SUP, TIME];
const SAFETY_VIEW: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_COMPLIANCE', 'CON_SHE_OFFICER', PM, ENG, SUP];
const SAFETY_EDIT: ConRoleCode[] = ['CON_SHE_OFFICER', ENG, SUP];

@Controller('construction')
@UseGuards(ConstructionGuard, ConProjectGuard)
export class SiteController {
  constructor(
    private readonly site: SiteService,
    private readonly labour: LabourService,
    private readonly safety: SafetyService,
  ) {}

  // ── Site diary ──

  @ConFeature('projects')
  @ConRoles(...DIARY_VIEW)
  @Get('projects/:projectId/diaries')
  diaries(@Param('projectId', ParseUUIDPipe) projectId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.site.listDiaries(projectId, from, to);
  }

  @ConFeature('projects')
  @ConRoles(...DIARY_VIEW)
  @Get('projects/:projectId/diaries/:date')
  diary(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('date') date: string) {
    return this.site.getDiary(projectId, date);
  }

  @ConFeature('projects')
  @ConRoles(...DIARY_EDIT)
  @Put('projects/:projectId/diaries/:date')
  saveDiary(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('date') date: string, @Body() dto: DiaryDto) {
    return this.site.saveDiary(req.con!, projectId, date, dto);
  }

  @ConFeature('projects')
  @ConRoles(...DIARY_EDIT)
  @Post('projects/:projectId/diaries/:date/submit')
  @HttpCode(200)
  submitDiary(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('date') date: string) {
    return this.site.setDiaryStatus(req.con!, projectId, date, 'submit');
  }

  @ConFeature('projects')
  @ConRoles(PM)
  @Post('projects/:projectId/diaries/:date/approve')
  @HttpCode(200)
  approveDiary(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('date') date: string) {
    return this.site.setDiaryStatus(req.con!, projectId, date, 'approve');
  }

  // ── Photos (raw image body; ?lat=&lng=&caption=&takenAt=) ──

  @ConFeature('projects')
  @ConRoles(...DIARY_EDIT)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('projects/:projectId/photos')
  async uploadPhoto(
    @Req() req: Request & ConRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Headers('content-type') contentType: string | undefined,
    @Query() q: { caption?: string; lat?: string; lng?: string; takenAt?: string },
  ) {
    return this.site.uploadPhoto(req.con!, projectId, mime(contentType), await readBody(req, MAX_PHOTO_BYTES, 'Photos'), q);
  }

  @ConFeature('projects')
  @ConRoles(...DIARY_VIEW)
  @Get('projects/:projectId/photos')
  photos(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.site.listPhotos(projectId);
  }

  @ConFeature('projects')
  @ConRoles(...DIARY_VIEW)
  @Get('projects/:projectId/photos/:id/file')
  async photo(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    const f = await this.site.photoFile(projectId, id);
    return new StreamableFile(f.stream, { type: f.contentType, disposition: 'inline' });
  }

  @ConFeature('projects')
  @ConRoles(...DIARY_EDIT)
  @Delete('projects/:projectId/photos/:id')
  removePhoto(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.site.removePhoto(req.con!, projectId, id);
  }

  // ── Site instructions ──

  @ConFeature('projects')
  @ConRoles(...DIARY_VIEW)
  @Get('projects/:projectId/instructions')
  instructions(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.site.listInstructions(projectId);
  }

  @ConFeature('projects')
  @ConRoles(...INSTRUCTION_EDIT)
  @Post('projects/:projectId/instructions')
  addInstruction(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: InstructionDto) {
    return this.site.addInstruction(req.con!, projectId, dto);
  }

  @ConFeature('projects')
  @ConRoles(...INSTRUCTION_EDIT)
  @Patch('projects/:projectId/instructions/:id')
  instructionStatus(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InstructionStatusDto) {
    return this.site.setInstructionStatus(projectId, id, dto.status);
  }

  // ── Workers ──

  @ConFeature('labour')
  @ConRoles(...LABOUR_VIEW)
  @Get('workers')
  workers(@Req() req: ConRequest, @Query('projectId') projectId?: string) {
    return this.labour.list(req.con!, projectId);
  }

  @ConFeature('labour')
  @ConRoles(...LABOUR_VIEW)
  @Get('workers/:id')
  worker(@Req() req: ConRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.labour.get(req.con!, id);
  }

  @ConFeature('labour')
  @ConRoles(...LABOUR_EDIT)
  @Post('workers')
  addWorker(@Req() req: ConRequest, @Body() dto: WorkerDto) {
    return this.labour.create(req.con!, dto);
  }

  @ConFeature('labour')
  @ConRoles(...LABOUR_EDIT)
  @Put('workers/:id')
  updateWorker(@Req() req: ConRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WorkerDto) {
    return this.labour.update(req.con!, id, dto);
  }

  // ── Muster roll ──

  @ConFeature('labour')
  @ConRoles(...LABOUR_VIEW)
  @Get('projects/:projectId/muster')
  musterDay(@Param('projectId', ParseUUIDPipe) projectId: string, @Query('date') date: string) {
    return this.labour.musterDay(projectId, /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10));
  }

  @ConFeature('labour')
  @ConRoles(...LABOUR_EDIT)
  @Post('projects/:projectId/muster')
  @HttpCode(200)
  saveMuster(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: MusterDto) {
    return this.labour.saveMuster(req.con!, projectId, dto);
  }

  @ConFeature('labour')
  @ConRoles(...LABOUR_VIEW)
  @Get('projects/:projectId/muster/summary')
  musterSummary(@Param('projectId', ParseUUIDPipe) projectId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.labour.musterSummary(projectId, from, to);
  }

  // ── Safety ──

  @ConFeature('safety')
  @ConRoles(...SAFETY_VIEW)
  @Get('projects/:projectId/safety')
  registers(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.safety.registers(projectId);
  }

  @ConFeature('safety')
  @ConRoles(...SAFETY_EDIT)
  @Post('projects/:projectId/toolbox-talks')
  talk(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: ToolboxTalkDto) {
    return this.safety.addTalk(req.con!, projectId, dto);
  }

  @ConFeature('safety')
  @ConRoles(...SAFETY_EDIT)
  @Post('projects/:projectId/ppe')
  ppe(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: PpeIssueDto) {
    return this.safety.issuePpe(req.con!, projectId, dto);
  }

  @ConFeature('safety')
  @ConRoles(...SAFETY_EDIT)
  @Post('projects/:projectId/work-permits')
  permit(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: WorkPermitDto) {
    return this.safety.addPermit(req.con!, projectId, dto);
  }

  @ConFeature('safety')
  @ConRoles(...SAFETY_EDIT)
  @Post('projects/:projectId/work-permits/:id/close')
  @HttpCode(200)
  closePermit(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Query('cancel') cancel?: string) {
    return this.safety.closePermit(req.con!, projectId, id, cancel === 'true');
  }

  @ConFeature('safety')
  @ConRoles(...SAFETY_EDIT)
  @Post('projects/:projectId/incidents')
  incident(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: IncidentDto) {
    return this.safety.addIncident(req.con!, projectId, dto);
  }

  @ConFeature('safety')
  @ConRoles('CON_SHE_OFFICER', PM)
  @Post('projects/:projectId/incidents/:id/doshs')
  @HttpCode(200)
  doshs(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DoshsReportDto) {
    return this.safety.reportDoshs(projectId, id, dto);
  }
}
