import { BadRequestException, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Role } from '@prisma/client';
import { Tx } from '../common/con-access';
import { ConPlansService } from './con-plans.service';

/** Till and caretaker access mean nothing on a building site. */
export const CON_CORE_ROLES: Role[] = [Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.AUDITOR];

const isConstruction = async (tx: Tx, organizationId: string) =>
  (await tx.organization.findUnique({ where: { id: organizationId }, select: { industryType: true } }))?.industryType === 'CONSTRUCTION';

/** Rules for staff added or changed from the core Staff screen in a construction business. */
@Injectable()
export class ConLimitsListener {
  constructor(private readonly plans: ConPlansService) {}

  @OnEvent('orgUser.beforeCreate', { suppressErrors: false })
  async beforeUserCreate({ tx, organizationId }: { tx: Tx; organizationId: string }) {
    if (!(await isConstruction(tx, organizationId))) return;
    await this.plans.assertCanAdd(tx, organizationId, 'users', await tx.orgUser.count({ where: { isActive: true } }));
  }

  @OnEvent('orgUser.beforeRoleSet', { suppressErrors: false })
  async beforeRoleSet({ tx, organizationId, role }: { tx: Tx; organizationId: string; role: Role }) {
    if (CON_CORE_ROLES.includes(role) || !(await isConstruction(tx, organizationId))) return;
    throw new BadRequestException(`${role === Role.CASHIER ? 'Cashier' : 'Caretaker'} is not a construction role. Add the person from Staff & roles and pick their job.`);
  }
}
