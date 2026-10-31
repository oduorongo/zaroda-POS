import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ConRoleCode } from '@prisma/client';
import { ConFeature, ConProjectGuard, ConRequest, ConRoles, ConstructionGuard } from '../common/con-access';
import { CertifyDto, ReceiptDto, RetentionReleaseDto, SubPaymentDto, SubValuationDto, SubcontractDto, ValuationDto, VariationDecisionDto, VariationDto } from '../dto/commercial.dto';
import { CommercialService } from './commercial.service';
import { SubcontractsService } from './subcontracts.service';

const CM: ConRoleCode = 'CON_CONTRACTS_MGR';
const QS: ConRoleCode = 'CON_QS';
const ACC: ConRoleCode = 'CON_ACCOUNTANT';
const PM: ConRoleCode = 'CON_PROJECT_MGR';
const ENG: ConRoleCode = 'CON_SITE_ENGINEER';
const VIEW = [CM, QS, ACC, PM, ENG];
const VARIATION_EDIT = [PM, QS, ENG];
const SUB_VIEW = [CM, QS, ACC, PM];

@Controller('construction/projects/:projectId')
@UseGuards(ConstructionGuard, ConProjectGuard)
export class CommercialController {
  constructor(
    private readonly commercial: CommercialService,
    private readonly subs: SubcontractsService,
  ) {}

  // ── Variations ──

  @ConFeature('commercial')
  @ConRoles(...VIEW)
  @Get('variations')
  variations(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.commercial.listVariations(projectId);
  }

  @ConFeature('commercial')
  @ConRoles(...VARIATION_EDIT)
  @Post('variations')
  addVariation(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: VariationDto) {
    return this.commercial.saveVariation(req.con!, projectId, dto);
  }

  @ConFeature('commercial')
  @ConRoles(...VARIATION_EDIT)
  @Put('variations/:id')
  updateVariation(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VariationDto) {
    return this.commercial.saveVariation(req.con!, projectId, dto, id);
  }

  @ConFeature('commercial')
  @ConRoles(CM)
  @Post('variations/:id/decision')
  @HttpCode(200)
  decideVariation(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VariationDecisionDto) {
    return this.commercial.decideVariation(req.con!, projectId, id, dto);
  }

  // ── Valuations / IPCs ──

  @ConFeature('commercial')
  @ConRoles(...VIEW)
  @Get('valuations')
  valuations(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.commercial.listValuations(projectId);
  }

  @ConFeature('commercial')
  @ConRoles(QS, CM)
  @Get('valuations/template')
  template(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.commercial.template(projectId);
  }

  @ConFeature('commercial')
  @ConRoles(...VIEW)
  @Get('valuations/:id')
  valuation(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.getValuation(projectId, id);
  }

  @ConFeature('commercial')
  @ConRoles(QS)
  @Post('valuations')
  createValuation(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: ValuationDto) {
    return this.commercial.createValuation(req.con!, projectId, dto);
  }

  @ConFeature('commercial')
  @ConRoles(QS)
  @Put('valuations/:id')
  updateValuation(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ValuationDto) {
    return this.commercial.updateValuation(req.con!, projectId, id, dto);
  }

  @ConFeature('commercial')
  @ConRoles(CM)
  @Post('valuations/:id/submit')
  @HttpCode(200)
  submit(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.submit(req.con!, projectId, id);
  }

  @ConFeature('commercial')
  @ConRoles(QS, CM)
  @Post('valuations/:id/certify')
  @HttpCode(200)
  certify(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CertifyDto) {
    return this.commercial.certify(req.con!, projectId, id, dto);
  }

  @ConFeature('commercial')
  @ConRoles(QS, CM)
  @Post('valuations/:id/reverse')
  @HttpCode(200)
  reverse(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.reverse(req.con!, projectId, id);
  }

  @ConFeature('etims')
  @ConRoles(ACC, QS)
  @Post('valuations/:id/invoice')
  @HttpCode(200)
  invoice(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.invoice(req.con!, projectId, id);
  }

  @ConFeature('commercial')
  @ConRoles(ACC)
  @Post('valuations/:id/receipts')
  receipt(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiptDto) {
    return this.commercial.addReceipt(req.con!, projectId, id, dto);
  }

  // ── Retention ──

  @ConFeature('commercial')
  @ConRoles(...VIEW)
  @Get('retention')
  retention(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.commercial.retention(projectId);
  }

  @ConFeature('commercial')
  @ConRoles(CM, QS)
  @Post('retention/release')
  @HttpCode(200)
  release(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: RetentionReleaseDto) {
    return this.commercial.releaseRetention(req.con!, projectId, dto);
  }

  // ── Subcontracts ──

  @ConFeature('subcontracts')
  @ConRoles(...SUB_VIEW)
  @Get('subcontracts')
  subcontracts(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.subs.list(projectId);
  }

  @ConFeature('subcontracts')
  @ConRoles(QS)
  @Post('subcontracts')
  addSubcontract(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: SubcontractDto) {
    return this.subs.create(req.con!, projectId, dto);
  }

  @ConFeature('subcontracts')
  @ConRoles(QS)
  @Post('subcontracts/:id/valuations')
  addSubValuation(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubValuationDto) {
    return this.subs.addValuation(req.con!, projectId, id, dto);
  }

  @ConFeature('subcontracts')
  @ConRoles(CM)
  @Post('subcontracts/:id/valuations/:valuationId/approve')
  @HttpCode(200)
  approveSub(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Param('valuationId', ParseUUIDPipe) valuationId: string) {
    return this.subs.approve(req.con!, projectId, id, valuationId);
  }

  @ConFeature('subcontracts')
  @ConRoles(ACC)
  @Post('subcontracts/:id/valuations/:valuationId/paid')
  @HttpCode(200)
  paySub(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Param('valuationId', ParseUUIDPipe) valuationId: string, @Body() dto: SubPaymentDto) {
    return this.subs.markPaid(req.con!, projectId, id, valuationId, dto.paymentRef);
  }

  @ConFeature('subcontracts')
  @ConRoles(QS)
  @Delete('subcontracts/:id/valuations/:valuationId')
  removeSub(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Param('valuationId', ParseUUIDPipe) valuationId: string) {
    return this.subs.removeDraft(projectId, id, valuationId);
  }
}
