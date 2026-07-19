import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { JwtPayload } from './jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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

    const membership = dto.organizationId
      ? user.orgUsers.find((ou) => ou.organizationId === dto.organizationId)
      : user.orgUsers.length === 1
        ? user.orgUsers[0]
        : undefined;

    if (!membership) {
      if (user.orgUsers.length > 1) {
        throw new ConflictException({
          message:
            'This account belongs to multiple organizations - specify organizationId',
          organizations: user.orgUsers.map((ou) => ({
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
    // org_users has a pre-auth SELECT exception (prisma/rls.sql), so this
    // lookup works before any tenant is established.
    const orgUser = await this.prisma.orgUser.findUnique({
      where: { id: dto.orgUserId },
      include: { user: true },
    });
    if (
      !orgUser?.user.pinHash ||
      !(await bcrypt.compare(dto.pin, orgUser.user.pinHash))
    ) {
      throw new UnauthorizedException('Invalid PIN');
    }

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

  private issueToken(payload: JwtPayload) {
    return { accessToken: this.jwt.sign(payload) };
  }
}
