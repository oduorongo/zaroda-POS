import { randomUUID } from 'crypto';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { RegisterOrganizationDto } from './dto/register-organization.dto';
import { JwtPayload } from './jwt.strategy';
import { PinLockoutService } from './pin-lockout.service';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly pinLockout: PinLockoutService,
  ) {}

  /**
   * Runs before any tenant is known - relies on the narrow pre-auth SELECT
   * exception on organizations/org_users in prisma/rls.sql, not on
   * TenantScopedPrismaService (there's nothing to scope to yet).
   */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { orgUsers: { include: { organization: true } } },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // A deactivated membership doesn't get to participate in login at
    // all - filtered out before the single-vs-multiple-org resolution
    // below, same as if it didn't exist, rather than surfacing a
    // distinct "deactivated" error that would confirm to whoever's
    // trying that this email/org combination exists.
    const activeOrgUsers = user.orgUsers.filter((ou) => ou.isActive);

    const membership = dto.organizationId
      ? activeOrgUsers.find((ou) => ou.organizationId === dto.organizationId)
      : activeOrgUsers.length === 1
        ? activeOrgUsers[0]
        : undefined;

    if (!membership) {
      if (activeOrgUsers.length > 1) {
        throw new ConflictException({
          message:
            'This account belongs to multiple organizations - specify organizationId',
          organizations: activeOrgUsers.map((ou) => ({
            id: ou.organizationId,
            name: ou.organization.name,
          })),
        });
      }
      throw new UnauthorizedException(
        'This account has no organization membership',
      );
    }

    return this.issueToken({
      sub: user.id,
      organizationId: membership.organizationId,
      orgUserId: membership.id,
      role: membership.role,
      branchId: membership.branchId,
    });
  }

  /**
   * Shared-terminal PIN switch (DESIGN.md §9): validates the PIN for a
   * specific org membership on a specific terminal, opens a CashierSession,
   * and issues a token scoped the same way login() does. The device itself
   * (long-lived terminal auth) is a separate concern deferred to the sales
   * module in Phase 1 - this only handles "who is the current cashier".
   */
  async pinLogin(dto: PinLoginDto) {
    // Checked before touching the database at all - see PinLockoutService's
    // own comment for why this is a second, independent brake on top of
    // AuthController's IP-based @Throttle. Unlike the "don't distinguish
    // why" wrong-PIN message below, being locked out is already observable
    // (the legitimate cashier who tripped it needs to know to wait, not
    // keep guessing), so this gets its own explicit message.
    const lockedForSeconds = this.pinLockout.getLockoutRemainingSeconds(
      dto.terminalId,
      dto.orgUserId,
    );
    if (lockedForSeconds !== null) {
      throw new HttpException(
        `Too many failed PIN attempts - try again in ${lockedForSeconds}s`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // org_users has a pre-auth SELECT exception (prisma/rls.sql), so this
    // lookup works before any tenant is established.
    const orgUser = await this.prisma.orgUser.findUnique({
      where: { id: dto.orgUserId },
      include: { user: true },
    });
    // Same "don't distinguish why" principle as login() above - a
    // deactivated membership fails PIN check the same generic way as a
    // wrong PIN, not a separate message that would confirm this
    // orgUserId exists and is just switched off.
    if (
      !orgUser?.isActive ||
      !orgUser.user.pinHash ||
      !(await bcrypt.compare(dto.pin, orgUser.user.pinHash))
    ) {
      this.pinLockout.recordFailure(dto.terminalId, dto.orgUserId);
      throw new UnauthorizedException('Invalid PIN');
    }
    this.pinLockout.recordSuccess(dto.terminalId, dto.orgUserId);

    // Everything from here on touches tables with no pre-auth exception
    // (terminals, cashier_sessions) - now that orgUser resolves the tenant,
    // establish it for the rest of this unit of work so FORCE ROW LEVEL
    // SECURITY doesn't hide/reject these operations.
    // Same timeout/maxWait as TenantScopedPrismaService.run() (see its
    // comment for why both are needed, not just one) - this call predates
    // that service and talks to the raw PrismaClient directly (there's no
    // tenant context to establish yet going in, so
    // TenantScopedPrismaService.run doesn't fit here), but it's exposed
    // to the same Neon round-trip latency and pool contention.
    const { session } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgUser.organizationId}, true)`;

        const terminal = await tx.terminal.findUnique({
          where: { id: dto.terminalId },
        });
        if (!terminal) throw new UnauthorizedException('Unknown terminal');

        const session = await tx.cashierSession.create({
          data: { terminalId: dto.terminalId, orgUserId: orgUser.id },
        });

        return { session };
      },
      { timeout: 15_000, maxWait: 15_000 },
    );

    const token = this.issueToken({
      sub: orgUser.userId,
      organizationId: orgUser.organizationId,
      orgUserId: orgUser.id,
      role: orgUser.role,
      branchId: orgUser.branchId,
    });

    return { ...token, cashierSessionId: session.id };
  }

  /**
   * The tenant-onboarding entry point - creates a brand new Organization,
   * its first (OWNER) User/OrgUser, a first Branch, and a first Terminal,
   * all in one go so a new tenant walks away with everything the terminal
   * PWA and back office both need to actually be used.
   *
   * A genuinely new kind of transaction for this codebase: every other
   * tenant-scoped write goes through TenantScopedPrismaService.run()
   * against an ALREADY-EXISTING organizationId. Here the organization
   * doesn't exist yet, so the id is generated client-side (not left to
   * Postgres's default) specifically so it can be passed to
   * set_config('app.current_tenant', ...) before the very first insert -
   * every tenant-scoped table's WITH CHECK policy requires the row's
   * organizationId to already equal the current tenant, so without this
   * the Organization insert itself would violate its own RLS policy.
   * Same raw-transaction-with-set_config pattern pinLogin() already uses
   * for the same reason (no tenant exists yet at the start of the unit of
   * work).
   *
   * Deliberately always creates a brand-new `User` rather than reusing an
   * existing account by email (unlike OrgUsersService.create(), which
   * intentionally does reuse one) - this is a public, unauthenticated
   * endpoint, so silently attaching an existing account (with its
   * existing password) to a new organization the request's caller
   * doesn't yet control is a materially different trust situation than
   * an already-authenticated MANAGER/OWNER inviting someone by email.
   * An email already in use here means "log in and use the org-users
   * invite flow instead," not "reuse that account."
   */
  async register(dto: RegisterOrganizationDto) {
    const organizationId = randomUUID();

    let result: {
      orgUser: {
        id: string;
        userId: string;
        role: Role;
        branchId: string | null;
      };
      branch: { id: string };
      terminal: { id: string };
    };
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;

          await tx.organization.create({
            data: {
              id: organizationId,
              name: dto.organizationName,
              industryType: dto.industryType,
              country: dto.country ?? 'KE',
            },
          });

          const user = await tx.user.create({
            data: {
              email: dto.ownerEmail,
              fullName: dto.ownerFullName,
              passwordHash: await bcrypt.hash(dto.ownerPassword, SALT_ROUNDS),
            },
          });

          const orgUser = await tx.orgUser.create({
            data: { organizationId, userId: user.id, role: Role.OWNER },
          });

          const branch = await tx.branch.create({
            data: { organizationId, name: dto.branchName },
          });

          const terminal = await tx.terminal.create({
            data: {
              branchId: branch.id,
              deviceLabel: dto.terminalLabel ?? 'Register 1',
            },
          });

          // Every self-registered tenant starts on a 14-day trial of the
          // entry-level plan - BASIC must exist (prisma/seed-plans.ts is a
          // deployment prerequisite, not optional). If it's ever missing,
          // failing registration loudly here is correct: better than
          // silently onboarding a tenant with no billing record at all,
          // which platform-admin's billing screen has no way to represent.
          const basicPlan = await tx.plan.findUniqueOrThrow({
            where: { tier: 'BASIC' },
          });
          const trialDays = 14;
          await tx.subscription.create({
            data: {
              organizationId,
              planId: basicPlan.id,
              currentPeriodEnd: new Date(
                Date.now() + trialDays * 24 * 60 * 60 * 1000,
              ),
              isTrial: true,
            },
          });

          return { orgUser, branch, terminal };
        },
        { timeout: 15_000, maxWait: 15_000 },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'An account already exists for this email - log in and invite yourself to a new organization from there instead',
        );
      }
      throw e;
    }

    const { orgUser, branch, terminal } = result;
    const token = this.issueToken({
      sub: orgUser.userId,
      organizationId,
      orgUserId: orgUser.id,
      role: orgUser.role,
      branchId: orgUser.branchId,
    });

    return {
      ...token,
      organizationId,
      orgUserId: orgUser.id,
      branchId: branch.id,
      terminalId: terminal.id,
    };
  }

  private issueToken(payload: JwtPayload) {
    return { accessToken: this.jwt.sign(payload) };
  }
}
