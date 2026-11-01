import { timingSafeEqual } from 'crypto';
import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ResendEmailProvider } from '../../notifications/resend-email.provider';
import { buildLoginCodeEmail } from '../../online-orders/login-code-email';
import { generateOtpCode, sha256 } from '../../online-orders/online-orders.util';
import { asOrg } from '../common/con-access';

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_WINDOW = 3;
const CODE_WINDOW_MS = 15 * 60_000;

export interface PortalJwtPayload {
  sub: string; // con_portal_users.id
  org: string;
  scope: 'con-portal';
}

/**
 * Portal sign-in for people outside the business: a 6-digit code emailed to the address a builder invited. The answer is the
 * same whether or not the address is known, so the screen cannot be used to find out who works with whom. One email can be
 * invited by several builders; signing in gives one token per builder.
 */
@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: ResendEmailProvider,
    private readonly config: ConfigService,
  ) {}

  private hashCode(email: string, code: string) {
    return sha256(`con-portal:${email}:${code}:${this.config.getOrThrow<string>('BUYER_JWT_SECRET')}`);
  }

  /** The active portal accounts for this email, across builders, through the narrow email-only read rule. */
  private accounts(email: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_portal_email', ${email}, true)`;
      return tx.conPortalUser.findMany({ where: { email, isActive: true }, select: { id: true, organizationId: true, name: true, role: true } });
    });
  }

  async requestCode(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const answer: { sent: true; devCode?: string } = { sent: true };
    if (!(await this.accounts(email)).length) return answer;
    const recent = await this.prisma.conPortalOtp.count({ where: { email, createdAt: { gt: new Date(Date.now() - CODE_WINDOW_MS) } } });
    if (recent >= MAX_CODES_PER_WINDOW) throw new HttpException('Too many codes requested - wait a few minutes and try again', HttpStatus.TOO_MANY_REQUESTS);
    const code = generateOtpCode();
    await this.prisma.conPortalOtp.create({ data: { email, codeHash: this.hashCode(email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
    const { sent } = await this.email.sendEmail({ to: email, ...buildLoginCodeEmail(code, CODE_TTL_MS / 60_000) });
    if (!sent) {
      if (process.env.NODE_ENV === 'production') throw new HttpException('Could not send the email right now - try again shortly', HttpStatus.SERVICE_UNAVAILABLE);
      this.logger.warn(`Portal code not emailed (email not set up). Dev code for ${email}: ${code}`);
      answer.devCode = code;
    }
    return answer;
  }

  async verifyCode(rawEmail: string, code: string) {
    const email = rawEmail.trim().toLowerCase();
    const invalid = new UnauthorizedException('That code is wrong or has expired - request a new one');
    const otp = await this.prisma.conPortalOtp.findFirst({ where: { email, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw invalid;
    await this.prisma.conPortalOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hashCode(email, code.trim()), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid;
    const consumed = await this.prisma.conPortalOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw invalid;

    const accounts = await this.accounts(email);
    if (!accounts.length) throw invalid;
    return {
      accounts: await Promise.all(
        accounts.map(async (a) => {
          const organization = await asOrg(this.prisma, a.organizationId, async (tx) => {
            await tx.conPortalUser.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } });
            return (await tx.organization.findUniqueOrThrow({ where: { id: a.organizationId }, select: { name: true } })).name;
          });
          const payload: PortalJwtPayload = { sub: a.id, org: a.organizationId, scope: 'con-portal' };
          return { token: await this.jwt.signAsync(payload), organization, name: a.name, role: a.role };
        }),
      ),
    };
  }
}
