import { HttpException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PasswordResetService, RESET_MAX_ATTEMPTS, RESET_MAX_CODES } from './password-reset.service';

const user = { id: 'u1', email: 'owner@shop.co.ke', passwordHash: '' };

function setup() {
  const codes: { id: string; userId: string; codeHash: string; expiresAt: Date; attempts: number; consumedAt: Date | null; createdAt: Date }[] = [];
  const tx = { $executeRaw: jest.fn(), auditLog: { create: jest.fn() } };
  const prisma = {
    user: {
      findFirst: jest.fn(async ({ where }) => (where.email.equals.toLowerCase() === user.email ? user : null)),
      findUnique: jest.fn(async () => user),
      update: jest.fn(async ({ data }) => Object.assign(user, data)),
    },
    passwordResetCode: {
      count: jest.fn(async () => codes.length),
      create: jest.fn(async ({ data }) => codes.push({ id: `c${codes.length}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data })),
      findFirst: jest.fn(async () => [...codes].reverse().find((c) => !c.consumedAt && c.expiresAt > new Date()) ?? null),
      update: jest.fn(async ({ where }) => { codes.find((c) => c.id === where.id)!.attempts += 1; }),
      updateMany: jest.fn(async ({ where }) => {
        const hit = codes.filter((c) => (where.id ? c.id === where.id : c.userId === where.userId) && !c.consumedAt);
        hit.forEach((c) => (c.consumedAt = new Date()));
        return { count: hit.length };
      }),
    },
    $queryRaw: jest.fn(async () => [{ id: 'ou1', organizationId: 'org1' }]),
    $transaction: jest.fn(async (fn) => fn(tx)),
  };
  const sent: string[] = [];
  const email = { sendEmail: jest.fn(async ({ text }) => { sent.push(text.match(/\d{6}/)[0]); return { sent: true }; }) };
  const config = { getOrThrow: () => 'secret' };
  const service = new PasswordResetService(prisma as never, email as never, config as never);
  return { service, prisma, email, sent, codes, tx };
}

describe('PasswordResetService', () => {
  beforeEach(async () => {
    user.passwordHash = await bcrypt.hash('old-password', 4);
  });

  it('answers the same for an unknown email and sends nothing', async () => {
    const { service, email } = setup();
    const known = await service.requestCode('OWNER@shop.co.ke');
    const unknown = await service.requestCode('nobody@x.com');
    expect(unknown).toEqual(known);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('resets the password with the emailed code, once, and writes the audit log', async () => {
    const { service, sent, tx } = setup();
    await service.requestCode(user.email);
    await service.resetWithCode(user.email, sent[0], 'new-password-1');
    expect(await bcrypt.compare('new-password-1', user.passwordHash)).toBe(true);
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'user.password_reset_by_email', organizationId: 'org1' }) });
    await expect(service.resetWithCode(user.email, sent[0], 'another-pass')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a wrong code and locks after too many tries', async () => {
    const { service, sent } = setup();
    await service.requestCode(user.email);
    const wrong = sent[0] === '000000' ? '111111' : '000000';
    for (let i = 0; i < RESET_MAX_ATTEMPTS; i++) {
      await expect(service.resetWithCode(user.email, wrong, 'new-password-1')).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(service.resetWithCode(user.email, sent[0], 'new-password-1')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await bcrypt.compare('old-password', user.passwordHash)).toBe(true);
  });

  it('limits how many codes one account can be sent', async () => {
    const { service } = setup();
    for (let i = 0; i < RESET_MAX_CODES; i++) await service.requestCode(user.email);
    await expect(service.requestCode(user.email)).rejects.toBeInstanceOf(HttpException);
  });

  it('changes your own password only with the current one', async () => {
    const { service } = setup();
    await expect(service.change('u1', 'wrong', 'new-password-1')).rejects.toBeInstanceOf(BadRequestException);
    await service.change('u1', 'old-password', 'new-password-1');
    expect(await bcrypt.compare('new-password-1', user.passwordHash)).toBe(true);
  });
});
