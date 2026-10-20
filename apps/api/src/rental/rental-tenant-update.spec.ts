import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RentalService } from './rental.service';

function setup(found = true) {
  const tx = {
    rentalTenant: {
      findUnique: jest.fn().mockResolvedValue(found ? { id: 't1' } : null),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 't1', ...data })),
    },
  };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new RentalService(tenantPrisma as any, {} as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, tx };
}

describe('RentalService.updateTenant phone number', () => {
  it('saves a new phone and the 2547... form the tenant is found by when they sign in', async () => {
    const { service, tx } = setup();
    await service.updateTenant('t1', { phone: ' 0712 345 678 ' });
    const data = tx.rentalTenant.update.mock.calls[0][0].data;
    expect(data.phone).toBe('0712 345 678');
    expect(data.phoneNormalized).toBe('254712345678');
  });

  it('refuses a number that is not a Kenyan mobile, instead of quietly locking the tenant out', async () => {
    const { service, tx } = setup();
    await expect(service.updateTenant('t1', { phone: '12345' })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.rentalTenant.update).not.toHaveBeenCalled();
  });

  it('takes the number off the record when it is emptied', async () => {
    const { service, tx } = setup();
    await service.updateTenant('t1', { phone: '  ' });
    const data = tx.rentalTenant.update.mock.calls[0][0].data;
    expect(data.phone).toBeNull();
    expect(data.phoneNormalized).toBeNull();
  });

  it('leaves the phone alone when only the email changes', async () => {
    const { service, tx } = setup();
    await service.updateTenant('t1', { email: ' Tenant@Example.COM ' });
    const data = tx.rentalTenant.update.mock.calls[0][0].data;
    expect(data.email).toBe('tenant@example.com');
    expect('phone' in data).toBe(false);
    expect('phoneNormalized' in data).toBe(false);
  });

  it('says so when the tenant is not found', async () => {
    const { service } = setup(false);
    await expect(service.updateTenant('t1', { phone: '0712345678' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
