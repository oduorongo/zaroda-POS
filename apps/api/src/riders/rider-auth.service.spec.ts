import { HttpException, UnauthorizedException } from '@nestjs/common';
import { sha256 } from '../online-orders/online-orders.util';
import { hashPin } from './rider-pin.util';
import { RiderAuthService } from './rider-auth.service';

const SECRET = 'test-buyer-secret';
const hashFor = (email: string, code: string) => sha256(`rider:${email}:${code}:${SECRET}`);

function setup(opts: { emailSent?: boolean; smsSent?: boolean; rider?: Record<string, unknown> | null; buyer?: Record<string, unknown> | null; recentCodes?: number; otp?: Record<string, unknown> | null } = {}) {
  const prisma = {
    buyer: {
      findUnique: jest.fn().mockResolvedValue(opts.buyer ?? null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    riderOtp: {
      count: jest.fn().mockResolvedValue(opts.recentCodes ?? 0),
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(opts.otp ?? null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    rider: {
      findUnique: jest.fn().mockResolvedValue(opts.rider ?? null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'rider-1', pinFailCount: 0, ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'rider-1', phone: '254712345678', ...data })),
      upsert: jest.fn().mockImplementation(({ create }) =>
        Promise.resolve({ id: 'rider-1', fullName: null, phone: null, vehicleType: null, plateNumber: null, area: null, status: 'PENDING', organizationId: null, createdAt: new Date(), ...create }),
      ),
    },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed-token') };
  const email = { sendEmail: jest.fn().mockResolvedValue({ sent: opts.emailSent ?? true }) };
  const sms = { sendSms: jest.fn().mockResolvedValue({ sent: opts.smsSent ?? true }) };
  const config = { getOrThrow: jest.fn(() => SECRET) };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new RiderAuthService(prisma as any, jwt as any, email as any, sms as any, config as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, prisma, jwt, email, sms };
}

const futureOtp = (email: string, code: string, extra: Record<string, unknown> = {}) => ({ id: 'otp-1', email, codeHash: hashFor(email, code), attempts: 0, ...extra });

describe('RiderAuthService.requestCode', () => {
  it('emails a code to the lowercased address and stores only its hash', async () => {
    const { service, email, prisma } = setup();
    const result = await service.requestCode('  Rider@Example.COM ');
    expect(result).toEqual({ sent: true, email: 'rider@example.com' });
    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('rider@example.com');
    const code = /\d{6}/.exec(sent.subject)?.[0] as string;
    expect(prisma.riderOtp.create.mock.calls[0][0].data.codeHash).toBe(hashFor('rider@example.com', code));
    expect(JSON.stringify(prisma.riderOtp.create.mock.calls[0])).not.toContain(code);
  });

  it('refuses to flood one address with codes', async () => {
    const { service, email } = setup({ recentCodes: 3 });
    await expect(service.requestCode('rider@example.com')).rejects.toBeInstanceOf(HttpException);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('says so when the email cannot be sent (in production)', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { service } = setup({ emailSent: false });
      await expect(service.requestCode('rider@example.com')).rejects.toBeInstanceOf(HttpException);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe('RiderAuthService.verifyCode', () => {
  it('signs a rider in with the right code, creating a pending rider the first time', async () => {
    const { service, prisma, jwt } = setup({ otp: futureOtp('rider@example.com', '123456') });
    const result = await service.verifyCode('rider@example.com', '123456');
    expect(result.accessToken).toBe('signed-token');
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'rider-1', scope: 'rider' });
    expect(prisma.rider.upsert.mock.calls[0][0].where).toEqual({ email: 'rider@example.com' });
    expect(result.rider).toMatchObject({ status: 'PENDING', kind: 'POOL', profileComplete: false });
    expect(prisma.riderOtp.updateMany).toHaveBeenCalledWith({ where: { id: 'otp-1', consumedAt: null }, data: { consumedAt: expect.any(Date) } });
  });

  it('refuses a wrong code', async () => {
    const { service, jwt } = setup({ otp: futureOtp('rider@example.com', '123456') });
    await expect(service.verifyCode('rider@example.com', '654321')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('refuses when there is no live code, or too many wrong tries were made', async () => {
    await expect(setup({ otp: null }).service.verifyCode('rider@example.com', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
    const { service } = setup({ otp: futureOtp('rider@example.com', '123456', { attempts: 5 }) });
    await expect(service.verifyCode('rider@example.com', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not accept a code that was meant for a shopper sign-in of the same address', async () => {
    // A shopper code is hashed without the "rider:" tag, so it cannot verify here.
    const shopperHash = sha256(`rider@example.com:123456:${SECRET}`);
    const { service } = setup({ otp: { id: 'otp-1', email: 'rider@example.com', codeHash: shopperHash, attempts: 0 } });
    await expect(service.verifyCode('rider@example.com', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a code can be used only once, even if two requests race', async () => {
    const { service, prisma } = setup({ otp: futureOtp('rider@example.com', '123456') });
    prisma.riderOtp.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.verifyCode('rider@example.com', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('RiderAuthService phone + PIN', () => {
  const stored = (pin: string, extra: Record<string, unknown> = {}) => ({
    id: 'rider-1', phone: '254712345678', fullName: 'Juma', pinFailCount: 0, pinLockedUntil: null, pinHash: hashPin(pin, SECRET), ...extra,
  });

  it('signs a new rider up with a hashed PIN and starts them as a pending rider', async () => {
    const { service, prisma } = setup();
    const result = await service.signup({ fullName: ' Juma ', phone: '0712 345 678', pin: '4821' });
    const data = prisma.rider.create.mock.calls[0][0].data;
    expect(data.phone).toBe('254712345678');
    expect(data.pinHash).not.toContain('4821');
    expect(result.accessToken).toBe('signed-token');
  });

  it('refuses to sign up a number that is already registered', async () => {
    const { service } = setup({ rider: stored('4821') });
    await expect(service.signup({ fullName: 'Juma', phone: '0712345678', pin: '4821' })).rejects.toThrow(/already registered/);
  });

  it('signs in with the right PIN', async () => {
    const { service } = setup({ rider: stored('4821') });
    const result = await service.loginWithPin('0712345678', '4821');
    expect(result.accessToken).toBe('signed-token');
  });

  it('rejects a wrong PIN, counting the failure', async () => {
    const { service, prisma } = setup({ rider: stored('4821') });
    await expect(service.loginWithPin('0712345678', '0000')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.rider.update.mock.calls[0][0].data.pinFailCount).toBe(1);
  });

  it('locks the account after five wrong PINs', async () => {
    const { service, prisma } = setup({ rider: stored('4821', { pinFailCount: 4 }) });
    await expect(service.loginWithPin('0712345678', '0000')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.rider.update.mock.calls[0][0].data.pinLockedUntil).toBeInstanceOf(Date);
  });

  it('refuses even the right PIN while locked', async () => {
    const { service } = setup({ rider: stored('4821', { pinLockedUntil: new Date(Date.now() + 600_000) }) });
    await expect(service.loginWithPin('0712345678', '4821')).rejects.toBeInstanceOf(HttpException);
  });

  it('gives the same answer for an unknown number as for a wrong PIN', async () => {
    const { service } = setup({ rider: null });
    await expect(service.loginWithPin('0712345678', '4821')).rejects.toThrow('Wrong phone number or PIN');
  });

  it('texts a reset code when the network accepts it, and tells the rider to ask their shop when it does not', async () => {
    const ok = setup({ rider: stored('4821'), smsSent: true });
    expect((await ok.service.requestPinReset('0712345678')).sent).toBe(true);
    const code = /\d{6}/.exec(ok.sms.sendSms.mock.calls[0][0].message)?.[0] as string;
    expect(ok.prisma.riderOtp.create.mock.calls[0][0].data.codeHash).toBe(hashFor('254712345678', code));

    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const blocked = setup({ rider: stored('4821'), smsSent: false });
      const result = await blocked.service.requestPinReset('0712345678');
      expect(result.sent).toBe(false);
      expect(result.message).toMatch(/shop or Zaroda/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('sets a new PIN with a valid code and clears any lock', async () => {
    const { service, prisma } = setup({ rider: stored('4821'), otp: futureOtp('254712345678', '123456', { expiresAt: new Date(Date.now() + 60_000) }) });
    await service.resetPin('0712345678', '123456', '9087');
    const data = prisma.rider.update.mock.calls[0][0].data;
    expect(data.pinFailCount).toBe(0);
    expect(data.pinLockedUntil).toBeNull();
    expect(data.pinHash).not.toContain('9087');
  });
});

describe('RiderAuthService one login with the shopper account', () => {
  const buyer = (pin: string, extra: Record<string, unknown> = {}) => ({
    id: 'buyer-1', phone: '254712345678', name: 'Amina', pinFailCount: 0, pinLockedUntil: null, pinHash: hashPin(pin, SECRET), ...extra,
  });

  it('lets a shopper in with their shopper PIN, opening a (pending) rider account for the number', async () => {
    const shopper = buyer('4821');
    const { service, prisma } = setup({ rider: null, buyer: shopper });
    const result = await service.loginWithPin('0712345678', '4821');
    const data = prisma.rider.create.mock.calls[0][0].data;
    expect(data.phone).toBe('254712345678');
    expect(data.fullName).toBe('Amina');
    expect(data.pinHash).toBe(shopper.pinHash);
    expect(result.accessToken).toBe('signed-token');
  });

  it('refuses a wrong shopper PIN and counts it against the shopper account', async () => {
    const { service, prisma } = setup({ rider: null, buyer: buyer('4821') });
    await expect(service.loginWithPin('0712345678', '0000')).rejects.toThrow('Wrong phone number or PIN');
    expect(prisma.buyer.update.mock.calls[0][0].data.pinFailCount).toBe(1);
    expect(prisma.rider.create).not.toHaveBeenCalled();
  });

  it('never attaches to a shopper account that has no PIN', async () => {
    const { service, prisma } = setup({ rider: null, buyer: buyer('4821', { pinHash: null }) });
    await expect(service.loginWithPin('0712345678', '4821')).rejects.toThrow('Wrong phone number or PIN');
    expect(prisma.rider.create).not.toHaveBeenCalled();
  });

  it('gives a new PIN to the shopper account too when a code proved the number', async () => {
    const { service, prisma } = setup({ rider: { id: 'rider-1', phone: '254712345678', pinHash: 'x' }, otp: futureOtp('254712345678', '123456', { expiresAt: new Date(Date.now() + 60_000) }) });
    await service.resetPin('0712345678', '123456', '9087');
    expect(prisma.buyer.updateMany.mock.calls[0][0].where).toEqual({ phone: '254712345678' });
    expect(prisma.buyer.updateMany.mock.calls[0][0].data.pinHash).toBe(prisma.rider.update.mock.calls[0][0].data.pinHash);
  });
});
