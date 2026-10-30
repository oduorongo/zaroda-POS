import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Tx } from '../common/con-access';
import { ConPlansService } from './con-plans.service';

/** Staff added from the core Staff screen still count toward the construction plan's user limit. */
@Injectable()
export class ConLimitsListener {
  constructor(private readonly plans: ConPlansService) {}

  @OnEvent('orgUser.beforeCreate', { suppressErrors: false })
  async beforeUserCreate({ tx, organizationId }: { tx: Tx; organizationId: string }) {
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { industryType: true } });
    if (org?.industryType !== 'CONSTRUCTION') return;
    await this.plans.assertCanAdd(tx, organizationId, 'users', await tx.orgUser.count({ where: { isActive: true } }));
  }
}
