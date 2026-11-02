import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Tx, asOrg } from '../common/con-access';
import { monthKey } from '../reports/reports.util';
import { payoutFee } from './con-addons.util';

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** Pay-as-you-go use: SMS credits spent by payslips and alerts, and ZARODA's fee on each M-Pesa wage payout. */
@Injectable()
export class ConUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /** Takes credits for a text. None left: nothing is sent, and the business gets one in-app alert a day to top up. */
  async takeSms(organizationId: string, parts: number): Promise<boolean> {
    return asOrg(this.prisma, organizationId, async (tx) => {
      const taken = await tx.conSubscription.updateMany({ where: { organizationId, smsCredits: { gte: parts } }, data: { smsCredits: { decrement: parts } } });
      if (taken.count) return true;
      await tx.conAlert.createMany({
        data: [{ organizationId, kind: 'SMS_EMPTY', title: 'Your SMS credit has run out', body: 'Payslips and alerts are not being texted. Buy an SMS bundle under Plan to start again.', href: '/construction/plan', dedupeKey: `sms-empty:${new Date().toISOString().slice(0, 10)}` }],
        skipDuplicates: true,
      });
      return false;
    });
  }

  /** Gives credits back when the text could not be sent. */
  returnSms(organizationId: string, parts: number) {
    return asOrg(this.prisma, organizationId, (tx) => tx.conSubscription.updateMany({ where: { organizationId }, data: { smsCredits: { increment: parts } } }));
  }

  /** ZARODA's fee for a wage paid by M-Pesa, once per payroll line. */
  async chargePayout(tx: Tx, organizationId: string, line: { id: string; net: Prisma.Decimal | number }, projectId: string, now: Date = new Date()) {
    const bands = await tx.conPayoutFeeBand.findMany();
    const fee = payoutFee(bands.map((b) => ({ upTo: b.upTo === null ? null : n(b.upTo), darajaCost: n(b.darajaCost), markup: n(b.markup) })), n(line.net));
    if (fee.amount <= 0) return;
    await tx.conFeeCharge.createMany({
      data: [{ organizationId, kind: 'PAYOUT', sourceId: `payout:${line.id}`, projectId, amount: fee.amount, darajaCost: fee.darajaCost, markup: fee.markup, description: `M-Pesa wage payout of KES ${n(line.net).toLocaleString('en-KE')}`, periodMonth: monthKey(now) }],
      skipDuplicates: true,
    });
  }

  /** Rolls each finished month's fees into that month's invoice (an unpaid one takes late charges too). */
  async closeMonths(tx: Tx, organizationId: string, now: Date = new Date()) {
    const open = await tx.conFeeCharge.findMany({ where: { invoiceId: null, periodMonth: { lt: monthKey(now) } }, select: { periodMonth: true } });
    for (const periodMonth of [...new Set(open.map((c) => c.periodMonth))]) {
      const invoice = await tx.conFeeInvoice.upsert({ where: { organizationId_periodMonth: { organizationId, periodMonth } }, create: { organizationId, periodMonth, total: 0 }, update: {} });
      if (invoice.status !== 'UNPAID') continue;
      await tx.conFeeCharge.updateMany({ where: { invoiceId: null, periodMonth }, data: { invoiceId: invoice.id } });
      const total = await tx.conFeeCharge.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } });
      await tx.conFeeInvoice.update({ where: { id: invoice.id }, data: { total: n(total._sum.amount) } });
    }
  }
}
