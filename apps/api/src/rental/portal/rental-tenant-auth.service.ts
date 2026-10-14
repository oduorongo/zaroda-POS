import { timingSafeEqual } from 'crypto';
import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ResendEmailProvider } from '../../notifications/resend-email.provider';
import { buildLoginCodeEmail } from '../../online-orders/login-code-email';
import { generateOtpCode, sha256 } from '../../online-orders/online-orders.util';
import { RentalTenantJwtPayload } from './tenant-auth';

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_WINDOW = 3;
const CODE_WINDOW_MS = 15 * 60_000;

/**
 * Tenant sign-in: a 6-digit code emailed to the address a landlord has on file for them, then a tenant token. Like
 * the rider's, with one difference: a code is only sent (and only stored) when some landlord really has that address
 * on a tenant record - but the answer to the caller is the same either way, so nobody can use this screen to find out
 * whose email is a tenant of someone.
 */
@Injectable()
export class RentalTenantAuthService {
  private readonly logger = new Logger(RentalTenantAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: ResendEmailProvider,
    private readonly config: ConfigService,
  ) {}

  // Peppered with the secret and a "rental-tenant" tag, so a leaked table alone can't be brute-forced offline.
  private hashCode(email: string, code: string): string {
    return sha256(`rental-tenant:${email}:${code}:${this.config.getOrThrow<string>('BUYER_JWT_SECRET')}`);
  }

  /** Is this address on any landlord's tenant record? Reads across landlords through the email-only access rule. */
  private async isKnownTenantEmail(email: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_email', ${email}, true)`;
      return (await tx.rentalTenant.count({ where: { email: { equals: email, mode: 'insensitive' } } })) > 0;
    });
  }

  async requestCode(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const answer = { sent: true, email };
    if (!(await this.isKnownTenantEmail(email))) return answer;

    const recent = await this.prisma.rentalTenantOtp.count({ where: { email, createdAt: { gt: new Date(Date.now() - CODE_WINDOW_MS) } } });
    if (recent >= MAX_CODES_PER_WINDOW) {
      throw new HttpException('Too many codes requested - wait a few minutes and try again', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = generateOtpCode();
    await this.prisma.rentalTenantOtp.create({ data: { email, codeHash: this.hashCode(email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });

    const result = await this.email.sendEmail({ to: email, ...buildLoginCodeEmail(code, CODE_TTL_MS / 60_000) });
    if (!result.sent) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`Code not sent (provider not configured?). Dev tenant login code for ${email}: ${code}`);
      } else {
        throw new HttpException('Could not send the email right now - try again shortly', HttpStatus.SERVICE_UNAVAILABLE);
      }
    }
    return answer;
  }

  async verifyCode(rawEmail: string, rawCode: string) {
    const email = rawEmail.trim().toLowerCase();
    const otp = await this.prisma.rentalTenantOtp.findFirst({
      where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const invalid = new UnauthorizedException('That code is wrong or has expired - request a new one');
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw invalid;

    // Count the attempt before comparing, so parallel guesses can't each see attempts < MAX.
    await this.prisma.rentalTenantOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hashCode(email, rawCode.trim()), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid;

    // consumedAt: null in the where is the one-time-use guard against two concurrent verifies.
    const consumed = await this.prisma.rentalTenantOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw invalid;

    const payload: RentalTenantJwtPayload = { sub: email, scope: 'rental-tenant' };
    return { accessToken: await this.jwt.signAsync(payload), email };
  }
}
