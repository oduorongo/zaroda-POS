import { ForbiddenException } from '@nestjs/common';
import { phoneKey, SchoolSalesService, SchoolSalesSyncController } from './school-sales';

const AGENT = { id: '11111111-2222-3333-4444-555555555555', teamId: 'team-1' };

function setup(existingSchools: string[] = []) {
  const prisma: any = {
    salesAgent: {
      findUnique: jest.fn(({ where }) => Promise.resolve(where.id === AGENT.id || where.email === 'jane@zaroda.test' ? AGENT : null)),
      findMany: jest.fn().mockResolvedValue([{ ...AGENT, phone: '+254 712 345 678' }]),
    },
    salesSchool: {
      findUnique: jest.fn(({ where }) => Promise.resolve(existingSchools.includes(where.id) ? { id: where.id } : null)),
      findMany: jest.fn(({ where }) => Promise.resolve(where.id.in.filter((id: string) => existingSchools.includes(id) || id.startsWith('new')).map((id: string) => ({ id })))),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    salesSchoolPayment: { createMany: jest.fn(({ data }) => Promise.resolve({ count: data.length })) },
  };
  const config: any = { get: jest.fn((k: string) => (k === 'SCHOOL_SALES_SYNC_KEY' ? 'k'.repeat(30) : undefined)) };
  return { prisma, config, service: new SchoolSalesService(prisma, config) };
}

const school = (id: string, agentRef: string) => ({ id, name: ` ${id} School `, signedUpAt: '2026-10-01T00:00:00Z', active: true, agentRef });

describe('SchoolSalesService', () => {
  it('reads a phone number however it was typed', () => {
    expect(phoneKey('0712345678')).toBe('712345678');
    expect(phoneKey('+254 712 345 678')).toBe('712345678');
    expect(phoneKey('123')).toBeNull();
  });

  it('credits new schools by link id, email or phone, and lists the ones it cannot match', async () => {
    const { service, prisma } = setup();
    const result = await service.sync({
      schools: [school('new-a', AGENT.id), school('new-b', 'Jane@Zaroda.test'), school('new-c', '0712345678'), school('new-d', 'nobody')],
    });
    expect(result).toEqual({ schoolsAdded: 3, unmatched: ['new-d'], paymentsAdded: 0 });
    expect(prisma.salesSchool.create.mock.calls[0][0].data).toMatchObject({ id: 'new-a', name: 'new-a School', agentId: AGENT.id, teamId: 'team-1' });
  });

  it('never moves a school already credited, and stores payments only for known schools, prefixed', async () => {
    const { service, prisma } = setup(['old']);
    const result = await service.sync({
      schools: [school('old', 'someone-else')],
      payments: [
        { id: 'p1', schoolId: 'old', amountKes: 3000, paidAt: '2026-10-05T00:00:00Z' },
        { id: 'p2', schoolId: 'stranger', amountKes: 3000, paidAt: '2026-10-05T00:00:00Z' },
      ],
    });
    expect(prisma.salesSchool.create).not.toHaveBeenCalled();
    expect(prisma.salesSchool.update.mock.calls[0][0].data).toEqual({ name: 'old School', active: true });
    expect(prisma.salesSchoolPayment.createMany.mock.calls[0][0]).toMatchObject({ data: [{ id: 'school:p1', schoolId: 'old' }], skipDuplicates: true });
    expect(result.paymentsAdded).toBe(1);
  });

  it('the sync endpoint refuses a wrong or missing key', () => {
    const { service, config } = setup();
    const controller = new SchoolSalesSyncController(service, config);
    expect(() => controller.sync({ headers: {} } as any, {})).toThrow(ForbiddenException);
    expect(() => controller.sync({ headers: { 'x-sales-sync-key': 'wrong' } } as any, {})).toThrow(ForbiddenException);
    expect(controller.sync({ headers: { 'x-sales-sync-key': 'k'.repeat(30) } } as any, {})).toBeInstanceOf(Promise);
  });
});
