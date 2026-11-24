import { timingSafeEqual } from 'crypto';
import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { generateOtpCode, sha256 } from '../online-orders/online-orders.util';
import { buildPasswordResetEmail } from './password-reset-email';

const SALT_ROUNDS = 10;
export const RESET_CODE_TTL_MS = 15 * 60_000;
export const RESET_MAX_ATTEMPTS = 5;
export const RESET_MAX_CODES = 3;
const RESET_WINDOW_MS = 60 * 60_000;

/**
 * Back office passwords: "forgot password" by a 6-digit emailed code, and changing your own password when signed in.
 * users / password_reset_codes carry no RLS, so this uses the plain PrismaService and only looks a code up by the user it
 * was sent to. Audit entries go into each business the person belongs to.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: ResendEmailProvider,
    private readonly config: ConfigService,
  ) {}

  // Peppered with the JWT secret, so a leaked codes table alone can't be brute-forced offline.
  private hash(userId: string, code: string) {
    return sha256(`${userId}:${code}:${this.config.getOrThrow<string>('JWT_SECRET')}`);
  }

  private findUser(email: string) {
    return this.prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } });
  }

  /** Answers the same way whether or not the email has an account, so nobody can use it to find out. */
  async requestCode(email: string) {
    const answer = { sent: true, message: 'If that email has a Zaroda account, a 6-digit code is on its way. Check your inbox and spam folder.' };
    const user = await this.findUser(email);
    if (!user) return answer;

    const recent = await this.prisma.passwordResetCode.count({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESET_WINDOW_MS) } },
    });
    if (recent >= RESET_MAX_CODES) {
      throw new HttpException('Too many codes asked for - wait an hour, or use the last code you received', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = generateOtpCode();
    await this.prisma.passwordResetCode.create({
      data: { userId: user.id, codeHash: this.hash(user.id, code), expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS) },
    });
    const sent = await this.email.sendEmail({ to: user.email, ...buildPasswordResetEmail(code, RESET_CODE_TTL_MS / 60_000) });
    if (!sent.sent) {
      if (process.env.NODE_ENV !== 'production') this.logger.warn(`Reset email not sent (Resend not set up?). Dev code for ${user.email}: ${code}`);
      else throw new HttpException('Could not send the email right now - try again shortly', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return answer;
  }

  async resetWithCode(email: string, code: string, newPassword: string) {
    const invalid = new UnauthorizedException('That code is wrong or has expired - ask for a new one');
    const user = await this.findUser(email);
    if (!user) throw invalid;
    const row = await this.prisma.passwordResetCode.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || row.attempts >= RESET_MAX_ATTEMPTS) throw invalid;

    // Counted before comparing, so parallel guesses can't each get a free try.
    await this.prisma.passwordResetCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    const expected = Buffer.from(row.codeHash, 'hex');
    const actual = Buffer.from(this.hash(user.id, code.trim()), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid;

    const used = await this.prisma.passwordResetCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (used.count === 0) throw invalid;
    // Any older code still waiting stops working too.
    await this.prisma.passwordResetCode.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });

    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) } });
    await this.audit(user.id, 'user.password_reset_by_email');
    return { ok: true };
  }

  async change(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Your current password is not right');
    }
    if (currentPassword === newPassword) throw new BadRequestException('Choose a password different from the current one');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) } });
    await this.audit(userId, 'user.password_changed');
    return { ok: true };
  }

  /** One entry in every business this person belongs to, each written with that business set, as rls.sql requires. */
  private async audit(userId: string, action: string) {
    const memberships = await this.prisma.$queryRaw<{ id: string; organizationId: string }[]>`
      SELECT id, "organizationId" FROM org_users WHERE "userId" = ${userId}`;
    for (const m of memberships) {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant', ${m.organizationId}, true)`;
          await tx.auditLog.create({ data: { organizationId: m.organizationId, actorId: m.id, action, entityType: 'OrgUser', entityId: m.id } });
        },
        { timeout: 15_000, maxWait: 15_000 },
      );
    }
  }
}
