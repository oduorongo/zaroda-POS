import { randomBytes } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SalesAgentRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthenticatedAgent } from './sales-agent-auth';
import { nairobiMonth, round2 } from './sales-earnings.util';

export const SETUP_SIZES = ['SMALL', 'MEDIUM', 'LARGE'] as const;
export type SetupSize = (typeof SETUP_SIZES)[number];
export const ANY_TYPE = 'ANY';

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

export interface Rate {
  industryType: string;
  size: string;
  minKes: number;
  maxKes: number;
}

/** The range for a business type and size: its own row, else the "ANY" row. */
export function rangeFor(rates: Rate[], industryType: string, size: string): Rate | null {
  return rates.find((r) => r.industryType === industryType && r.size === size) ?? rates.find((r) => r.industryType === ANY_TYPE && r.size === size) ?? null;
}

/**
 * Setup fees: a team member charges a business they set up a one-off fee, by its size and type within the range the platform
 * owner sets, and keeps it in cash. ZARODA never pays it out (it is not an earning); it is recorded so the owner sees who
 * charged what and the business gets a receipt number. One live fee per business; a mistake is voided by the owner, not deleted.
 */
@Injectable()
export class SalesSetupFeesService {
  constructor(private readonly prisma: PrismaService) {}

  private async rates(): Promise<Rate[]> {
    const rows = await this.prisma.salesSetupFeeRate.findMany({ orderBy: [{ industryType: 'asc' }, { size: 'asc' }] });
    return rows.map((r) => ({ industryType: r.industryType, size: r.size, minKes: num(r.minKes), maxKes: num(r.maxKes) }));
  }

  // ── Team member ──────────────────────────────────────────────────────

  /** My businesses (a leader: the team's), the ranges, and the fees recorded. */
  async mine(agent: AuthenticatedAgent) {
    const scope = agent.role === SalesAgentRole.LEADER ? { salesTeamId: agent.teamId } : { salesTeamId: agent.teamId, salesAgentId: agent.agentId };
    const [orgs, fees, rates] = await Promise.all([
      this.prisma.organization.findMany({ where: scope, select: { id: true, name: true, industryType: true, salesAgentId: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 500 }),
      this.prisma.salesSetupFee.findMany({
        where: agent.role === SalesAgentRole.LEADER ? { teamId: agent.teamId } : { agentId: agent.agentId },
        orderBy: { receivedAt: 'desc' },
        take: 500,
        include: { agent: { select: { fullName: true } } },
      }),
      this.rates(),
    ]);
    const charged = new Set(fees.filter((f) => !f.voidedAt).map((f) => f.organizationId));
    const month = nairobiMonth(new Date());
    return {
      rates,
      notYetCharged: orgs.filter((o) => !charged.has(o.id) && o.salesAgentId === agent.agentId).map((o) => ({ id: o.id, name: o.name, industryType: o.industryType })),
      fees: fees.map((f) => this.view(f)),
      thisMonthKes: round2(fees.filter((f) => !f.voidedAt && nairobiMonth(f.receivedAt) === month && f.agentId === agent.agentId).reduce((t, f) => t + num(f.amountKes), 0)),
    };
  }

  async record(agent: AuthenticatedAgent, dto: { organizationId: string; size: string; amountKes: number; note?: string }) {
    const org = await this.prisma.organization.findUnique({ where: { id: dto.organizationId }, select: { id: true, name: true, industryType: true, salesTeamId: true, salesAgentId: true } });
    if (!org) throw new NotFoundException('Business not found');
    if (org.salesAgentId !== agent.agentId) throw new ForbiddenException('You can only record a setup fee for a business you set up');
    const range = rangeFor(await this.rates(), org.industryType, dto.size);
    if (!range) throw new BadRequestException('There is no setup fee for that size yet - ask ZARODA to set one');
    if (dto.amountKes < range.minKes || dto.amountKes > range.maxKes) {
      throw new BadRequestException(`For a ${dto.size.toLowerCase()} business the setup fee is KES ${range.minKes.toLocaleString()} to KES ${range.maxKes.toLocaleString()}`);
    }
    return this.prisma.$transaction(async (tx) => {
      if (await tx.salesSetupFee.findFirst({ where: { organizationId: org.id, voidedAt: null } })) {
        throw new ConflictException(`A setup fee is already recorded for ${org.name}`);
      }
      const fee = await tx.salesSetupFee.create({
        data: {
          organizationId: org.id,
          organizationName: org.name,
          teamId: agent.teamId,
          agentId: agent.agentId,
          industryType: org.industryType,
          size: dto.size,
          amountKes: round2(dto.amountKes),
          receiptNo: `SF-${new Date().getUTCFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`,
          note: dto.note?.trim() || null,
        },
        include: { agent: { select: { fullName: true } } },
      });
      return this.view(fee);
    });
  }

  // ── Platform owner ───────────────────────────────────────────────────

  async overview(month: string | undefined) {
    const period = month ?? nairobiMonth(new Date());
    const [y, m] = period.split('-').map(Number);
    // Nairobi is UTC+3: the month runs from 21:00 UTC on the last day of the month before.
    const from = new Date(Date.UTC(y, m - 1, 1) - 3 * 3600_000);
    const to = new Date(Date.UTC(y, m, 1) - 3 * 3600_000);
    const [fees, rates, teams] = await Promise.all([
      this.prisma.salesSetupFee.findMany({ where: { receivedAt: { gte: from, lt: to } }, orderBy: { receivedAt: 'desc' }, include: { agent: { select: { fullName: true } } } }),
      this.rates(),
      this.prisma.salesTeam.findMany({ select: { id: true, name: true } }),
    ]);
    const live = fees.filter((f) => !f.voidedAt);
    const byAgent = new Map<string, { agentId: string; fullName: string; team: string; count: number; totalKes: number }>();
    for (const f of live) {
      const row = byAgent.get(f.agentId) ?? { agentId: f.agentId, fullName: f.agent.fullName, team: teams.find((t) => t.id === f.teamId)?.name ?? '', count: 0, totalKes: 0 };
      row.count++;
      row.totalKes = round2(row.totalKes + num(f.amountKes));
      byAgent.set(f.agentId, row);
    }
    return { month: period, rates, totalKes: round2(live.reduce((t, f) => t + num(f.amountKes), 0)), byAgent: [...byAgent.values()], fees: fees.map((f) => this.view(f)) };
  }

  /** Replaces the whole price list (rows left out are removed). */
  async setRates(platformAdminId: string, rows: { industryType: string; size: string; minKes: number; maxKes: number }[]) {
    for (const r of rows) {
      if (r.minKes > r.maxKes) throw new BadRequestException(`${r.industryType} ${r.size}: the lowest fee is above the highest`);
    }
    const keys = new Set(rows.map((r) => `${r.industryType}:${r.size}`));
    if (keys.size !== rows.length) throw new BadRequestException('Each business type and size can appear only once');
    await this.prisma.$transaction(async (tx) => {
      await tx.salesSetupFeeRate.deleteMany({ where: { NOT: { OR: rows.map((r) => ({ industryType: r.industryType, size: r.size })) } } });
      for (const r of rows) {
        await tx.salesSetupFeeRate.upsert({
          where: { industryType_size: { industryType: r.industryType, size: r.size } },
          create: { industryType: r.industryType, size: r.size, minKes: r.minKes, maxKes: r.maxKes },
          update: { minKes: r.minKes, maxKes: r.maxKes },
        });
      }
      await tx.platformAuditLog.create({ data: { platformAdminId, action: 'sales_setup_fee.rates', entityType: 'SalesSetupFeeRate' } });
    });
    return this.rates();
  }

  async voidFee(platformAdminId: string, id: string, reason: string) {
    const fee = await this.prisma.salesSetupFee.findUnique({ where: { id } });
    if (!fee) throw new NotFoundException('Setup fee not found');
    if (fee.voidedAt) throw new BadRequestException('This setup fee is already voided');
    const updated = await this.prisma.salesSetupFee.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason.trim() }, include: { agent: { select: { fullName: true } } } });
    await this.prisma.platformAuditLog.create({ data: { platformAdminId, action: 'sales_setup_fee.void', entityType: 'SalesSetupFee', entityId: id, organizationId: fee.organizationId } });
    return this.view(updated);
  }

  private view(f: { id: string; organizationId: string; organizationName: string; agentId: string; industryType: string; size: string; amountKes: Prisma.Decimal; receiptNo: string; note: string | null; receivedAt: Date; voidedAt: Date | null; voidReason: string | null; agent: { fullName: string } }) {
    return {
      id: f.id,
      organizationId: f.organizationId,
      business: f.organizationName,
      agentId: f.agentId,
      agent: f.agent.fullName,
      industryType: f.industryType,
      size: f.size,
      amountKes: num(f.amountKes),
      receiptNo: f.receiptNo,
      note: f.note,
      receivedAt: f.receivedAt,
      voidedAt: f.voidedAt,
      voidReason: f.voidReason,
    };
  }
}
