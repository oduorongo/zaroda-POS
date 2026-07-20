import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateOrgUserDto } from './dto/create-org-user.dto';
import { UpdateOrgUserDto } from './dto/update-org-user.dto';
import { SetPinDto } from './dto/set-pin.dto';

const SALT_ROUNDS = 10;

@Injectable()
export class OrgUsersService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * The cashier picker on a shared terminal (DESIGN.md §9) needs to list
   * "who can PIN in here" without exposing anything sensitive - name, role,
   * and the id pin-login needs, nothing else (no email, no PIN hash).
   */
  findAll() {
    return this.tenantPrisma.run((tx) =>
      tx.orgUser.findMany({
        select: {
          id: true,
          role: true,
          branchId: true,
          user: { select: { fullName: true } },
        },
        orderBy: { user: { fullName: 'asc' } },
      }),
    );
  }

  /**
   * Adds a membership to this org - either a brand new `User` account
   * (email + password required) or a new membership for a `User` that
   * already exists (an accountant contracted to several shops, per the
   * User model's own comment - their name/password are already theirs,
   * `fullName`/`password` are ignored if passed for this case rather than
   * silently overwriting the account they use elsewhere).
   *
   * `users` is deliberately not tenant-scoped by RLS (see rls.sql's own
   * comment on why) - this is the one place the app looks a user up by
   * email directly rather than through an already-tenant-filtered
   * org_users row, the same pattern AuthService.login already uses for
   * the same reason (resolving identity has to happen before a tenant is
   * established).
   */
  async create(dto: CreateOrgUserDto) {
    const { organizationId } = getTenantStore();

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    let userId: string;
    if (existing) {
      userId = existing.id;
    } else {
      if (!dto.fullName || !dto.password) {
        throw new BadRequestException(
          'No account exists for this email yet - fullName and password (min 8 characters) are required to create one',
        );
      }
      const created = await this.prisma.user.create({
        data: {
          email: dto.email,
          fullName: dto.fullName,
          passwordHash: await bcrypt.hash(dto.password, SALT_ROUNDS),
        },
      });
      userId = created.id;
    }

    try {
      return await this.tenantPrisma.run(async (tx) => {
        const orgUser = await tx.orgUser.create({
          data: {
            organizationId,
            userId,
            role: dto.role,
            branchId: dto.branchId,
          },
          select: {
            id: true,
            role: true,
            branchId: true,
            user: { select: { fullName: true, email: true } },
          },
        });

        await this.auditLog.logInTx(tx, {
          action: 'org_user.created',
          entityType: 'OrgUser',
          entityId: orgUser.id,
          after: {
            role: dto.role,
            branchId: dto.branchId ?? null,
            email: dto.email,
          },
        });

        return orgUser;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'This person already has a membership in this organization',
        );
      }
      throw e;
    }
  }

  async updateRole(id: string, dto: UpdateOrgUserDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.orgUser.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Org user not found');

      const updated = await tx.orgUser.update({
        where: { id },
        data: {
          role: dto.role,
          // Explicit key so `branchId: null` (clear the scope) is
          // distinguished from an omitted field (leave unchanged) -
          // `dto.branchId ?? undefined` would collapse both to the same
          // thing.
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        },
        select: {
          id: true,
          role: true,
          branchId: true,
          user: { select: { fullName: true, email: true } },
        },
      });

      await this.auditLog.logInTx(tx, {
        action: 'org_user.updated',
        entityType: 'OrgUser',
        entityId: id,
        before: { role: before.role, branchId: before.branchId },
        after: { role: updated.role, branchId: updated.branchId },
      });

      return updated;
    });
  }

  /**
   * Setting a PIN writes to `User.pinHash`, not anything on `OrgUser` -
   * safe to do with the raw (non-tenant-scoped) PrismaService here only
   * because the `OrgUser` lookup just above it already proved this
   * `userId` belongs to a membership in the caller's own tenant; this
   * never accepts a bare `userId` from the client, only an `orgUserId`
   * resolved through a tenant-filtered row.
   *
   * The `pinHash` update and its audit log entry are NOT atomic with each
   * other - unlike every other audited write in this codebase, which
   * always logs inside the same tenant-scoped `tx` as the action itself.
   * That's not possible here: `User` is deliberately outside RLS/tenant
   * scoping (see rls.sql's comment), so its update has to go through the
   * raw `PrismaService`, a different transaction than the tenant-scoped
   * `tx` the audit log needs. Accepted deliberately - the PIN itself is
   * the sensitive write and always happens; losing the audit trail entry
   * to a crash in the narrow gap between the two calls is a real but
   * small risk, the same class of accepted tradeoff already documented
   * elsewhere in this codebase (e.g. the vertical modules' "sale commits
   * before its own metadata does").
   */
  async setPin(id: string, dto: SetPinDto) {
    const orgUser = await this.tenantPrisma.run((tx) =>
      tx.orgUser.findUnique({ where: { id } }),
    );
    if (!orgUser) throw new NotFoundException('Org user not found');

    await this.prisma.user.update({
      where: { id: orgUser.userId },
      data: { pinHash: await bcrypt.hash(dto.pin, SALT_ROUNDS) },
    });

    await this.tenantPrisma.run((tx) =>
      this.auditLog.logInTx(tx, {
        action: 'org_user.pin_reset',
        entityType: 'OrgUser',
        entityId: id,
      }),
    );

    return { ok: true };
  }
}
