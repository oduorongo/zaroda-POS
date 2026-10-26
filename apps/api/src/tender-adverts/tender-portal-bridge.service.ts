import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SchoolStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { hashPin } from '../riders/rider-pin.util';
import { SchoolIdentity } from '../school-supplier/portal/school-auth';
import { TenderBuyerAuthService } from './tender-buyer-auth.service';

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

/**
 * Lets a school that signs in to its supplier's ordering portal post tender adverts from there, without a second sign-in. The
 * school gets a tender account of its own (made once, from the details its supplier holds), which goes through the same
 * approval by the platform owner as any other school, and its adverts are exactly the same adverts. The account never signs in on
 * the tender page (its PIN is random and unknowable): the portal's own sign-in is what proves who the school is.
 */
@Injectable()
export class TenderPortalBridgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: TenderBuyerAuthService,
  ) {}

  /** The tender account standing for this school, if it has been made. */
  async find(who: SchoolIdentity) {
    const b = await this.prisma.tenderBuyer.findUnique({
      where: { supplierSchoolId: who.schoolId },
    });
    return b ? this.auth.view(b) : null;
  }

  /** The id of the tender account, for the adverts calls. The school must have set it up (and still be an active customer). */
  async buyerId(who: SchoolIdentity): Promise<string> {
    const b = await this.prisma.tenderBuyer.findUnique({
      where: { supplierSchoolId: who.schoolId },
      select: { id: true },
    });
    if (!b)
      throw new NotFoundException(
        'Open the Tender adverts tab first to set up tender adverts for your school.',
      );
    return b.id;
  }

  /** Makes the school's tender account from its supplier's record of it, once. Safe to call again. */
  async ensure(who: SchoolIdentity) {
    const existing = await this.find(who);
    if (existing) return existing;
    const school = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${who.organizationId}, true)`;
      return tx.supplierSchool.findUnique({ where: { id: who.schoolId } });
    }, TX_OPTIONS);
    if (!school || school.status !== SchoolStatus.ACTIVE)
      throw new UnauthorizedException('This account is no longer active.');
    const pepper = this.config.getOrThrow<string>('BUYER_JWT_SECRET');
    try {
      const b = await this.prisma.tenderBuyer.create({
        data: {
          name: school.name,
          contactName: school.contactName ?? school.name,
          phone: school.phone,
          email: school.email?.toLowerCase() ?? null,
          county: school.county ?? 'Kenya',
          // never usable to sign in on the tender page: the portal sign-in is what identifies this school
          pinHash: hashPin(randomBytes(16).toString('hex'), pepper),
          supplierSchoolId: who.schoolId,
          supplierOrgId: who.organizationId,
        },
      });
      return this.auth.view(b);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException(
          'A tender account with your phone number already exists. Sign in with it at shop.zarodashop.com/tenders.',
        );
      throw e;
    }
  }
}
