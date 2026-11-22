import { Body, Controller, ForbiddenException, HttpCode, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { cleanKey } from '../sales-teams/school-sales';

/** Each app and the POS setting holding the key it signs its reports with. */
export const APP_INCOME_KEYS: Record<string, string> = {
  SCHOOL_RECORDS: 'SCHOOL_SALES_SYNC_KEY',
  BOOKS: 'BOOKS_INCOME_SYNC_KEY',
  SPORTS: 'SPORTS_INCOME_SYNC_KEY',
  EVENTS: 'EVENTS_INCOME_SYNC_KEY',
};

export class AppIncomeReceiptDto {
  /** The payment's own id in the app (stored as "<app>:<id>", so sending it again changes nothing). */
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  payer!: string;

  /** e.g. "Zaroda Books subscription", "Professional records wallet top-up". */
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amountKes!: number;

  @IsDateString()
  paidAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference?: string;
}

export class AppIncomeSyncDto {
  @IsIn(Object.keys(APP_INCOME_KEYS))
  app!: string;

  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => AppIncomeReceiptDto)
  receipts!: AppIncomeReceiptDto[];
}

/** Called by ZARODA's other apps' servers only, each with its own key in the x-income-sync-key header. */
@Controller('sales-sync')
export class AppIncomeSyncController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('income')
  @HttpCode(200)
  async sync(@Req() req: Request, @Body() dto: AppIncomeSyncDto) {
    const setting = APP_INCOME_KEYS[dto.app];
    const expected = cleanKey(this.config.get<string>(setting));
    if (expected.length < 24) throw new ForbiddenException(`${setting} is not set on the POS API (24+ characters).`);
    const given = Buffer.from(cleanKey(String(req.headers['x-income-sync-key'] ?? '')));
    if (given.length !== Buffer.byteLength(expected) || !timingSafeEqual(given, Buffer.from(expected)))
      throw new ForbiddenException(`The income key does not match ${setting} (got ${given.length} characters, the POS key has ${Buffer.byteLength(expected)}).`);
    const { count } = await this.prisma.appIncomeReceipt.createMany({
      data: dto.receipts.map((r) => ({
        id: `${dto.app}:${r.id}`,
        app: dto.app,
        payer: r.payer.trim(),
        description: r.description.trim(),
        amountKes: r.amountKes,
        paidAt: new Date(r.paidAt),
        reference: r.reference?.trim() || null,
      })),
      skipDuplicates: true,
    });
    return { received: dto.receipts.length, added: count };
  }
}
