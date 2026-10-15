import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { tenantContext } from '../common/tenant/tenant-context';
import { RentalReadOnlyInterceptor } from './rental-read-only.interceptor';

function build(opts: { enforce: boolean; readOnly: boolean }) {
  const billing = { enforcesReadOnly: () => opts.enforce, isReadOnly: jest.fn(async () => opts.readOnly) };
  const tenantPrisma = { run: async (fn: (tx: unknown) => unknown) => fn({}) };
  const interceptor = new RentalReadOnlyInterceptor(billing as never, tenantPrisma as never);
  const run = (method: string) => {
    const handler = { handle: jest.fn(() => of('ok')) };
    const context = { switchToHttp: () => ({ getRequest: () => ({ method }) }) };
    const result = tenantContext.run({ organizationId: 'org-1', orgUserId: 'ou-1', role: 'OWNER' }, () =>
      lastValueFrom(interceptor.intercept(context as never, handler as never)),
    );
    return { result, handler, billing };
  };
  return run;
}

describe('RentalReadOnlyInterceptor', () => {
  it('lets a read-only landlord keep looking at everything', async () => {
    const { result, billing } = build({ enforce: true, readOnly: true })('GET');
    await expect(result).resolves.toBe('ok');
    expect(billing.isReadOnly).not.toHaveBeenCalled();
  });

  it('blocks a change from a read-only landlord, with a message that says nothing was deleted', async () => {
    const { result, handler } = build({ enforce: true, readOnly: true })('POST');
    await expect(result).rejects.toThrow(ForbiddenException);
    await expect(result).rejects.toThrow(/Nothing has been deleted/);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('lets a landlord who is up to date change things', async () => {
    const { result } = build({ enforce: true, readOnly: false })('PATCH');
    await expect(result).resolves.toBe('ok');
  });

  it('does nothing at all while enforcement is switched off', async () => {
    const { result, billing } = build({ enforce: false, readOnly: true })('POST');
    await expect(result).resolves.toBe('ok');
    expect(billing.isReadOnly).not.toHaveBeenCalled();
  });
});
