import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { BookQueryDto, CountDto, CreateBoxDto, PayDto, TopUpDto, UpdateBoxDto, VoidEntryDto } from './dto/petty-cash.dto';
import { PettyCashService } from './petty-cash.service';

const LOOK = [Role.MANAGER, Role.OWNER, Role.AUDITOR];
const WORK = [Role.MANAGER, Role.OWNER];

/** A business's petty cash: owners and managers keep it, auditors can look. */
@Controller('petty-cash')
export class PettyCashController {
  constructor(private readonly pettyCash: PettyCashService) {}

  @Roles(...LOOK)
  @Get('boxes')
  boxes() {
    return this.pettyCash.listBoxes();
  }

  @Roles(...WORK)
  @Post('boxes')
  createBox(@Body() dto: CreateBoxDto) {
    return this.pettyCash.createBox(dto);
  }

  @Roles(...WORK)
  @Patch('boxes/:id')
  updateBox(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBoxDto) {
    return this.pettyCash.updateBox(id, dto);
  }

  @Roles(...LOOK)
  @Get('boxes/:id/book')
  book(@Param('id', ParseUUIDPipe) id: string, @Query() q: BookQueryDto) {
    return this.pettyCash.book(id, q);
  }

  @Roles(...WORK)
  @Post('boxes/:id/pay')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto) {
    return this.pettyCash.pay(id, dto);
  }

  @Roles(...WORK)
  @Post('boxes/:id/top-up')
  topUp(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TopUpDto) {
    return this.pettyCash.topUp(id, dto);
  }

  @Roles(...WORK)
  @Post('boxes/:id/count')
  count(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CountDto) {
    return this.pettyCash.count(id, dto);
  }

  @Roles(...WORK)
  @Post('entries/:id/void')
  @HttpCode(200)
  voidEntry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidEntryDto) {
    return this.pettyCash.voidEntry(id, dto);
  }
}
