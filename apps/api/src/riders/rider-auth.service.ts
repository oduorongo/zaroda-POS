import { timingSafeEqual } from 'crypto';
import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Rider } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { buildLoginCodeEmail } from '../online-orders/login-code-email';
import { generateOtpCode, normalizeKenyanPhone, sha256 } from '../online-orders/online-orders.util';
import { RiderJwtPayload } from './rider-auth';
import { hashPin, MAX_PIN_FAILURES, PIN_LOCK_MS, verifyPin } from './rider-pin.util';
import { toRiderView } from './riders.service';

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_WINDOW = 3;
const CODE_WINDOW_MS = 15 * 60_000;

const WRONG_PIN = 'Wrong phone number or PIN';

/**
 * Rider sign-in. Two ways in:
 *  - PHONE + PIN (the main way): works on every network, needs no email and no text message, so it
 *    works for Safaricom numbers too. A rider who forgets their PIN gets a text code if their network
 *    can receive our texts, otherwise their shop (or Zaroda) resets it.
 *  - EMAIL code (the original way, kept for riders who already use it).
 * A rider row is created on first sign-up; a self-signed-up rider starts PENDING until Zaroda approves them.
 */
@Injectable()
export class RiderAuthService {
  private readonly logger = new Logger(RiderAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: ResendEmailProvider,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly config: ConfigService,
  ) {}

  private get secret(): string {
    return this.config.getOrThrow<string>('BUYER_JWT_SECRET');
  }

  // Peppered with the secret and a "rider" tag, so a leaked rider_otps table alone can't be brute-forced offline.
  // `identifier` is an email address for email codes and a normalized phone number for PIN-reset texts.
  private hashCode(identifier: string, code: string): string {
    return sha256(`rider:${identifier}:${code}:${this.secret}`);
  }

  private async session(rider: Rider) {
    const payload: RiderJwtPayload = { sub: rider.id, scope: 'rider' };
    return { accessToken: await this.jwt.signAsync(payload), rider: toRiderView(rider) };
  }

  /** Throws unless this identifier has an unexpired, unused code that matches. Consumes it on success. */
  private async consumeCode(identifier: string, rawCode: string, invalid: Error): Promise<void> {
    const otp = await this.prisma.riderOtp.findFirst({
      where: { email: identifier, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw invalid;

    // Count the attempt before comparing, so parallel guesses can't each see attempts < MAX.
    await this.prisma.riderOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hashCode(identifier, rawCode.trim()), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid;

    // consumedAt: null in the where is the one-time-use guard against two concurrent verifies.
    const consumed = await this.prisma.riderOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw invalid;
  }

  private async rateLimitCodes(identifier: string): Promise<void> {
    const recent = await this.prisma.riderOtp.count({ where: { email: identifier, createdAt: { gt: new Date(Date.now() - CODE_WINDOW_MS) } } });
    if (recent >= MAX_CODES_PER_WINDOW) {
      throw new HttpException('Too many codes requested - wait a few minutes and try again', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  // ── Phone + PIN ───────────────────────────────────────────────────────

  async signup(input: { fullName: string; phone: string; pin: string }) {
    const phone = normalizeKenyanPhone(input.phone);
    if (!phone) throw new BadRequestException('Enter a valid Kenyan mobile number, e.g. 0712 345 678');
    const existing = await this.prisma.rider.findUnique({ where: { phone } });
    if (existing) {
      throw new ConflictException(
        existing.pinHash
          ? 'That phone number is already registered - sign in with your PIN instead'
          : 'That phone number is already registered. Ask your shop or Zaroda for your PIN.',
      );
    }
    const rider = await this.prisma.rider.create({
      data: { phone, fullName: input.fullName.trim(), pinHash: hashPin(input.pin, this.secret), lastLoginAt: new Date() },
    });
    return this.session(rider);
  }

  async loginWithPin(rawPhone: string, pin: string) {
    const wrong = new UnauthorizedException(WRONG_PIN);
    const phone = normalizeKenyanPhone(rawPhone);
    if (!phone) throw wrong;
    const rider = await this.prisma.rider.findUnique({ where: { phone } });
    if (!rider || !rider.pinHash) throw wrong;

    if (rider.pinLockedUntil && rider.pinLockedUntil > new Date()) {
      const minutes = Math.max(1, Math.ceil((rider.pinLockedUntil.getTime() - Date.now()) / 60_000));
      throw new HttpException(`Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask for a PIN reset.`, HttpStatus.TOO_MANY_REQUESTS);
    }

    if (!verifyPin(pin, rider.pinHash, this.secret)) {
      const failures = rider.pinFailCount + 1;
      const lock = failures >= MAX_PIN_FAILURES;
      await this.prisma.rider.update({
        where: { id: rider.id },
        data: { pinFailCount: lock ? 0 : failures, pinLockedUntil: lock ? new Date(Date.now() + PIN_LOCK_MS) : undefined },
      });
      throw wrong;
    }

    const signedIn = await this.prisma.rider.update({
      where: { id: rider.id },
      data: { pinFailCount: 0, pinLockedUntil: null, lastLoginAt: new Date() },
    });
    return this.session(signedIn);
  }

  /**
   * Forgot PIN: a code by text. `sent` is false whenever no text went out - an unknown number, texts not set up,
   * or a network we can't text yet (Safaricom needs a sender ID) - and the rider is told to ask their shop or Zaroda.
   */
  async requestPinReset(rawPhone: string) {
    const phone = normalizeKenyanPhone(rawPhone);
    if (!phone) throw new BadRequestException('Enter a valid Kenyan mobile number, e.g. 0712 345 678');
    const notSent = { sent: false, message: "We couldn't text that number. Ask your shop or Zaroda to reset your PIN for you." };

    const rider = await this.prisma.rider.findUnique({ where: { phone } });
    if (!rider) return notSent;
    await this.rateLimitCodes(phone);

    const code = generateOtpCode();
    await this.prisma.riderOtp.create({ data: { email: phone, codeHash: this.hashCode(phone, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
    const result = await this.sms.sendSms({ to: `+${phone}`, message: `Zaroda: your PIN reset code is ${code}. It works for ${CODE_TTL_MS / 60_000} minutes. Do not share it.` });
    if (!result.sent) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`Reset text not sent (provider not configured?). Dev PIN reset code for ${phone}: ${code}`);
        return { sent: true, message: 'Code sent.' };
      }
      return notSent;
    }
    return { sent: true, message: 'We texted you a 6-digit code.' };
  }

  async resetPin(rawPhone: string, code: string, pin: string) {
    const invalid = new UnauthorizedException('That code is wrong or has expired - request a new one');
    const phone = normalizeKenyanPhone(rawPhone);
    if (!phone) throw invalid;
    await this.consumeCode(phone, code, invalid);
    const rider = await this.prisma.rider.findUnique({ where: { phone } });
    if (!rider) throw invalid;
    const updated = await this.prisma.rider.update({
      where: { id: rider.id },
      data: { pinHash: hashPin(pin, this.secret), pinFailCount: 0, pinLockedUntil: null, lastLoginAt: new Date() },
    });
    return this.session(updated);
  }

  // ── Email code (original) ─────────────────────────────────────────────

  async requestCode(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    await this.rateLimitCodes(email);
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
    await this.consumeCode(email, rawCode, new UnauthorizedException('That code is wrong or has expired - request a new one'));
    const rider = await this.prisma.rider.upsert({
      where: { email },
      create: { email, lastLoginAt: new Date() },
      update: { lastLoginAt: new Date() },
    });
    return this.session(rider);
  }
}
