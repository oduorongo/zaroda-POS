import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SchoolStatus, SupplierSchool } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { generatePin, hashPin } from '../riders/rider-pin.util';
import { CreateSchoolDto, UpdateSchoolDto } from './dto/school-supplier.dto';
import { SchoolLedgerService } from './school-ledger.service';
import { SchoolNotifierService } from './school-notifier.service';

const clean = (v: string | undefined | null) =>
  v === undefined ? undefined : v?.trim() || null;

export function toSchoolView(s: SupplierSchool) {
  return {
    id: s.id,
    name: s.name,
    contactName: s.contactName,
    phone: s.phone,
    email: s.email,
    address: s.address,
    county: s.county,
    creditLimit: s.creditLimit === null ? null : Number(s.creditLimit),
    creditDays: s.creditDays,
    retentionPercent: Number(s.retentionPercent),
    retentionReleaseDays: s.retentionReleaseDays,
    status: s.status,
    hasPin: Boolean(s.pinHash),
    lastLoginAt: s.lastLoginAt,
    notes: s.notes,
    createdAt: s.createdAt,
  };
}

/** The supplier's customer schools: who they are, what they may owe, and the phone number and PIN they sign in with. */
@Injectable()
export class SchoolsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly ledger: SchoolLedgerService,
    private readonly config: ConfigService,
    private readonly notifier: SchoolNotifierService,
  ) {}

  private pinHashFor(pin: string): string {
    return hashPin(pin, this.config.getOrThrow<string>('BUYER_JWT_SECRET'));
  }

  private phoneOrThrow(raw: string): string {
    const phone = normalizeKenyanPhone(raw);
    if (!phone)
      throw new BadRequestException(
        'Enter a valid Kenyan mobile number, e.g. 0712 345 678',
      );
    return phone;
  }

  private duplicate(e: unknown): never {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new ConflictException(
        'Another school already uses that phone number. Each school needs its own sign-in number.',
      );
    }
    throw e;
  }

  async list() {
    return this.tenantPrisma.run(async (tx) => {
      const schools = await tx.supplierSchool.findMany({
        orderBy: { name: 'asc' },
      });
      const balances = await this.ledger.balances(tx);
      return schools.map((s) => {
        const b = balances.get(s.id);
        return {
          ...toSchoolView(s),
          owed: b?.owed ?? 0,
          overdue: b?.overdue ?? 0,
          credit: b?.credit ?? 0,
          openInvoices: b?.openInvoices ?? 0,
        };
      });
    });
  }

  async get(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const school = await tx.supplierSchool.findUnique({ where: { id } });
      if (!school) throw new NotFoundException('School not found');
      const b = (await this.ledger.balances(tx, [id])).get(id);
      return {
        ...toSchoolView(school),
        owed: b?.owed ?? 0,
        overdue: b?.overdue ?? 0,
        credit: b?.credit ?? 0,
        openInvoices: b?.openInvoices ?? 0,
        ageing: b?.ageing ?? null,
      };
    });
  }

  /** Adds a school and a PIN, shown once, for the supplier to pass on to the school's contact person. */
  async create(dto: CreateSchoolDto) {
    const { organizationId } = getTenantStore();
    const pin = generatePin();
    try {
      const school = await this.tenantPrisma.run((tx) =>
        tx.supplierSchool.create({
          data: {
            organizationId,
            name: dto.name.trim(),
            contactName: clean(dto.contactName),
            phone: this.phoneOrThrow(dto.phone),
            email: clean(dto.email)?.toLowerCase(),
            address: clean(dto.address),
            county: clean(dto.county),
            creditLimit: dto.creditLimit,
            creditDays: dto.creditDays ?? 30,
            retentionPercent: dto.retentionPercent ?? 0,
            retentionReleaseDays: dto.retentionReleaseDays ?? 0,
            notes: clean(dto.notes),
            pinHash: this.pinHashFor(pin),
          },
        }),
      );
      return { ...toSchoolView(school), temporaryPin: pin };
    } catch (e) {
      return this.duplicate(e);
    }
  }

  async update(id: string, dto: UpdateSchoolDto) {
    let approved: { school: SupplierSchool; supplier: string; slug?: string } | null = null;
    try {
      const view = await this.tenantPrisma.run(async (tx) => {
        const before = await tx.supplierSchool.findUnique({ where: { id } });
        if (!before) throw new NotFoundException('School not found');
        const school = await tx.supplierSchool.update({
          where: { id },
          data: {
            name: dto.name?.trim(),
            contactName: clean(dto.contactName),
            phone:
              dto.phone === undefined
                ? undefined
                : this.phoneOrThrow(dto.phone),
            email: clean(dto.email)?.toLowerCase(),
            address: clean(dto.address),
            county: clean(dto.county),
            creditLimit: dto.creditLimit,
            creditDays: dto.creditDays,
            retentionPercent: dto.retentionPercent,
            retentionReleaseDays: dto.retentionReleaseDays,
            status: dto.status,
            notes: clean(dto.notes),
          },
        });
        if (before.status === SchoolStatus.PENDING && school.status === SchoolStatus.ACTIVE) {
          const portal = await tx.schoolPortal.findUnique({ where: { organizationId: school.organizationId } });
          const org = await tx.organization.findUnique({ where: { id: school.organizationId }, select: { name: true } });
          approved = { school, supplier: portal?.displayName ?? org?.name ?? 'Your supplier', slug: portal?.slug };
        }
        return toSchoolView(school);
      });
      if (approved) void this.tellApproved(approved);
      return view;
    } catch (e) {
      return this.duplicate(e);
    }
  }

  private async tellApproved({ school, supplier, slug }: { school: SupplierSchool; supplier: string; slug?: string }) {
    const base = (this.config.get<string>('STOREFRONT_BASE_URL') ?? 'https://shop.zarodashop.com').replace(/\/+$/, '');
    const url = slug ? `${base}/schools/${slug}` : undefined;
    await this.notifier.notify(
      { name: school.contactName ?? school.name, phone: school.phone, email: school.email },
      supplier,
      `${school.name} can now order from ${supplier}`,
      `Your school is approved. Sign in${url ? ` at ${url}` : ''} with your phone number and the PIN you chose, and send your orders.`,
      url ? { link: { label: 'Sign in and order', url } } : undefined,
    );
  }

  /** Removes a join request the supplier does not want. A school already approved is suspended instead, never deleted. */
  async declineJoin(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const school = await tx.supplierSchool.findUnique({ where: { id } });
      if (!school) throw new NotFoundException('School not found');
      if (school.status !== SchoolStatus.PENDING)
        throw new BadRequestException(
          'Only a school still asking to join can be turned down. Stop this school ordering instead.',
        );
      await tx.supplierSchool.delete({ where: { id } });
      return { declined: true };
    });
  }

  /** A new PIN (the old one stops working and any lock is cleared). Shown once. */
  async resetPin(id: string) {
    const pin = generatePin();
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.supplierSchool.findUnique({ where: { id } })))
        throw new NotFoundException('School not found');
      const school = await tx.supplierSchool.update({
        where: { id },
        data: {
          pinHash: this.pinHashFor(pin),
          pinFailCount: 0,
          pinLockedUntil: null,
        },
      });
      return { ...toSchoolView(school), temporaryPin: pin };
    });
  }

  async statement(id: string, from?: string, to?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const school = await tx.supplierSchool.findUnique({ where: { id } });
      if (!school) throw new NotFoundException('School not found');
      const [statement, b] = await Promise.all([
        this.ledger.statement(tx, id, from, to),
        this.ledger.balances(tx, [id]),
      ]);
      const balance = b.get(id);
      return {
        school: toSchoolView(school),
        ...statement,
        owed: balance?.owed ?? 0,
        overdue: balance?.overdue ?? 0,
        credit: balance?.credit ?? 0,
        ageing: balance?.ageing ?? null,
      };
    });
  }

  /** Everyone who owes the business money, biggest first, with how late it is. */
  async receivables() {
    return this.tenantPrisma.run(async (tx) => {
      const schools = await tx.supplierSchool.findMany({
        orderBy: { name: 'asc' },
      });
      const balances = await this.ledger.balances(tx);
      const rows = schools
        .map((s) => ({
          schoolId: s.id,
          name: s.name,
          phone: s.phone,
          creditLimit: s.creditLimit === null ? null : Number(s.creditLimit),
          ...(balances.get(s.id) ?? {
            owed: 0,
            overdue: 0,
            credit: 0,
            openInvoices: 0,
            ageing: null,
          }),
        }))
        .filter((r) => r.owed > 0 || r.credit > 0)
        .sort((a, b) => b.owed - a.owed);
      const totals = rows.reduce(
        (t, r) => ({
          owed: t.owed + r.owed,
          overdue: t.overdue + r.overdue,
          credit: t.credit + r.credit,
        }),
        { owed: 0, overdue: 0, credit: 0 },
      );
      return {
        rows,
        totals: {
          owed: Math.round(totals.owed * 100) / 100,
          overdue: Math.round(totals.overdue * 100) / 100,
          credit: Math.round(totals.credit * 100) / 100,
        },
      };
    });
  }
}
