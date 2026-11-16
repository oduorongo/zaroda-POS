import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, ForbiddenException, Get, HttpCode, Injectable, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { SalesAgentRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedAgent, CurrentAgent, PasswordChangedGuard, SalesAgentAuthGuard } from './sales-agent-auth';

class SyncSchoolDto {
  @IsString() @MaxLength(64) id!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsDateString() signedUpAt!: string;
  @IsBoolean() active!: boolean;
  @IsString() @MaxLength(120) agentRef!: string;
}

class SyncPaymentDto {
  @IsString() @MaxLength(64) id!: string;
  @IsString() @MaxLength(64) schoolId!: string;
  @IsNumber() @Min(0) amountKes!: number;
  @IsDateString() paidAt!: string;
}

export class SchoolSalesSyncDto {
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => SyncSchoolDto) schools?: SyncSchoolDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => SyncPaymentDto) payments?: SyncPaymentDto[];
}

/** A pasted key without stray spaces, line breaks or surrounding quotes. */
export const cleanKey = (key: string | null | undefined) => (key ?? '').trim().replace(/^["']+|["']+$/g, '').trim();

/** The last 9 digits of a Kenyan phone number, however it was typed (07.., 2547.., +254 7..). */
export const phoneKey = (phone: string | null | undefined) => {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
};

/**
 * Zaroda School runs on its own database. It reports here the schools that signed up with a team member's link
 * or code, and every subscription payment they make; SalesEarningsService then pays the team on them like any
 * other business. Safe to repeat: a school is credited to the first member it was reported with and never moved,
 * and a payment is stored once.
 */
@Injectable()
export class SchoolSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  signupUrl(agentId: string) {
    const base = (this.config.get<string>('SCHOOL_APP_URL') ?? 'https://zarodaschool.com').replace(/\/+$/, '');
    return `${base}/auth/signup?agent=${agentId}`;
  }

  /** The member a reference names: their id (from the link), sign-in email or phone. */
  async findAgent(ref: string) {
    const value = ref.trim();
    if (!value) return null;
    if (/^[0-9a-f-]{36}$/i.test(value)) {
      const byId = await this.prisma.salesAgent.findUnique({ where: { id: value.toLowerCase() }, select: { id: true, teamId: true } });
      if (byId) return byId;
    }
    if (value.includes('@')) return this.prisma.salesAgent.findUnique({ where: { email: value.toLowerCase() }, select: { id: true, teamId: true } });
    const key = phoneKey(value);
    if (!key) return null;
    const withPhone = await this.prisma.salesAgent.findMany({ where: { phone: { not: null } }, select: { id: true, teamId: true, phone: true } });
    const matches = withPhone.filter((a) => phoneKey(a.phone) === key);
    return matches.length === 1 ? { id: matches[0].id, teamId: matches[0].teamId } : null;
  }

  async sync(dto: SchoolSalesSyncDto) {
    const unmatched: string[] = [];
    let added = 0;
    for (const s of dto.schools ?? []) {
      const existing = await this.prisma.salesSchool.findUnique({ where: { id: s.id }, select: { id: true } });
      if (existing) {
        await this.prisma.salesSchool.update({ where: { id: s.id }, data: { name: s.name.trim(), active: s.active } });
        continue;
      }
      const agent = await this.findAgent(s.agentRef);
      if (!agent) {
        unmatched.push(s.id);
        continue;
      }
      await this.prisma.salesSchool.create({
        data: { id: s.id, name: s.name.trim(), teamId: agent.teamId, agentId: agent.id, agentRef: s.agentRef.trim(), signedUpAt: new Date(s.signedUpAt), active: s.active },
      });
      added++;
    }

    const payments = dto.payments ?? [];
    const known = new Set(
      (await this.prisma.salesSchool.findMany({ where: { id: { in: [...new Set(payments.map((p) => p.schoolId))] } }, select: { id: true } })).map((s) => s.id),
    );
    const rows = payments
      .filter((p) => known.has(p.schoolId))
      .map((p) => ({ id: `school:${p.id}`, schoolId: p.schoolId, amountKes: p.amountKes, paidAt: new Date(p.paidAt) }));
    const stored = rows.length ? (await this.prisma.salesSchoolPayment.createMany({ data: rows, skipDuplicates: true })).count : 0;
    return { schoolsAdded: added, unmatched, paymentsAdded: stored };
  }

  /** The schools this person brought in (a leader: the whole team's), with what each has paid. */
  async list(agent: AuthenticatedAgent) {
    const where = agent.role === SalesAgentRole.LEADER ? { teamId: agent.teamId } : { teamId: agent.teamId, agentId: agent.agentId };
    const schools = await this.prisma.salesSchool.findMany({
      where,
      orderBy: { signedUpAt: 'desc' },
      take: 500,
      include: { agent: { select: { fullName: true } }, payments: { select: { amountKes: true, paidAt: true } } },
    });
    return {
      signupUrl: this.signupUrl(agent.agentId),
      schools: schools.map((s) => ({
        id: s.id,
        name: s.name,
        signedUpAt: s.signedUpAt,
        active: s.active,
        broughtInBy: s.agent.fullName,
        payments: s.payments.length,
        paidKes: s.payments.reduce((t, p) => t + Number(p.amountKes), 0),
        lastPaidAt: s.payments.reduce<Date | null>((d, p) => (!d || p.paidAt > d ? p.paidAt : d), null),
      })),
    };
  }
}

/** Called by Zaroda School's server only, with the shared key in the x-sales-sync-key header. */
@Controller('sales-sync')
export class SchoolSalesSyncController {
  constructor(
    private readonly schools: SchoolSalesService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('school')
  @HttpCode(200)
  sync(@Req() req: Request, @Body() dto: SchoolSalesSyncDto) {
    const expected = cleanKey(this.config.get<string>('SCHOOL_SALES_SYNC_KEY'));
    if (expected.length < 24) throw new ForbiddenException('SCHOOL_SALES_SYNC_KEY is not set on the POS API (24+ characters).');
    const given = Buffer.from(cleanKey(String(req.headers['x-sales-sync-key'] ?? '')));
    if (given.length !== Buffer.byteLength(expected) || !timingSafeEqual(given, Buffer.from(expected)))
      throw new ForbiddenException(`The sync key does not match the POS key (got ${given.length} characters, the POS key has ${Buffer.byteLength(expected)}).`);
    return this.schools.sync(dto);
  }
}

@Controller('sales-agent/schools')
export class SchoolSalesAgentController {
  constructor(private readonly schools: SchoolSalesService) {}

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Get()
  list(@CurrentAgent() agent: AuthenticatedAgent) {
    return this.schools.list(agent);
  }
}
