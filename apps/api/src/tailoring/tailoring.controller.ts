import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  CloseJobDto,
  CreateTailorJobDto,
  HandInDto,
  JobsQueryDto,
  MaterialsQueryDto,
  SaveTailorDto,
  TailorPaymentDto,
  VoidPaymentDto,
} from './dto/tailoring.dto';
import { TailoringService } from './tailoring.service';

const LOOK = [Role.MANAGER, Role.OWNER, Role.AUDITOR];
const WORK = [Role.MANAGER, Role.OWNER];

/** Uniform makers' tailoring: owners and managers do the work, auditors can look. */
@Controller('tailoring')
export class TailoringController {
  constructor(private readonly tailoring: TailoringService) {}

  @Roles(...LOOK)
  @Get('tailors')
  tailors() {
    return this.tailoring.listTailors();
  }

  @Roles(...WORK)
  @Post('tailors')
  createTailor(@Body() dto: SaveTailorDto) {
    return this.tailoring.createTailor(dto);
  }

  @Roles(...WORK)
  @Patch('tailors/:id')
  updateTailor(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveTailorDto) {
    return this.tailoring.updateTailor(id, dto);
  }

  @Roles(...LOOK)
  @Get('tailors/:id/statement')
  statement(@Param('id', ParseUUIDPipe) id: string) {
    return this.tailoring.statement(id);
  }

  @Roles(...LOOK)
  @Get('materials')
  materials(@Query() q: MaterialsQueryDto) {
    return this.tailoring.materials(q);
  }

  @Roles(...LOOK)
  @Get('jobs')
  jobs(@Query() q: JobsQueryDto) {
    return this.tailoring.listJobs(q);
  }

  @Roles(...LOOK)
  @Get('jobs/:id')
  job(@Param('id', ParseUUIDPipe) id: string) {
    return this.tailoring.getJob(id);
  }

  @Roles(...WORK)
  @Post('jobs')
  createJob(@Body() dto: CreateTailorJobDto) {
    return this.tailoring.createJob(dto);
  }

  @Roles(...WORK)
  @Post('jobs/:id/hand-in')
  handIn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HandInDto) {
    return this.tailoring.handIn(id, dto);
  }

  @Roles(...WORK)
  @Post('jobs/:id/close')
  @HttpCode(200)
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseJobDto) {
    return this.tailoring.closeJob(id, dto);
  }

  @Roles(...WORK)
  @Post('jobs/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.tailoring.cancelJob(id);
  }

  @Roles(...LOOK)
  @Get('payments')
  payments(@Query('tailorId') tailorId?: string) {
    return this.tailoring.listPayments(tailorId || undefined);
  }

  @Roles(...WORK)
  @Post('payments')
  pay(@Body() dto: TailorPaymentDto) {
    return this.tailoring.pay(dto);
  }

  @Roles(...WORK)
  @Post('payments/:id/void')
  @HttpCode(200)
  voidPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidPaymentDto) {
    return this.tailoring.voidPayment(id, dto);
  }
}
