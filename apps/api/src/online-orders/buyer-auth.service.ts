import { timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma/prisma.service';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { BuyerJwtPayload } from './buyer-auth';
import { generateOtpCode, normalizeKenyanPhone, sha256 } from './online-orders.util';

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
// Per phone number, on top of the per-IP controller throttle - stops
// someone using Zaroda to spam a victim's phone with codes.
const MAX_CODES_PER_WINDOW = 3;
const CODE_WINDOW_MS = 15 * 60_000;

/**
 * Phone-number login for buyers: request a 6-digit SMS code, then verify
 * it for a buyer JWT. A buyer account is created on first successful
 * verification - there's no separate sign-up step.
 *
 * buyers/buyer_otps carry no RLS (see rls.sql), so this uses the plain
 * PrismaService and only ever looks rows up by the phone being verified.
 */
@Injectable()
export class BuyerAuthService {
  private readonly logger = new Logger(BuyerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly config: ConfigService,
  ) {}

  private requirePhone(input: string): string {
    const phone = normalizeKenyanPhone(input);
    if (!phone) throw new BadRequestException('Enter a valid Kenyan mobile number, e.g. 0712 345 678');
    return phone;
  }

  // Peppered with the buyer JWT secret, so a leaked buyer_otps table alone
  // can't be brute-forced offline (a 6-digit code has only 1M values).
  private hashCode(phone: string, code: string): string {
    return sha256(`${phone}:${code}:${this.config.getOrThrow<string>('BUYER_JWT_SECRET')}`);
  }

  async requestCode(phoneInput: string) {
    const phone = this.requirePhone(phoneInput);
    const recent = await this.prisma.buyerOtp.count({
      where: { phone, createdAt: { gt: new Date(Date.now() - CODE_WINDOW_MS) } },
    });
    if (recent >= MAX_CODES_PER_WINDOW) {
      throw new HttpException('Too many codes requested - wait a few minutes and try again', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = generateOtpCode();
    await this.prisma.buyerOtp.create({
      data: { phone, codeHash: this.hashCode(phone, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });
    const result = await this.sms.sendSms({
      to: `+${phone}`,
      message: `Your Zaroda code is ${code}. It expires in 5 minutes. Don't share it with anyone.`,
    });
    if (!result.sent) {
      if (process.env.NODE_ENV !== 'production') {
        // Local development without SMS credentials - the only way to log in.
        this.logger.warn(`SMS not sent (provider not configured?). Dev login code for ${phone}: ${code}`);
      } else {
        throw new HttpException('Could not send the SMS right now - try again shortly', HttpStatus.SERVICE_UNAVAILABLE);
      }
    }
    return { sent: true, phone };
  }

  async verifyCode(phoneInput: string, code: string) {
    const phone = this.requirePhone(phoneInput);
    const otp = await this.prisma.buyerOtp.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const invalid = new UnauthorizedException('That code is wrong or has expired - request a new one');
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw invalid;

    // Count the attempt before comparing, so parallel guesses can't each
    // see attempts < MAX and all get a free try.
    await this.prisma.buyerOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hashCode(phone, code.trim()), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid;

    // updateMany with consumedAt: null is the one-time-use guard - two
    // concurrent verifies of the same code can't both succeed.
    const consumed = await this.prisma.buyerOtp.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw invalid;

    const buyer = await this.prisma.buyer.upsert({ where: { phone }, create: { phone }, update: {} });
    const payload: BuyerJwtPayload = { sub: buyer.id, scope: 'buyer' };
    return { accessToken: await this.jwt.signAsync(payload), buyer: this.toView(buyer) };
  }

  async getMe(buyerId: string) {
    const buyer = await this.prisma.buyer.findUnique({ where: { id: buyerId } });
    if (!buyer) throw new UnauthorizedException();
    return this.toView(buyer);
  }

  async updateMe(buyerId: string, name: string | undefined) {
    const buyer = await this.prisma.buyer.update({
      where: { id: buyerId },
      data: { name: name === undefined ? undefined : name.trim() || null },
    });
    return this.toView(buyer);
  }

  private toView(buyer: { id: string; phone: string; name: string | null }) {
    return { id: buyer.id, phone: buyer.phone, name: buyer.name };
  }
}
