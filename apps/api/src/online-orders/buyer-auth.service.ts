import { timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Buyer } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { BuyerJwtPayload } from './buyer-auth';
import { hashPin, MAX_PIN_FAILURES, PIN_LOCK_MS, verifyPin } from '../riders/rider-pin.util';
import { buildLoginCodeEmail } from './login-code-email';
import { generateOtpCode, normalizeKenyanPhone, sha256 } from './online-orders.util';

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
// Per address or number, on top of the per-IP controller throttle - stops
// someone using Zaroda to flood a victim's inbox or phone with codes.
const MAX_CODES_PER_WINDOW = 3;
const CODE_WINDOW_MS = 15 * 60_000;

export type LoginChannel = 'EMAIL' | 'SMS';

interface Identity {
  channel: LoginChannel;
  /** Lowercased email, or normalized 2547XXXXXXXX phone. */
  identifier: string;
}

// Pragmatic, not RFC-perfect: one @, no spaces, a dot in the domain. Whether the
// address really exists is proven by the code arriving.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Shopper sign-in: ask for a 6-digit code, then verify it for a buyer JWT. The
 * code goes by EMAIL (the default: free, works as soon as the sending domain is
 * verified) or by SMS (when Africa's Talking is set up). A buyer account is
 * created on first successful verification - there's no separate sign-up.
 *
 * buyers/buyer_otps carry no RLS (see rls.sql), so this uses the plain
 * PrismaService and only ever looks rows up by the address/number being verified.
 */
@Injectable()
export class BuyerAuthService {
  private readonly logger = new Logger(BuyerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly email: ResendEmailProvider,
    private readonly config: ConfigService,
  ) {}

  /** What the sign-in screen may offer. Email needs nothing extra to be offered; SMS only when Africa's Talking is configured. */
  methods() {
    const smsConfigured = Boolean(this.config.get<string>('AFRICAS_TALKING_API_KEY') && this.config.get<string>('AFRICAS_TALKING_USERNAME'));
    return { email: true, sms: smsConfigured, pin: true };
  }

  private identify(input: { email?: string; phone?: string }): Identity {
    const hasEmail = Boolean(input.email?.trim());
    const hasPhone = Boolean(input.phone?.trim());
    if (hasEmail === hasPhone) {
      throw new BadRequestException('Give either an email address or a phone number');
    }
    if (hasEmail) {
      const email = input.email!.trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email) || email.length > 200) throw new BadRequestException('Enter a valid email address, e.g. you@example.com');
      return { channel: 'EMAIL', identifier: email };
    }
    const phone = normalizeKenyanPhone(input.phone!);
    if (!phone) throw new BadRequestException('Enter a valid Kenyan mobile number, e.g. 0712 345 678');
    return { channel: 'SMS', identifier: phone };
  }

  // Peppered with the buyer JWT secret, so a leaked buyer_otps table alone
  // can't be brute-forced offline (a 6-digit code has only 1M values).
  private hashCode(identifier: string, code: string): string {
    return sha256(`${identifier}:${code}:${this.config.getOrThrow<string>('BUYER_JWT_SECRET')}`);
  }

  async requestCode(input: { email?: string; phone?: string }) {
    const { channel, identifier } = this.identify(input);
    const recent = await this.prisma.buyerOtp.count({
      where: { identifier, createdAt: { gt: new Date(Date.now() - CODE_WINDOW_MS) } },
    });
    if (recent >= MAX_CODES_PER_WINDOW) {
      throw new HttpException('Too many codes requested - wait a few minutes and try again', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (channel === 'SMS' && !this.methods().sms && process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Sign-in by text message is not available yet - please use your email address');
    }

    const code = generateOtpCode();
    await this.prisma.buyerOtp.create({
      data: { channel, identifier, codeHash: this.hashCode(identifier, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });

    const sent = channel === 'EMAIL' ? await this.sendEmailCode(identifier, code) : await this.sendSmsCode(identifier, code);
    if (!sent) {
      if (process.env.NODE_ENV !== 'production') {
        // Local development without email/SMS credentials - the only way to sign in.
        this.logger.warn(`Code not sent (provider not configured?). Dev login code for ${identifier}: ${code}`);
      } else {
        throw new HttpException(
          channel === 'EMAIL' ? 'Could not send the email right now - try again shortly' : 'Could not send the SMS right now - try again shortly',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }
    return { sent: true, channel, identifier };
  }

  private async sendEmailCode(to: string, code: string): Promise<boolean> {
    const built = buildLoginCodeEmail(code, CODE_TTL_MS / 60_000);
    const result = await this.email.sendEmail({ to, ...built });
    return result.sent;
  }

  private async sendSmsCode(phone: string, code: string): Promise<boolean> {
    const result = await this.sms.sendSms({
      to: `+${phone}`,
      message: `Your Zaroda code is ${code}. It expires in 5 minutes. Don't share it with anyone.`,
    });
    return result.sent;
  }

  async verifyCode(input: { email?: string; phone?: string; code: string }) {
    const { identifier } = this.identify(input);
    const otp = await this.prisma.buyerOtp.findFirst({
      where: { identifier, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const invalid = new UnauthorizedException('That code is wrong or has expired - request a new one');
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw invalid;

    // Count the attempt before comparing, so parallel guesses can't each
    // see attempts < MAX and all get a free try.
    await this.prisma.buyerOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hashCode(identifier, input.code.trim()), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid;

    // updateMany with consumedAt: null is the one-time-use guard - two
    // concurrent verifies of the same code can't both succeed.
    const consumed = await this.prisma.buyerOtp.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw invalid;

    const buyer =
      otp.channel === 'EMAIL'
        ? await this.prisma.buyer.upsert({ where: { email: identifier }, create: { email: identifier }, update: {} })
        : await this.prisma.buyer.upsert({ where: { phone: identifier }, create: { phone: identifier }, update: {} });
    const payload: BuyerJwtPayload = { sub: buyer.id, scope: 'buyer' };
    return { accessToken: await this.jwt.signAsync(payload), buyer: this.toView(buyer) };
  }

  // ── Phone + PIN ──────────────────────────────────────────────────────

  private get pepper(): string {
    return this.config.getOrThrow<string>('BUYER_JWT_SECRET');
  }

  private async session(buyer: Buyer) {
    const payload: BuyerJwtPayload = { sub: buyer.id, scope: 'buyer' };
    return { accessToken: await this.jwt.signAsync(payload), buyer: this.toView(buyer) };
  }

  private phoneOrThrow(raw: string): string {
    const phone = normalizeKenyanPhone(raw);
    if (!phone) throw new BadRequestException('Enter a valid Kenyan mobile number, e.g. 0712 345 678');
    return phone;
  }

  /** Creates the account straight away: the PIN, not a code, is what protects it (a code cannot reach every network yet). */
  async signupWithPin(input: { phone: string; pin: string; name?: string }) {
    const phone = this.phoneOrThrow(input.phone);
    const existing = await this.prisma.buyer.findUnique({ where: { phone } });
    if (existing) {
      throw new ConflictException(
        existing.pinHash
          ? 'That phone number already has an account - sign in with your PIN instead'
          : 'That phone number is already used on an account. Sign in the way you did before, then add a PIN from there.',
      );
    }
    const buyer = await this.prisma.buyer.create({
      data: { phone, name: input.name?.trim() || null, pinHash: hashPin(input.pin, this.pepper) },
    });
    return this.session(buyer);
  }

  async loginWithPin(rawPhone: string, pin: string) {
    const wrong = new UnauthorizedException('Wrong phone number or PIN');
    const phone = normalizeKenyanPhone(rawPhone);
    if (!phone) throw wrong;
    const buyer = await this.prisma.buyer.findUnique({ where: { phone } });
    if (!buyer || !buyer.pinHash) throw wrong;

    if (buyer.pinLockedUntil && buyer.pinLockedUntil > new Date()) {
      const minutes = Math.max(1, Math.ceil((buyer.pinLockedUntil.getTime() - Date.now()) / 60_000));
      throw new HttpException(`Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your PIN.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!verifyPin(pin, buyer.pinHash, this.pepper)) {
      const failures = buyer.pinFailCount + 1;
      const lock = failures >= MAX_PIN_FAILURES;
      await this.prisma.buyer.update({
        where: { id: buyer.id },
        data: { pinFailCount: lock ? 0 : failures, pinLockedUntil: lock ? new Date(Date.now() + PIN_LOCK_MS) : undefined },
      });
      throw wrong;
    }
    const signedIn = await this.prisma.buyer.update({ where: { id: buyer.id }, data: { pinFailCount: 0, pinLockedUntil: null } });
    return this.session(signedIn);
  }

  /**
   * Forgot PIN: a code by text, or - when the network cannot be texted yet (Safaricom) - by email if the account
   * has one. `sent` is false when neither works; nobody else can reset a shopper's PIN, so they are pointed to support.
   */
  async requestPinReset(rawPhone: string) {
    const phone = this.phoneOrThrow(rawPhone);
    const notSent: { sent: boolean; via: string | null; message: string } = {
      sent: false,
      via: null,
      message: "We couldn't text that number and there is no email on the account. Please WhatsApp +254 781 230 805 and we will help you get back in.",
    };
    const buyer = await this.prisma.buyer.findUnique({ where: { phone } });
    if (!buyer) return notSent;

    const recent = await this.prisma.buyerOtp.count({ where: { identifier: phone, createdAt: { gt: new Date(Date.now() - CODE_WINDOW_MS) } } });
    if (recent >= MAX_CODES_PER_WINDOW) {
      throw new HttpException('Too many codes requested - wait a few minutes and try again', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = generateOtpCode();
    // The code is tied to the PHONE NUMBER whichever way it is delivered, so one check covers both.
    await this.prisma.buyerOtp.create({
      data: { channel: 'SMS', identifier: phone, codeHash: this.hashCode(phone, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });
    if (await this.sendSmsCode(phone, code)) return { sent: true, via: 'sms', message: 'We texted you a 6-digit code.' };
    if (buyer.email && (await this.sendEmailCode(buyer.email, code))) {
      return { sent: true, via: 'email', message: `We emailed a 6-digit code to ${buyer.email.replace(/^(.).*(@.*)$/, '$1***$2')}.` };
    }
    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(`PIN reset code not sent (providers not configured?). Dev code for ${phone}: ${code}`);
      return { sent: true, via: 'sms', message: 'Code sent.' };
    }
    return notSent;
  }

  async resetPin(rawPhone: string, code: string, pin: string) {
    const invalid = new UnauthorizedException('That code is wrong or has expired - request a new one');
    const phone = normalizeKenyanPhone(rawPhone);
    if (!phone) throw invalid;
    const otp = await this.prisma.buyerOtp.findFirst({
      where: { identifier: phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw invalid;
    await this.prisma.buyerOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hashCode(phone, code.trim()), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid;
    const consumed = await this.prisma.buyerOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw invalid;

    const buyer = await this.prisma.buyer.findUnique({ where: { phone } });
    if (!buyer) throw invalid;
    const updated = await this.prisma.buyer.update({
      where: { id: buyer.id },
      data: { pinHash: hashPin(pin, this.pepper), pinFailCount: 0, pinLockedUntil: null },
    });
    return this.session(updated);
  }

  /** A signed-in shopper adds a PIN (and a phone number, if the account has none) or changes their PIN. */
  async setPin(buyerId: string, pin: string, rawPhone?: string) {
    const buyer = await this.prisma.buyer.findUnique({ where: { id: buyerId } });
    if (!buyer) throw new UnauthorizedException();
    let phone = buyer.phone;
    if (!phone) {
      if (!rawPhone) throw new BadRequestException('Enter your phone number - you sign in with it and your PIN');
      phone = this.phoneOrThrow(rawPhone);
      const taken = await this.prisma.buyer.findUnique({ where: { phone } });
      if (taken && taken.id !== buyerId) throw new ConflictException('That phone number is already used on another account');
    }
    const updated = await this.prisma.buyer.update({
      where: { id: buyerId },
      data: { phone, pinHash: hashPin(pin, this.pepper), pinFailCount: 0, pinLockedUntil: null },
    });
    return this.toView(updated);
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

  private toView(buyer: Pick<Buyer, 'id' | 'email' | 'phone' | 'name' | 'pinHash'>) {
    return { id: buyer.id, email: buyer.email, phone: buyer.phone, name: buyer.name, hasPin: Boolean(buyer.pinHash) };
  }
}
