import { timingSafeEqual } from 'crypto';
import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma/prisma.service';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { buildLoginCodeEmail } from '../online-orders/login-code-email';
import { generateOtpCode, sha256 } from '../online-orders/online-orders.util';
import { RiderJwtPayload } from './rider-auth';
import { toRiderView } from './riders.service';

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_WINDOW = 3;
const CODE_WINDOW_MS = 15 * 60_000;

/**
 * Rider sign-in: a 6-digit code by email, then a rider token. Same shape as the shopper's
 * (BuyerAuthService), email only for now. A rider row is created on the first successful
 * verification - for a self-signed-up rider it starts as PENDING with an empty profile; a
 * rider a business added already has a row and simply signs in.
 */
@Injectable()
export class RiderAuthService {
  private readonly logger = new Logger(RiderAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: ResendEmailProvider,
    private readonly config: ConfigService,
  ) {}

  // Peppered with the secret and a "rider" tag, so a leaked rider_otps table alone can't be brute-forced offline.
  private hashCode(email: string, code: string): string {
    return sha256(`rider:${email}:${code}:${this.config.getOrThrow<string>('BUYER_JWT_SECRET')}`);
  }

  async requestCode(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const recent = await this.prisma.riderOtp.count({ where: { email, createdAt: { gt: new Date(Date.now() - CODE_WINDOW_MS) } } });
    if (recent >= MAX_CODES_PER_WINDOW) {
      throw new HttpException('Too many codes requested - wait a few minutes and try again', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = generateOtpCode();
    await this.prisma.riderOtp.create({ data: { email, codeHash: this.hashCode(email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });

    const result = await this.email.sendEmail({ to: email, ...buildLoginCodeEmail(code, CODE_TTL_MS / 60_000) });
    if (!result.sent) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`Code not sent (provider not configured?). Dev rider login code for ${email}: ${code}`);
      } else {
        throw new HttpException('Could not send the email right now - try again shortly', HttpStatus.SERVICE_UNAVAILABLE);
      }
    }
    return { sent: true, email };
  }

  async verifyCode(rawEmail: string, rawCode: string) {
    const email = rawEmail.trim().toLowerCase();
    const otp = await this.prisma.riderOtp.findFirst({
      where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const invalid = new UnauthorizedException('That code is wrong or has expired - request a new one');
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw invalid;

    // Count the attempt before comparing, so parallel guesses can't each see attempts < MAX.
    await this.prisma.riderOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hashCode(email, rawCode.trim()), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid;

    // consumedAt: null in the where is the one-time-use guard against two concurrent verifies.
    const consumed = await this.prisma.riderOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw invalid;

    const rider = await this.prisma.rider.upsert({
      where: { email },
      create: { email, lastLoginAt: new Date() },
      update: { lastLoginAt: new Date() },
    });
    const payload: RiderJwtPayload = { sub: rider.id, scope: 'rider' };
    return { accessToken: await this.jwt.signAsync(payload), rider: toRiderView(rider) };
  }
}
