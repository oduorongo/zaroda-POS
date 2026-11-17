import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, SchoolStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { tenantContext } from '../../common/tenant/tenant-context';
import { normalizeKenyanPhone } from '../../online-orders/online-orders.util';
import { normalizeSlug } from '../../online-store/online-store.constants';
import {
  hashPin,
  MAX_PIN_FAILURES,
  PIN_LOCK_MS,
  verifyPin,
} from '../../riders/rider-pin.util';
import { SchoolJoinDto, SchoolLoginDto } from '../dto/school-supplier.dto';
import { SchoolOrdersService } from '../school-orders.service';
import { SchoolJwtPayload } from './school-auth';

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

const SHORT_FORMS: Record<string, string> = {
  sch: 'school',
  schl: 'school',
  sec: 'secondary',
  secondry: 'secondary',
  pri: 'primary',
  prim: 'primary',
  pry: 'primary',
  acad: 'academy',
  hs: 'high school',
  sss: 'secondary school',
  st: 'saint',
};

/** A school's name reduced so "St. Mary's Girls Sec. Sch." and "st marys girls secondary" count as the same school ("school" itself is ignored). */
export function schoolNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .flatMap((w) => (SHORT_FORMS[w] ?? w).split(' '))
    .filter((w) => w && w !== 'the' && w !== 'school')
    .join(' ');
}

/**
 * School sign-in: the portal's link name, the contact's phone number and the PIN the supplier gave them. Like the rider PIN
 * it is only safe because guesses are rationed: 5 wrong PINs lock that school's sign-in for 15 minutes. Unknown link, unknown
 * number and wrong PIN all get the same answer, so the screen cannot be used to find out who is a customer of whom.
 */
@Injectable()
export class SchoolAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly orders: SchoolOrdersService,
  ) {}

  /** The business behind a portal link, for the sign-in page's heading. Public. */
  async portalInfo(rawSlug: string) {
    const slug = normalizeSlug(rawSlug);
    if (!slug) return null;
    const portal = await this.findPortal(slug);
    return portal
      ? { displayName: portal.displayName, joinEnabled: portal.joinEnabled }
      : null;
  }

  /**
   * A school asks to join this supplier from the joining link. It waits as PENDING (no sign-in, no orders) until the
   * supplier approves it and sets its credit terms. Each supplier keeps its own record, so the same school, email and
   * phone can join any number of suppliers.
   */
  async join(dto: SchoolJoinDto) {
    const slug = normalizeSlug(dto.slug);
    const portal = slug ? await this.findPortal(slug) : null;
    if (!portal || !portal.joinEnabled)
      throw new NotFoundException(
        'This joining link is not working. Ask your supplier for a new one.',
      );
    const phone = normalizeKenyanPhone(dto.phone);
    if (!phone)
      throw new BadRequestException(
        'Enter a valid Kenyan mobile number, e.g. 0712 345 678',
      );
    const pepper = this.config.getOrThrow<string>('BUYER_JWT_SECRET');
    const name = dto.name.trim();
    const email = dto.email.trim().toLowerCase();

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${portal.organizationId}, true)`;
      const existing = await tx.supplierSchool.findUnique({
        where: {
          organizationId_phone: {
            organizationId: portal.organizationId,
            phone,
          },
        },
        select: { status: true },
      });
      if (existing) return { kind: 'phone' as const, status: existing.status };
      // one join at a time per supplier, so two forms for the same school cannot both get in
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`school-join:${portal.organizationId}`}))`;
      const key = schoolNameKey(name);
      const twin = (
        await tx.supplierSchool.findMany({ select: { name: true, status: true } })
      ).find((s) => schoolNameKey(s.name) === key);
      if (twin) return { kind: 'name' as const, status: twin.status, name: twin.name };
      await tx.supplierSchool.create({
        data: {
          organizationId: portal.organizationId,
          name,
          contactName: dto.contactName.trim(),
          phone,
          email,
          address: dto.address?.trim() || null,
          county: dto.county?.trim() || null,
          notes: dto.notes?.trim() ? `From the joining form: ${dto.notes.trim()}` : null,
          status: SchoolStatus.PENDING,
          pinHash: hashPin(dto.pin, pepper),
        },
      });
      return null;
    }, TX_OPTIONS);

    if (created?.kind === 'phone')
      throw new ConflictException(
        created.status === SchoolStatus.PENDING
          ? `This phone number has already asked to join ${portal.displayName}. They will approve it soon.`
          : `This phone number is already registered with ${portal.displayName}. Sign in with it, or ask them for a new PIN.`,
      );
    if (created?.kind === 'name')
      throw new ConflictException(
        created.status === SchoolStatus.PENDING
          ? `"${created.name}" has already asked to join ${portal.displayName} and is waiting for approval. There is no need to fill in the form again.`
          : `"${created.name}" is already registered with ${portal.displayName}. Sign in with the phone number your school used, or ask ${portal.displayName} to change the contact or give you a new PIN.`,
      );

    void tenantContext.run(
      {
        organizationId: portal.organizationId,
        orgUserId: 'school-join',
        role: Role.CASHIER,
      },
      () =>
        this.orders
          .tellStaff(
            `New school asking to join: ${name}`,
            `${name} (${dto.contactName.trim()}, ${dto.phone.trim()}, ${email}) filled in your school joining form. Open Schools to approve it and set its credit terms.`,
            undefined,
            { path: 'schools', label: 'Open Schools' },
          )
          .catch(() => undefined),
    );
    return { supplierName: portal.displayName, status: 'PENDING' as const };
  }

  private findPortal(slug: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.public_school_portal', 'on', true)`;
      return tx.schoolPortal.findUnique({ where: { slug } });
    }, TX_OPTIONS);
  }

  async login(dto: SchoolLoginDto) {
    const invalid = new UnauthorizedException(
      'The link, phone number or PIN is not right. Check them, or ask your supplier.',
    );
    const slug = normalizeSlug(dto.slug);
    const phone = normalizeKenyanPhone(dto.phone);
    if (!slug || !phone) throw invalid;
    const portal = await this.findPortal(slug);
    if (!portal) throw invalid;
    const pepper = this.config.getOrThrow<string>('BUYER_JWT_SECRET');

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${portal.organizationId}, true)`;
      const school = await tx.supplierSchool.findUnique({
        where: {
          organizationId_phone: {
            organizationId: portal.organizationId,
            phone,
          },
        },
      });
      if (!school || school.status === SchoolStatus.SUSPENDED)
        return { kind: 'invalid' as const };
      if (school.pinLockedUntil && school.pinLockedUntil > new Date())
        return { kind: 'locked' as const };

      if (!verifyPin(dto.pin, school.pinHash, pepper)) {
        const failures = school.pinFailCount + 1;
        const lock = failures >= MAX_PIN_FAILURES;
        await tx.supplierSchool.update({
          where: { id: school.id },
          data: {
            pinFailCount: lock ? 0 : failures,
            pinLockedUntil: lock ? new Date(Date.now() + PIN_LOCK_MS) : null,
          },
        });
        return { kind: lock ? ('locked' as const) : ('invalid' as const) };
      }
      // only someone who knows the PIN learns the request is still waiting
      if (school.status === SchoolStatus.PENDING)
        return { kind: 'pending' as const };
      await tx.supplierSchool.update({
        where: { id: school.id },
        data: {
          pinFailCount: 0,
          pinLockedUntil: null,
          lastLoginAt: new Date(),
        },
      });
      return { kind: 'ok' as const, school };
    }, TX_OPTIONS);

    if (outcome.kind === 'locked') {
      throw new HttpException(
        'Too many wrong PINs. Wait 15 minutes and try again, or ask your supplier for a new PIN.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (outcome.kind === 'invalid') throw invalid;
    if (outcome.kind === 'pending')
      throw new ForbiddenException(
        `${portal.displayName} has not approved your school yet. You can sign in as soon as they do.`,
      );

    const payload: SchoolJwtPayload = {
      sub: outcome.school.id,
      org: portal.organizationId,
      scope: 'school',
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      school: {
        id: outcome.school.id,
        name: outcome.school.name,
        contactName: outcome.school.contactName,
      },
      supplierName: portal.displayName,
    };
  }
}
