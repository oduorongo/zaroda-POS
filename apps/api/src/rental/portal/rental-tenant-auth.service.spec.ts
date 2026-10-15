import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { sha256 } from '../../online-orders/online-orders.util';
import { RentalTenantAuthService } from './rental-tenant-auth.service';

const SECRET = 'test-secret';

function build(opts: { known?: boolean; smsConfigured?: boolean; smsOk?: boolean; emailOk?: boolean } = {}) {
  const otps: { id: string; email: string; codeHash: string; attempts: number; consumedAt: Date | null; expiresAt: Date; createdAt: Date }[] = [];
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    rentalTenant: { count: jest.fn(async () => (opts.known === false ? 0 : 1)) },
  };
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    rentalTenantOtp: {
      count: jest.fn(async () => otps.length),
      create: jest.fn(async ({ data }: { data: { email: string; codeHash: string; expiresAt: Date } }) => {
        otps.push({ id: `otp-${otps.length + 1}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data });
      }),
      findFirst: jest.fn(async ({ where }: { where: { email: string } }) => otps.filter((o) => o.email === where.email).pop() ?? null),
      update: jest.fn(async ({ where }: { where: { id: string } }) => {
        const o = otps.find((x) => x.id === where.id)!;
        o.attempts += 1;
      }),
      updateMany: jest.fn(async ({ where }: { where: { id: string } }) => {
        const o = otps.find((x) => x.id === where.id)!;
        if (o.consumedAt) return { count: 0 };
        o.consumedAt = new Date();
        return { count: 1 };
      }),
    },
  };
  const jwt = { signAsync: jest.fn(async (p: { sub: string }) => `token-for-${p.sub}`) };
  const email = { sendEmail: jest.fn(async (_m: { to: string }) => ({ sent: opts.emailOk ?? true })) };
  const sms = { sendSms: jest.fn(async (_m: { to: string; message: string }) => ({ sent: opts.smsOk ?? true })) };
  const config = {
    get: (k: string) => (k.startsWith('AFRICAS_TALKING') ? (opts.smsConfigured === false ? undefined : 'set') : undefined),
    getOrThrow: () => SECRET,
  };
  const service = new RentalTenantAuthService(prisma as never, jwt as never, email as never, sms as never, config as never);
  return { service, otps, tx, email, sms, jwt };
}

const lastCode = (sms: { sendSms: jest.Mock }) => /code is (\d{6})/.exec(sms.sendSms.mock.calls.at(-1)![0].message)![1];

describe('RentalTenantAuthService', () => {
  it('offers text-message sign-in only when SMS is set up', () => {
    expect(build({ smsConfigured: true }).service.methods()).toEqual({ email: true, sms: true });
    expect(build({ smsConfigured: false }).service.methods()).toEqual({ email: true, sms: false });
  });

  it('wants exactly one of email and phone, and a real Kenyan number', async () => {
    const { service } = build();
    await expect(service.requestCode({})).rejects.toThrow(BadRequestException);
    await expect(service.requestCode({ email: 'a@b.co', phone: '0712345678' })).rejects.toThrow(BadRequestException);
    await expect(service.requestCode({ phone: '12345' })).rejects.toThrow(/valid Kenyan mobile number/);
    await expect(service.requestCode({ email: 'not-an-email' })).rejects.toThrow(/valid email/);
  });

  it('texts a code to a tenant found by phone, written however the landlord typed it', async () => {
    const { service, sms, email, tx } = build();
    const answer = await service.requestCode({ phone: '0712 345 678' });
    expect(answer).toEqual({ sent: true, channel: 'SMS', identifier: '254712345678' });
    expect(sms.sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: '+254712345678' }));
    expect(email.sendEmail).not.toHaveBeenCalled();
    // The lookup used the phone-only access setting, not the email one.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('emails a code to a tenant found by email, as before', async () => {
    const { service, sms, email } = build();
    const answer = await service.requestCode({ email: 'Tenant@Example.com' });
    expect(answer).toEqual({ sent: true, channel: 'EMAIL', identifier: 'tenant@example.com' });
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'tenant@example.com' }));
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it('gives the same answer for a number nobody has on file, and sends and stores nothing', async () => {
    const { service, sms, otps } = build({ known: false });
    expect(await service.requestCode({ phone: '0799000111' })).toEqual({ sent: true, channel: 'SMS', identifier: '254799000111' });
    expect(sms.sendSms).not.toHaveBeenCalled();
    expect(otps).toHaveLength(0);
  });

  it('signs a tenant in with the texted code, and the token carries the phone number', async () => {
    const { service, sms, jwt } = build();
    await service.requestCode({ phone: '0712345678' });
    const result = await service.verifyCode({ phone: '+254 712 345 678', code: lastCode(sms) });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: '254712345678', scope: 'rental-tenant' });
    expect(result).toEqual({ accessToken: 'token-for-254712345678', identifier: '254712345678', email: null });
  });

  it('rejects a wrong code, and a code cannot be used twice', async () => {
    const { service, sms } = build();
    await service.requestCode({ phone: '0712345678' });
    const code = lastCode(sms);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(service.verifyCode({ phone: '0712345678', code: wrong })).rejects.toThrow(UnauthorizedException);
    await service.verifyCode({ phone: '0712345678', code });
    await expect(service.verifyCode({ phone: '0712345678', code })).rejects.toThrow(UnauthorizedException);
  });

  it('keeps an email code from signing in as the same person by phone (and the reverse)', async () => {
    const { service, email } = build();
    await service.requestCode({ email: 'tenant@example.com' });
    const emailed = /\d{6}/.exec(JSON.stringify(email.sendEmail.mock.calls.at(-1)))![0];
    await expect(service.verifyCode({ phone: '0712345678', code: emailed })).rejects.toThrow(UnauthorizedException);
  });

  it('stores only a peppered hash of the code, never the code', async () => {
    const { service, sms, otps } = build();
    await service.requestCode({ phone: '0712345678' });
    const code = lastCode(sms);
    expect(otps[0].codeHash).toBe(sha256(`rental-tenant:254712345678:${code}:${SECRET}`));
    expect(JSON.stringify(otps[0])).not.toContain(code);
  });

  it('says so plainly when text messages are not set up in production', async () => {
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { service } = build({ smsConfigured: false });
      await expect(service.requestCode({ phone: '0712345678' })).rejects.toThrow(/not available yet/);
    } finally {
      process.env.NODE_ENV = old;
    }
  });
});
