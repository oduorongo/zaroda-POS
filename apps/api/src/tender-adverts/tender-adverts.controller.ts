import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import {
  RegisterTenderBuyerDto,
  SaveTenderAdvertDto,
  TenderBoardQueryDto,
  TenderBuyerLoginDto,
  TenderNoticeDto,
} from './dto/tender-advert.dto';
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
