import { timingSafeEqual } from 'crypto';
import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AfricasTalkingSmsProvider } from '../../notifications/africas-talking-sms.provider';
import { ResendEmailProvider } from '../../notifications/resend-email.provider';
import { buildLoginCodeEmail } from '../../online-orders/login-code-email';
import { generateOtpCode, normalizeKenyanPhone, sha256 } from '../../online-orders/online-orders.util';
import { RentalTenantJwtPayload } from './tenant-auth';

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_WINDOW = 3;
const CODE_WINDOW_MS = 15 * 60_000;

// Pragmatic, not RFC-perfect - whether the address really exists is proven by the code arriving.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Channel = 'EMAIL' | 'SMS';

interface Identity {
  channel: Channel;
  /** Lower-case email, or the phone as 2547XXXXXXXX. This is also what the tenant token carries. */
  identifier: string;
}

/**
 * Tenant sign-in: a 6-digit code sent to the email address OR the mobile number a landlord has on file for them,
 * then a tenant token. A code is only sent (and only stored) when some landlord really has that address or number
 * on a tenant record - but the answer to the caller is the same either way, so nobody can use this screen to find
 * out whose email or phone is a tenant of someone.
 *
 * rental_tenant_otps' `email` column holds the identifier for either channel (an email address or a 2547... number);
 * the two can never collide because one contains an "@" and the other is all digits.
 */
@Injectable()
export class RentalTenantAuthService {
  private readonly logger = new Logger(RentalTenantAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: ResendEmailProvider,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly config: ConfigService,
  ) {}

  /** What the sign-in screen may offer. Email always; text message only when Africa's Talking is configured. */
  methods() {
    return { email: true, sms: this.smsConfigured() };
  }

  private smsConfigured(): boolean {
    return Boolean(this.config.get<string>('AFRICAS_TALKING_API_KEY') && this.config.get<string>('AFRICAS_TALKING_USERNAME'));
  }

  private identify(input: { email?: string; phone?: string }): Identity {
    const hasEmail = Boolean(input.email?.trim());
    const hasPhone = Boolean(input.phone?.trim());
    if (hasEmail === hasPhone) throw new BadRequestException('Give either an email address or a phone number');
    if (hasEmail) {
      const email = input.email!.trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email) || email.length > 200) throw new BadRequestException('Enter a valid email address, e.g. you@example.com');
      return { channel: 'EMAIL', identifier: email };
    }
    const phone = normalizeKenyanPhone(input.phone!);
    if (!phone) throw new BadRequestException('Enter a valid Kenyan mobile number, e.g. 0712 345 678');
    return { channel: 'SMS', identifier: phone };
  }

  // Peppered with the secret and a "rental-tenant" tag, so a leaked table alone can't be brute-forced offline.
  private hashCode(identifier: string, code: string): string {
    return sha256(`rental-tenant:${identifier}:${code}:${this.config.getOrThrow<string>('BUYER_JWT_SECRET')}`);
  }

  /** Is this address or number on any landlord's tenant record? Reads across landlords through the narrow access rules. */
  private async isKnownTenant({ channel, identifier }: Identity): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (channel === 'EMAIL') {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_email', ${identifier}, true)`;
        return (await tx.rentalTenant.count({ where: { email: { equals: identifier, mode: 'insensitive' } } })) > 0;
      }
      await tx.$executeRaw`SELECT set_config('app.current_tenant_phone', ${identifier}, true)`;
      return (await tx.rentalTenant.count({ where: { phoneNormalized: identifier } })) > 0;
    });
  }

  async requestCode(input: { email?: string; phone?: string }) {
    const identity = this.identify(input);
    const { channel, identifier } = identity;
    const answer = { sent: true, channel, identifier };
    if (channel === 'SMS' && !this.smsConfigured() && process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Sign-in by text message is not available yet - please use your email address');
    }
    if (!(await this.isKnownTenant(identity))) return answer;

    const recent = await this.prisma.rentalTenantOtp.count({ where: { email: identifier, createdAt: { gt: new Date(Date.now() - CODE_WINDOW_MS) } } });
    if (recent >= MAX_CODES_PER_WINDOW) {
      throw new HttpException('Too many codes requested - wait a few minutes and try again', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = generateOtpCode();
    await this.prisma.rentalTenantOtp.create({ data: { email: identifier, codeHash: this.hashCode(identifier, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });

    const sent =
      channel === 'EMAIL'
        ? (await this.email.sendEmail({ to: identifier, ...buildLoginCodeEmail(code, CODE_TTL_MS / 60_000) })).sent
        : (await this.sms.sendSms({ to: `+${identifier}`, message: `Your Zaroda rent account code is ${code}. It expires in 5 minutes. Do not share it with anyone.` })).sent;
    if (!sent) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`Code not sent (provider not configured?). Dev tenant login code for ${identifier}: ${code}`);
      } else {
        throw new HttpException(
          channel === 'EMAIL' ? 'Could not send the email right now - try again shortly' : 'Could not send the text message right now - try again shortly',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }
    return answer;
  }

  async verifyCode(input: { email?: string; phone?: string; code: string }) {
    const { identifier } = this.identify(input);
    const otp = await this.prisma.rentalTenantOtp.findFirst({
      where: { email: identifier, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const invalid = new UnauthorizedException('That code is wrong or has expired - request a new one');
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw invalid;

    // Count the attempt before comparing, so parallel guesses can't each see attempts < MAX.
    await this.prisma.rentalTenantOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hashCode(identifier, input.code.trim()), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid;

    // consumedAt: null in the where is the one-time-use guard against two concurrent verifies.
    const consumed = await this.prisma.rentalTenantOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw invalid;

    const payload: RentalTenantJwtPayload = { sub: identifier, scope: 'rental-tenant' };
    return { accessToken: await this.jwt.signAsync(payload), identifier, email: identifier.includes('@') ? identifier : null };
  }
}
