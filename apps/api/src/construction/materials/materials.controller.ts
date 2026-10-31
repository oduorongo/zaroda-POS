import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ConRoleCode } from '@prisma/client';
import { ConFeature, ConProjectGuard, ConRequest, ConRoles, ConstructionGuard } from '../common/con-access';
import { BudgetDto, GrnDto, IssueDto, LpoDto, PlantDto, PlantLogDto, ReasonDto, RequisitionDto } from '../dto/materials.dto';
import { MaterialsService } from './materials.service';
import { PlantService } from './plant.service';

const CM: ConRoleCode = 'CON_CONTRACTS_MGR';
const QS: ConRoleCode = 'CON_QS';
const ACC: ConRoleCode = 'CON_ACCOUNTANT';
const PROC: ConRoleCode = 'CON_PROCUREMENT';
const PM: ConRoleCode = 'CON_PROJECT_MGR';
const ENG: ConRoleCode = 'CON_SITE_ENGINEER';
const SUP: ConRoleCode = 'CON_SITE_SUPERVISOR';
const STORE: ConRoleCode = 'CON_STOREKEEPER';

const REQ_VIEW = [CM, QS, ACC, PROC, PM, ENG, SUP, STORE];
const REQ_CREATE = [PM, ENG, SUP, STORE];
const DECIDE = [CM, PM];
const LPO_VIEW = [CM, QS, ACC, PROC, PM, STORE];
const STOCK_VIEW = [CM, QS, ACC, PROC, PM, ENG, SUP, STORE];
const RECON_VIEW = [CM, QS, ACC, PROC, PM];
const PLANT_VIEW = [CM, ACC, 'CON_SHE_OFFICER', PROC, PM, ENG, SUP, STORE] as ConRoleCode[];
const PLANT_LOG = [PROC, PM, SUP, STORE];

@Controller('construction')
@UseGuards(ConstructionGuard, ConProjectGuard)
export class MaterialsController {
  constructor(
    private readonly materials: MaterialsService,
    private readonly plant: PlantService,
  ) {}

  // ── Requisitions ──

  @ConFeature('procurement')
  @ConRoles(...REQ_VIEW)
  @Get('projects/:projectId/requisitions')
  requisitions(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.materials.listRequisitions(projectId);
  }

  @ConFeature('procurement')
  @ConRoles(...REQ_CREATE)
  @Post('projects/:projectId/requisitions')
  requisition(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: RequisitionDto) {
    return this.materials.createRequisition(req.con!, projectId, dto);
  }

  @ConFeature('procurement')
  @ConRoles(...DECIDE)
  @Post('projects/:projectId/requisitions/:id/approve')
  @HttpCode(200)
  approveRequisition(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.decideRequisition(req.con!, projectId, id, true);
  }

  @ConFeature('procurement')
  @ConRoles(...DECIDE)
  @Post('projects/:projectId/requisitions/:id/reject')
  @HttpCode(200)
  rejectRequisition(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.materials.decideRequisition(req.con!, projectId, id, false, dto.reason);
  }

  // ── LPOs and deliveries ──

  @ConFeature('procurement')
  @ConRoles(...LPO_VIEW)
  @Get('projects/:projectId/lpos')
  lpos(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.materials.listLpos(projectId);
  }

  @ConFeature('procurement')
  @ConRoles(...LPO_VIEW)
  @Get('projects/:projectId/lpos/:id')
  lpo(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.getLpo(projectId, id);
  }

  @ConFeature('procurement')
  @ConRoles(PROC)
  @Post('projects/:projectId/lpos')
  createLpo(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: LpoDto) {
    return this.materials.createLpo(req.con!, projectId, dto);
  }

  @ConFeature('procurement')
  @ConRoles(...DECIDE)
  @Post('projects/:projectId/lpos/:id/approve')
  @HttpCode(200)
  approveLpo(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.decideLpo(req.con!, projectId, id, true);
  }

  @ConFeature('procurement')
  @ConRoles(...DECIDE)
  @Post('projects/:projectId/lpos/:id/reject')
  @HttpCode(200)
  rejectLpo(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.materials.decideLpo(req.con!, projectId, id, false, dto.reason);
  }

  @ConFeature('procurement')
  @ConRoles(PROC, CM)
  @Post('projects/:projectId/lpos/:id/cancel')
  @HttpCode(200)
  cancelLpo(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.cancelLpo(req.con!, projectId, id);
  }

  @ConFeature('procurement')
  @ConRoles(STORE)
  @Post('projects/:projectId/lpos/:id/receive')
  @HttpCode(200)
  receive(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GrnDto) {
    return this.materials.receive(req.con!, projectId, id, dto);
  }

  // ── Site stock, issues, allowances ──

  @ConFeature('procurement')
  @ConRoles(...STOCK_VIEW)
  @Get('projects/:projectId/stock')
  stock(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.materials.stock(projectId);
  }

  @ConFeature('procurement')
  @ConRoles(...STOCK_VIEW)
  @Get('projects/:projectId/issues')
  issues(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.materials.listIssues(projectId);
  }

  @ConFeature('procurement')
  @ConRoles(STORE, PM)
  @Post('projects/:projectId/issues')
  issue(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: IssueDto) {
    return this.materials.issue(req.con!, projectId, dto);
  }

  @ConFeature('procurement')
  @ConRoles(QS, CM)
  @Put('projects/:projectId/material-budgets')
  budget(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: BudgetDto) {
    return this.materials.setBudget(req.con!, projectId, dto);
  }

  @ConFeature('procurement')
  @ConRoles(...RECON_VIEW)
  @Get('projects/:projectId/reconciliation')
  reconciliation(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.materials.reconciliation(projectId);
  }

  // ── Plant ──

  @ConFeature('plant')
  @ConRoles(...PLANT_VIEW)
  @Get('plant')
  plantList() {
    return this.plant.list();
  }

  @ConFeature('plant')
  @ConRoles(PROC, CM)
  @Post('plant')
  addPlant(@Req() req: ConRequest, @Body() dto: PlantDto) {
    return this.plant.save(req.con!, dto);
  }

  @ConFeature('plant')
  @ConRoles(PROC, CM)
  @Put('plant/:id')
  updatePlant(@Req() req: ConRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlantDto) {
    return this.plant.save(req.con!, dto, id);
  }

  @ConFeature('plant')
  @ConRoles(...PLANT_VIEW)
  @Get('projects/:projectId/plant-logs')
  plantLogs(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.plant.logs(projectId);
  }

  @ConFeature('plant')
  @ConRoles(...PLANT_LOG)
  @Post('projects/:projectId/plant-logs')
  plantLog(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: PlantLogDto) {
    return this.plant.log(req.con!, projectId, dto);
  }

  @ConFeature('plant')
  @ConRoles(...RECON_VIEW, ACC)
  @Get('projects/:projectId/plant-cost')
  plantCost(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.plant.projectCost(projectId);
  }
}
