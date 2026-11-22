import * as bcrypt from 'bcryptjs';
import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { SalesService } from './sales.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const created: any[] = [];
let approver: any;
const tx = {
  orgUser: { findUnique: jest.fn(async () => approver) },
  discountApproval: { create: jest.fn(async ({ data }: any) => (created.push(data), { id: `appr-${created.length}`, ...data })) },
};
const service = new SalesService({ run: (fn: any) => fn(tx) } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
const as = <T>(orgUserId: string, role: Role, fn: () => Promise<T>) =>
  tenantContext.run({ organizationId: 'org-1', orgUserId, role } as any, fn);

describe('discount approval', () => {
  beforeAll(async () => {
    approver = { id: 'mgr-1', isActive: true, role: Role.MANAGER, user: { pinHash: await bcrypt.hash('4821', 4) } };
  });
  beforeEach(() => (created.length = 0));

  it('a cashier gets an approval only with the manager\'s PIN', async () => {
    const dto = { type: 'PERCENT', value: 10, approvedById: 'mgr-1' } as any;
    await expect(as('cashier-1', Role.CASHIER, () => service.approveDiscount(dto))).rejects.toThrow(/must enter their PIN/);
    await expect(as('cashier-1', Role.CASHIER, () => service.approveDiscount({ ...dto, approverPin: '0000' }))).rejects.toThrow(BadRequestException);
    const ok = await as('cashier-1', Role.CASHIER, () => service.approveDiscount({ ...dto, approverPin: '4821' }));
    expect(ok.approvalId).toBe('appr-1');
    expect(created[0]).toMatchObject({ organizationId: 'org-1', approvedById: 'mgr-1', requestedById: 'cashier-1', type: 'PERCENT', value: 10 });
  });

  it('the signed-in manager approves their own discount without a PIN', async () => {
    const ok = await as('mgr-1', Role.MANAGER, () => service.approveDiscount({ type: 'FIXED', value: 50, approvedById: 'mgr-1' } as any));
    expect(ok.approvalId).toBeDefined();
  });

  it('a cashier cannot be the approver', async () => {
    approver = { ...approver, role: Role.CASHIER };
    await expect(as('cashier-1', Role.CASHIER, () => service.approveDiscount({ type: 'PERCENT', value: 5, approvedById: 'mgr-1', approverPin: '4821' } as any))).rejects.toThrow(/supervisor, manager, or owner/);
    approver = { ...approver, role: Role.MANAGER };
  });

  it('refuses more than 100 percent', async () => {
    await expect(as('mgr-1', Role.MANAGER, () => service.approveDiscount({ type: 'PERCENT', value: 120, approvedById: 'mgr-1' } as any))).rejects.toThrow(/cannot exceed 100/);
  });
});
