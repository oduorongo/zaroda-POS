import { HttpException, UnauthorizedException } from '@nestjs/common';
import { sha256 } from '../online-orders/online-orders.util';
import { RiderAuthService } from './rider-auth.service';

const SECRET = 'test-buyer-secret';
const hashFor = (email: string, code: string) => sha256(`rider:${email}:${code}:${SECRET}`);

function setup(opts: { emailSent?: boolean; recentCodes?: number; otp?: Record<string, unknown> | null } = {}) {
  const prisma = {
    riderOtp: {
      count: jest.fn().mockResolvedValue(opts.recentCodes ?? 0),
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(opts.otp ?? null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    rider: {
      upsert: jest.fn().mockImplementation(({ create }) =>
        Promise.resolve({ id: 'rider-1', fullName: null, phone: null, vehicleType: null, plateNumber: null, area: null, status: 'PENDING', organizationId: null, createdAt: new Date(), ...create }),
      ),
    },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed-token') };
  const email = { sendEmail: jest.fn().mockResolvedValue({ sent: opts.emailSent ?? true }) };
  const config = { getOrThrow: jest.fn(() => SECRET) };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new RiderAuthService(prisma as any, jwt as any, email as any, config as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, prisma, jwt, email };
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
