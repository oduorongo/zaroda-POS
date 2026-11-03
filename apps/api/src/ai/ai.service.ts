import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SaleStatus } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { variantTitle } from '../catalog/variant-title';
import { addDays, dayStart, nairobiDayOf } from '../reports/profit.util';
import {
  accessProblem,
  cleanQuestion,
  nextWeeklyAt,
  QUESTIONS_PER_DAY,
  snapshotText,
  SYSTEM_PROMPT,
  WEEKLY_INSTRUCTION,
} from './ai.util';

const DEFAULT_MODEL = 'claude-opus-5-5';
const round2 = (n: number) => Math.round(n * 100) / 100;
const n = (v: unknown) => Number(v ?? 0);

/**
 * The AI Business Analyser: a weekly written summary of the business and an "ask about my business" box. Only a summary of the
 * business's own figures (totals, product names and quantities) is sent to Claude - never customers' names, phones or PINs.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client: Anthropic | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly config: ConfigService,
  ) {}

  private get model(): string {
    return this.config.get<string>('AI_MODEL') ?? DEFAULT_MODEL;
  }

  private anthropic(): Anthropic {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) throw new ServiceUnavailableException('The AI Business Analyser is not switched on yet. Please try again later.');
    this.client ??= new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
    return this.client;
  }

  private async access() {
    const { organizationId } = getTenantStore();
    const sub = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: { select: { billingCycle: true, priceKes: true } } },
    });
    return accessProblem(sub);
  }

  /** What the screen shows: the latest weekly summary, recent questions, and what is left of today's questions. */
  async overview() {
    const problem = await this.access();
    const since = dayStart(nairobiDayOf(new Date()));
    const [weekly, questions, usedToday] = await this.tenantPrisma.run((tx) =>
      Promise.all([
        tx.aiInsight.findFirst({ where: { kind: 'WEEKLY' }, orderBy: { createdAt: 'desc' } }),
        tx.aiInsight.findMany({ where: { kind: 'QUESTION' }, orderBy: { createdAt: 'desc' }, take: 20 }),
        tx.aiInsight.count({ where: { kind: 'QUESTION', createdAt: { gte: since } } }),
      ]),
    );
    return {
      available: problem === null && !!this.config.get<string>('ANTHROPIC_API_KEY'),
      problem: problem ?? (this.config.get<string>('ANTHROPIC_API_KEY') ? null : 'The AI Business Analyser is not switched on yet.'),
      weekly: weekly && { answer: weekly.answer, createdAt: weekly.createdAt },
      nextWeeklyAt: nextWeeklyAt(weekly?.createdAt ?? null),
      questions: questions.map((q) => ({ id: q.id, question: q.question, answer: q.answer, createdAt: q.createdAt })),
      questionsLeft: Math.max(0, QUESTIONS_PER_DAY - usedToday),
      questionsPerDay: QUESTIONS_PER_DAY,
    };
  }

  /** Writes this week's summary (once every 7 days). */
  async weekly() {
    const problem = await this.access();
    if (problem) throw new ForbiddenException(problem);
    const last = await this.tenantPrisma.run((tx) =>
      tx.aiInsight.findFirst({ where: { kind: 'WEEKLY' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    );
    const next = nextWeeklyAt(last?.createdAt ?? null);
    if (next) throw new BadRequestException(`This week's summary is already written. The next one can be made on ${next.toDateString()}.`);
    const snapshot = await this.snapshot();
    const r = await this.callClaude(snapshot, WEEKLY_INSTRUCTION);
    return this.save('WEEKLY', null, r);
  }

  /** Answers an owner's question about the business (a few a day, by plan). */
  async ask(raw: string) {
    const problem = await this.access();
    if (problem) throw new ForbiddenException(problem);
    const question = cleanQuestion(raw);
    if (!question) throw new BadRequestException('Type a question first.');
    const since = dayStart(nairobiDayOf(new Date()));
    const used = await this.tenantPrisma.run((tx) =>
      tx.aiInsight.count({ where: { kind: 'QUESTION', createdAt: { gte: since } } }),
    );
    if (used >= QUESTIONS_PER_DAY)
      throw new HttpException(`You have used today's ${QUESTIONS_PER_DAY} questions. Ask again tomorrow.`, HttpStatus.TOO_MANY_REQUESTS);
    const snapshot = await this.snapshot();
    const r = await this.callClaude(snapshot, `The owner asks: ${question}`);
    return this.save('QUESTION', question, r);
  }

  private async save(kind: 'WEEKLY' | 'QUESTION', question: string | null, r: { answer: string; inputTokens: number; outputTokens: number }) {
    const { organizationId, orgUserId } = getTenantStore();
    const row = await this.tenantPrisma.run((tx) =>
      tx.aiInsight.create({
        data: { organizationId, kind, question, answer: r.answer, model: this.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, askedById: orgUserId },
      }),
    );
    return { id: row.id, question: row.question, answer: row.answer, createdAt: row.createdAt };
  }

  private async callClaude(snapshot: unknown, instruction: string) {
    const client = this.anthropic();
    try {
      const response = await client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        // the instructions and today's figures are the same for every question asked today, so they are cached
        system: [
          { type: 'text', text: SYSTEM_PROMPT },
          { type: 'text', text: snapshotText(snapshot), cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: instruction }],
      });
      if (response.stop_reason === 'refusal')
        throw new BadRequestException('The analyser could not answer that. Try asking it another way.');
      const answer = response.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
      if (!answer) throw new ServiceUnavailableException('The analyser did not answer. Please try again.');
      const u = response.usage;
      return {
        answer,
        inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
      };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      if (e instanceof Anthropic.RateLimitError)
        throw new ServiceUnavailableException('The analyser is busy right now. Please try again in a minute.');
      if (e instanceof Anthropic.AuthenticationError) {
        this.logger.error('ANTHROPIC_API_KEY was refused');
        throw new ServiceUnavailableException('The AI Business Analyser is not switched on yet. Please try again later.');
      }
      if (e instanceof Anthropic.APIError) {
        this.logger.error({ status: e.status, message: e.message }, 'Claude request failed');
        throw new ServiceUnavailableException('The analyser could not be reached. Please try again.');
      }
      throw e;
    }
  }

  /** The figures Claude reads: this week against last, products, stock not selling, low stock, busy hours and spending. */
  async snapshot() {
    const { organizationId } = getTenantStore();
    const today = nairobiDayOf(new Date());
    const weekStart = addDays(today, -6);
    const from45 = dayStart(addDays(today, -44));
    const from30 = dayStart(addDays(today, -29));
    const from14 = dayStart(addDays(today, -13));
    const from7 = dayStart(weekStart);

    const [org, branches, sales, inventory, expenses] = await this.tenantPrisma.run((tx) =>
      Promise.all([
        tx.organization.findUnique({ where: { id: organizationId }, select: { name: true, industryType: true } }),
        tx.branch.findMany({ select: { id: true, name: true } }),
        tx.sale.findMany({
          where: { status: SaleStatus.COMPLETED, createdAt: { gte: from45 } },
          select: {
            createdAt: true,
            total: true,
            branchId: true,
            lineItems: {
              select: {
                variantId: true,
                quantity: true,
                unitPrice: true,
                taxAmount: true,
                variant: { select: { name: true, cost: true, product: { select: { name: true } } } },
                ingredients: { select: { quantity: true, ingredientVariant: { select: { cost: true } } } },
              },
            },
          },
        }),
        tx.inventoryItem.findMany({
          where: { quantity: { gt: 0 } },
          select: {
            quantity: true,
            lowStockThreshold: true,
            branchId: true,
            variant: { select: { id: true, name: true, cost: true, product: { select: { name: true } } } },
          },
          take: 5000,
        }),
        tx.expense.groupBy({ by: ['category'], where: { spentOn: { gte: from30 } }, _sum: { amount: true } }),
      ]),
    );
    const branchName = new Map(branches.map((b) => [b.id, b.name]));

    const days = new Map<string, { sales: number; revenue: number }>();
    for (let i = 0; i < 7; i++) days.set(addDays(weekStart, i), { sales: 0, revenue: 0 });
    const lastWeek = { sales: 0, revenue: 0 };
    const byBranch = new Map<string, { sales: number; revenue: number }>();
    const hours = new Map<number, { sales: number; revenue: number }>();
    const products = new Map<string, { name: string; qty: number; revenue: number; cost: number | null }>();
    const lastSold = new Map<string, Date>();

    for (const s of sales) {
      const total = n(s.total);
      for (const l of s.lineItems) {
        const prev = lastSold.get(l.variantId);
        if (!prev || prev < s.createdAt) lastSold.set(l.variantId, s.createdAt);
      }
      if (s.createdAt >= from7) {
        const d = days.get(nairobiDayOf(s.createdAt));
        if (d) {
          d.sales += 1;
          d.revenue += total;
        }
        const b = byBranch.get(s.branchId) ?? { sales: 0, revenue: 0 };
        b.sales += 1;
        b.revenue += total;
        byBranch.set(s.branchId, b);
      } else if (s.createdAt >= from14) {
        lastWeek.sales += 1;
        lastWeek.revenue += total;
      }
      if (s.createdAt < from30) continue;
      const hour = (s.createdAt.getUTCHours() + 3) % 24;
      const h = hours.get(hour) ?? { sales: 0, revenue: 0 };
      h.sales += 1;
      h.revenue += total;
      hours.set(hour, h);
      for (const l of s.lineItems) {
        const qty = n(l.quantity);
        const recipe = l.ingredients.length > 0;
        const known = recipe ? l.ingredients.every((i) => i.ingredientVariant.cost !== null) : l.variant.cost !== null;
        const cost = recipe ? l.ingredients.reduce((t, i) => t + n(i.quantity) * n(i.ingredientVariant.cost), 0) : n(l.variant.cost) * qty;
        const p = products.get(l.variantId) ?? { name: variantTitle(l.variant.product.name, l.variant.name), qty: 0, revenue: 0, cost: 0 };
        p.qty += qty;
        p.revenue += n(l.unitPrice) * qty + n(l.taxAmount);
        p.cost = p.cost === null || !known ? null : p.cost + cost;
        products.set(l.variantId, p);
      }
    }

    const productRows = [...products.values()].map((p) => ({
      name: p.name,
      sold: round2(p.qty),
      salesKes: round2(p.revenue),
      grossProfitKes: p.cost === null ? null : round2(p.revenue - p.cost),
      marginPct: p.cost === null || p.revenue <= 0 ? null : round2(((p.revenue - p.cost) / p.revenue) * 100),
    }));
    const notSelling = inventory
      .filter((i) => {
        const last = lastSold.get(i.variant.id);
        return !last || last < from45;
      })
      .map((i) => ({
        name: variantTitle(i.variant.product.name, i.variant.name),
        branch: branchName.get(i.branchId) ?? null,
        inStock: round2(n(i.quantity)),
        stockValueKes: i.variant.cost === null ? null : round2(n(i.quantity) * n(i.variant.cost)),
      }))
      .sort((a, b) => (b.stockValueKes ?? 0) - (a.stockValueKes ?? 0));
    const lowStock = inventory
      .filter((i) => n(i.lowStockThreshold) > 0 && n(i.quantity) <= n(i.lowStockThreshold))
      .map((i) => ({
        name: variantTitle(i.variant.product.name, i.variant.name),
        branch: branchName.get(i.branchId) ?? null,
        inStock: round2(n(i.quantity)),
        reorderAt: round2(n(i.lowStockThreshold)),
      }))
      .slice(0, 15);

    return {
      business: { name: org?.name ?? '', type: org?.industryType ?? '' },
      today,
      thisWeek: {
        from: weekStart,
        to: today,
        sales: [...days.values()].reduce((t, d) => t + d.sales, 0),
        salesKes: round2([...days.values()].reduce((t, d) => t + d.revenue, 0)),
        byDay: [...days.entries()].map(([day, d]) => ({ day, sales: d.sales, salesKes: round2(d.revenue) })),
      },
      lastWeek: { sales: lastWeek.sales, salesKes: round2(lastWeek.revenue) },
      branchesThisWeek:
        branches.length > 1
          ? [...byBranch.entries()].map(([id, b]) => ({ branch: branchName.get(id) ?? id, sales: b.sales, salesKes: round2(b.revenue) }))
          : undefined,
      last30Days: {
        bestSellers: [...productRows].sort((a, b) => b.salesKes - a.salesKes).slice(0, 12),
        lowestMargin: productRows
          .filter((p) => p.marginPct !== null && p.salesKes > 0)
          .sort((a, b) => (a.marginPct as number) - (b.marginPct as number))
          .slice(0, 6),
        productsWithoutCost: productRows.filter((p) => p.grossProfitKes === null).length,
        busiestHours: [...hours.entries()]
          .sort((a, b) => b[1].revenue - a[1].revenue)
          .slice(0, 5)
          .map(([hour, h]) => ({ hour: `${String(hour).padStart(2, '0')}:00`, sales: h.sales, salesKes: round2(h.revenue) })),
        expensesKes: round2(expenses.reduce((t, e) => t + n(e._sum.amount), 0)),
        expensesByCategory: expenses
          .map((e) => ({ category: e.category, kes: round2(n(e._sum.amount)) }))
          .sort((a, b) => b.kes - a.kes),
      },
      stockNotSoldIn45Days: {
        items: notSelling.length,
        valueKes: round2(notSelling.reduce((t, i) => t + (i.stockValueKes ?? 0), 0)),
        biggest: notSelling.slice(0, 15),
      },
      lowStock,
    };
  }
}
