import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PlatformAdminAuthGuard } from '../platform-admin/platform-admin-auth.guard';
import { EarningsMonthQueryDto } from './dto/sales-earnings.dto';
import { AuthenticatedAgent, CurrentAgent, PasswordChangedGuard, SalesAgentAuthGuard } from './sales-agent-auth';
import { ANY_TYPE, SalesSetupFeesService, SETUP_SIZES } from './sales-setup-fees.service';

const TYPES = [ANY_TYPE, 'RETAIL', 'RESTAURANT', 'PHARMACY', 'SALON', 'RENTAL', 'SCHOOL_SUPPLIER', 'HOTEL', 'CONSTRUCTION'];

class RecordSetupFeeDto {
  @IsUUID()
  organizationId!: string;

  @IsIn(SETUP_SIZES)
  size!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amountKes!: number;

  @IsString()
  @MaxLength(300)
  @IsOptional()
  note?: string;
}

class SetupFeeRateDto {
  @IsIn(TYPES)
  industryType!: string;

  @IsIn(SETUP_SIZES)
  size!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minKes!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxKes!: number;
}

class SetupFeeRatesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SetupFeeRateDto)
  rates!: SetupFeeRateDto[];
}

class VoidSetupFeeDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

interface PlatformAdminRequest extends Request {
  user?: { platformAdminId: string };
}

/** A team member's setup fees: the ranges, the businesses still to charge, and recording one (cash they keep). */
@Controller('sales-agent/setup-fees')
export class SalesSetupFeesAgentController {
  constructor(private readonly fees: SalesSetupFeesService) {}

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Get()
  mine(@CurrentAgent() agent: AuthenticatedAgent) {
    return this.fees.mine(agent);
  }

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Post()
  record(@CurrentAgent() agent: AuthenticatedAgent, @Body() dto: RecordSetupFeeDto) {
    return this.fees.record(agent, dto);
  }
}

/** The platform owner: the price ranges, every fee recorded, and voiding a mistake. */
@Controller('platform-admin/sales-setup-fees')
export class SalesSetupFeesAdminController {
  constructor(private readonly fees: SalesSetupFeesService) {}

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get()
  overview(@Query() query: EarningsMonthQueryDto) {
    return this.fees.overview(query.month);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Put('rates')
  setRates(@Req() req: PlatformAdminRequest, @Body() dto: SetupFeeRatesDto) {
    return this.fees.setRates(req.user!.platformAdminId, dto.rates);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post(':id/void')
  @HttpCode(200)
  voidFee(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidSetupFeeDto) {
    return this.fees.voidFee(req.user!.platformAdminId, id, dto.reason);
  }
}
