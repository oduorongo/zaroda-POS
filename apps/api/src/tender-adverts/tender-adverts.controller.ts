import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  PayloadTooLargeException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import {
  RegisterTenderBuyerDto,
  SaveTenderAdvertDto,
  TenderBoardQueryDto,
  TenderBuyerLoginDto,
  TenderNoticeDto,
} from './dto/tender-advert.dto';
import { MAX_PDF_BYTES, cleanFileName } from './tender-advert.util';
import { TenderAdvertsService } from './tender-adverts.service';
import { TenderBoardService } from './tender-board.service';
import {
  CurrentTenderBuyer,
  TenderBuyerAuthGuard,
  TenderBuyerIdentity,
} from './tender-buyer-auth';
import { TenderBuyerAuthService } from './tender-buyer-auth.service';

// Same tight shape as rider, shopper and school sign-in.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/** A school registers and signs in. Public. */
@Controller('tender-buyer-auth')
export class TenderBuyerAuthController {
  constructor(private readonly auth: TenderBuyerAuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Body() dto: RegisterTenderBuyerDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: TenderBuyerLoginDto) {
    return this.auth.login(dto);
  }
}

/** A school's own account and adverts - its token only. */
@Controller('tender-buyer')
@Public()
@UseGuards(TenderBuyerAuthGuard)
export class TenderBuyerController {
  constructor(private readonly adverts: TenderAdvertsService) {}

  @Get('me')
  me(@CurrentTenderBuyer() who: TenderBuyerIdentity) {
    return this.adverts.me(who.buyerId);
  }

  @Get('adverts')
  list(@CurrentTenderBuyer() who: TenderBuyerIdentity) {
    return this.adverts.list(who.buyerId);
  }

  @Post('adverts')
  create(
    @CurrentTenderBuyer() who: TenderBuyerIdentity,
    @Body() dto: SaveTenderAdvertDto,
  ) {
    return this.adverts.create(who.buyerId, dto);
  }

  @Put('adverts/:id')
  update(
    @CurrentTenderBuyer() who: TenderBuyerIdentity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveTenderAdvertDto,
  ) {
    return this.adverts.update(who.buyerId, id, dto);
  }

  /** The school's PDF is the request body (Content-Type: application/pdf); its name goes in ?name=. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('adverts/:id/pdf')
  async attachPdf(
    @CurrentTenderBuyer() who: TenderBuyerIdentity,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('name') name: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Req() req: Request,
  ) {
    if ((contentType ?? '').split(';')[0].trim().toLowerCase() !== 'application/pdf')
      throw new BadRequestException('Upload a PDF file');
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > MAX_PDF_BYTES)
        throw new PayloadTooLargeException('The PDF must be 10MB or smaller');
      chunks.push(chunk);
    }
    return this.adverts.setPdf(who.buyerId, id, cleanFileName(name), Buffer.concat(chunks));
  }

  @Delete('adverts/:id/pdf')
  removePdf(
    @CurrentTenderBuyer() who: TenderBuyerIdentity,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adverts.removePdf(who.buyerId, id);
  }

  @Post('adverts/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentTenderBuyer() who: TenderBuyerIdentity,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adverts.cancel(who.buyerId, id);
  }
}

/** What a school-supplier business sees of the adverts schools posted. Back office only. */
@Controller('school-supplier/tender-adverts')
export class SchoolTenderBoardController {
  constructor(private readonly board: TenderBoardService) {}

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get()
  list(@Query() q: TenderBoardQueryDto) {
    return this.board.list(q);
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('new-count')
  newCount() {
    return this.board.newCount();
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Put(':id/state')
  setState(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TenderNoticeDto,
  ) {
    return this.board.setState(id, dto.state);
  }
}
