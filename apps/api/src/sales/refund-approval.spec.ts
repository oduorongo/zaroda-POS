import * as bcrypt from 'bcryptjs';
import { BadRequestException, HttpException } from '@nestjs/common';
import { SalesService } from './sales.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const service = new SalesService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
const check = (id: string, hash: string | null, pin?: string) => (service as any).checkApproverPin(id, hash, pin) as Promise<void>;

describe('refund approver PIN', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash('4821', 4);
  });

  it('accepts the approver\'s own PIN', async () => {
    await expect(check('mgr-1', hash, '4821')).resolves.toBeUndefined();
  });

  it('refuses a missing or wrong PIN, and an approver with no PIN', async () => {
    await expect(check('mgr-2', hash)).rejects.toThrow(/must enter their PIN/);
    await expect(check('mgr-2', hash, '0000')).rejects.toThrow(BadRequestException);
    await expect(check('mgr-3', null, '4821')).rejects.toThrow(/no PIN set/);
  });

  it('locks the approver after 5 wrong PINs, even against the right one', async () => {
    for (let i = 0; i < 5; i++) await expect(check('mgr-4', hash, '1111')).rejects.toThrow(BadRequestException);
    await expect(check('mgr-4', hash, '4821')).rejects.toThrow(HttpException);
    await expect(check('mgr-4', hash, '4821')).rejects.toThrow(/Too many wrong approver PINs/);
  });
});
