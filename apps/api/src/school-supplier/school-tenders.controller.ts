import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  AwardTenderDto,
  ChecklistItemDto,
  ChecklistTickDto,
  CloseContractDto,
  ComplianceDocDto,
  ListQueryDto,
  OrderContractDto,
  SaveContractDto,
  SaveTenderDto,
  SaveTenderLinesDto,
  SubmitTenderDto,
  TenderOutcomeDto,
  UpdateContractDto,
  VariationDto,
} from './dto/school-supplier.dto';
import { SchoolContractsService } from './school-contracts.service';
import { SchoolTendersService } from './school-tenders.service';

const READERS = [Role.MANAGER, Role.OWNER, Role.AUDITOR];
const WRITERS = [Role.MANAGER, Role.OWNER];

/** Tenders, the compliance documents they need, and the contracts they lead to. Back office only. */
@Controller('school-supplier')
export class SchoolTendersController {
  constructor(
    private readonly tenders: SchoolTendersService,
    private readonly contracts: SchoolContractsService,
  ) {}

  // ── Tenders ──
  @Roles(...READERS)
  @Get('tenders')
  list(@Query() q: ListQueryDto) {
    return this.tenders.list(q.status);
  }

  @Roles(...READERS)
  @Get('tenders/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenders.get(id);
  }

  @Roles(...WRITERS)
  @Post('tenders')
  create(@Body() dto: SaveTenderDto) {
    return this.tenders.create(dto);
  }

  @Roles(...WRITERS)
  @Put('tenders/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveTenderDto) {
    return this.tenders.update(id, dto);
  }

  @Roles(...WRITERS)
  @Delete('tenders/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenders.remove(id);
  }

  @Roles(...WRITERS)
  @Put('tenders/:id/lines')
  setLines(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveTenderLinesDto,
  ) {
    return this.tenders.setLines(id, dto);
  }

  @Roles(...WRITERS)
  @Post('tenders/:id/checklist')
  addCheck(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChecklistItemDto,
  ) {
    return this.tenders.addCheck(id, dto.title);
  }

  @Roles(...WRITERS)
  @Patch('tenders/:id/checklist/:itemId')
  tick(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: ChecklistTickDto,
  ) {
    return this.tenders.tickCheck(id, itemId, dto.done);
  }

  @Roles(...WRITERS)
  @Delete('tenders/:id/checklist/:itemId')
  removeCheck(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.tenders.removeCheck(id, itemId);
  }

  /** What stands in the way of submitting, and what is worth a look. */
  @Roles(...READERS)
  @Get('tenders/:id/readiness')
  readiness(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenders.readiness(id);
  }

  @Roles(...WRITERS)
  @Post('tenders/:id/start')
  @HttpCode(200)
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenders.startPreparing(id);
  }

  @Roles(...WRITERS)
  @Post('tenders/:id/submit')
  @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitTenderDto) {
    return this.tenders.submit(id, dto);
  }

  /** Won: makes the contract. */
  @Roles(...WRITERS)
  @Post('tenders/:id/award')
  @HttpCode(200)
  award(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AwardTenderDto) {
    return this.tenders.award(id, dto);
  }

  @Roles(...WRITERS)
  @Post('tenders/:id/lost')
  @HttpCode(200)
  lost(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TenderOutcomeDto) {
    return this.tenders.conclude(id, 'LOST', dto.note);
  }

  @Roles(...WRITERS)
  @Post('tenders/:id/withdraw')
  @HttpCode(200)
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TenderOutcomeDto,
  ) {
    return this.tenders.conclude(id, 'WITHDRAWN', dto.note);
  }

  @Roles(...WRITERS)
  @Post('tenders/:id/cancelled')
  @HttpCode(200)
  cancelled(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TenderOutcomeDto,
  ) {
    return this.tenders.conclude(id, 'CANCELLED', dto.note);
  }

  // ── Compliance documents ──
  @Roles(...READERS)
  @Get('compliance')
  docs() {
    return this.tenders.listDocs();
  }

  @Roles(...WRITERS)
  @Post('compliance')
  addDoc(@Body() dto: ComplianceDocDto) {
    return this.tenders.saveDoc(dto);
  }

  @Roles(...WRITERS)
  @Put('compliance/:id')
  updateDoc(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ComplianceDocDto,
  ) {
    return this.tenders.saveDoc(dto, id);
  }

  @Roles(...WRITERS)
  @Delete('compliance/:id')
  deleteDoc(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenders.removeDoc(id);
  }

  // ── Contracts ──
  @Roles(...READERS)
  @Get('contracts')
  listContracts(@Query() q: ListQueryDto) {
    return this.contracts.list(q.status, q.schoolId);
  }

  @Roles(...READERS)
  @Get('contracts/:id')
  getContract(@Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.get(id);
  }

  @Roles(...WRITERS)
  @Post('contracts')
  createContract(@Body() dto: SaveContractDto) {
    return this.contracts.create(dto);
  }

  @Roles(...WRITERS)
  @Patch('contracts/:id')
  updateContract(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.contracts.update(id, dto);
  }

  @Roles(...WRITERS)
  @Post('contracts/:id/variations')
  variation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VariationDto) {
    return this.contracts.addVariation(id, dto);
  }

  @Roles(...WRITERS)
  @Post('contracts/:id/close')
  @HttpCode(200)
  closeContract(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseContractDto,
  ) {
    return this.contracts.close(id, dto);
  }

  /** The contracts of a school that are running today (for choosing one on an order). */
  @Roles(...READERS)
  @Get('schools/:id/running-contracts')
  running(@Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.runningFor(id);
  }

  /** Puts an order under a contract, or takes it off (contractId null). */
  @Roles(...WRITERS)
  @Post('orders/:id/contract')
  @HttpCode(200)
  linkOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrderContractDto,
  ) {
    return this.contracts.linkOrder(id, dto.contractId ?? null);
  }
}
