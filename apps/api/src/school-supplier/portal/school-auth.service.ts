import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SchoolStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { normalizeKenyanPhone } from '../../online-orders/online-orders.util';
import { normalizeSlug } from '../../online-store/online-store.constants';
import {
  MAX_PIN_FAILURES,
  PIN_LOCK_MS,
  verifyPin,
} from '../../riders/rider-pin.util';
import { SchoolLoginDto } from '../dto/school-supplier.dto';
import { SchoolJwtPayload } from './school-auth';

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

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
  ) {}

  /** The business behind a portal link, for the sign-in page's heading. Public. */
  async portalInfo(rawSlug: string) {
    const slug = normalizeSlug(rawSlug);
    if (!slug) return null;
    const portal = await this.findPortal(slug);
    return portal ? { displayName: portal.displayName } : null;
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
      if (!school || school.status !== SchoolStatus.ACTIVE)
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
