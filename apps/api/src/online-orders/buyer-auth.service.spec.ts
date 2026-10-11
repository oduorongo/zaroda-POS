import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { BuyerAuthService } from './buyer-auth.service';
import { sha256 } from './online-orders.util';

const SECRET = 'test-buyer-secret';
const hashFor = (identifier: string, code: string) => sha256(`${identifier}:${code}:${SECRET}`);

function setup(opts: { sms?: boolean; emailSent?: boolean; smsSent?: boolean; recentCodes?: number; otp?: Record<string, unknown> | null } = {}) {
  const prisma = {
    buyerOtp: {
      count: jest.fn().mockResolvedValue(opts.recentCodes ?? 0),
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(opts.otp ?? null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    buyer: {
      upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'buyer-1', email: null, phone: null, name: null, ...create })),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed-token') };
  const sms = { sendSms: jest.fn().mockResolvedValue({ sent: opts.smsSent ?? true }) };
  const email = { sendEmail: jest.fn().mockResolvedValue({ sent: opts.emailSent ?? true }) };
  const config = {
    get: jest.fn((k: string) => (opts.sms && (k === 'AFRICAS_TALKING_API_KEY' || k === 'AFRICAS_TALKING_USERNAME') ? 'configured' : undefined)),
    getOrThrow: jest.fn(() => SECRET),
  };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new BuyerAuthService(prisma as any, jwt as any, sms as any, email as any, config as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, prisma, jwt, sms, email };
}

const futureOtp = (identifier: string, code: string, extra: Record<string, unknown> = {}) => ({
  id: 'otp-1',
  channel: identifier.includes('@') ? 'EMAIL' : 'SMS',
  identifier,
  codeHash: hashFor(identifier, code),
  attempts: 0,
  ...extra,
});

describe('BuyerAuthService.methods', () => {
  it('always offers email, and SMS only when Africa\'s Talking is configured', () => {
    expect(setup().service.methods()).toEqual({ email: true, sms: false });
    expect(setup({ sms: true }).service.methods()).toEqual({ email: true, sms: true });
  });
});

describe('BuyerAuthService.requestCode', () => {
  it('emails a code to a lowercased address and records it against that address', async () => {
    const { service, email, prisma } = setup();
    const result = await service.requestCode({ email: '  Shopper@Example.COM ' });
    expect(result).toEqual({ sent: true, channel: 'EMAIL', identifier: 'shopper@example.com' });
    expect(prisma.buyerOtp.create).toHaveBeenCalledWith({ data: expect.objectContaining({ channel: 'EMAIL', identifier: 'shopper@example.com' }) });
    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('shopper@example.com');
    // The 6-digit code is in the subject and the body, and is stored only as a hash.
    const code = /\d{6}/.exec(sent.subject)?.[0] as string;
    expect(sent.html).toContain(code);
    expect(prisma.buyerOtp.create.mock.calls[0][0].data.codeHash).toBe(hashFor('shopper@example.com', code));
    expect(JSON.stringify(prisma.buyerOtp.create.mock.calls[0])).not.toContain(code);
  });

  it('sends an SMS to a normalized phone number', async () => {
    const { service, sms } = setup({ sms: true });
    const result = await service.requestCode({ phone: '0712 345 678' });
    expect(result).toEqual({ sent: true, channel: 'SMS', identifier: '254712345678' });
    expect(sms.sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: '+254712345678' }));
  });

  it('needs exactly one of email or phone, and both must be valid', async () => {
    const { service } = setup();
    await expect(service.requestCode({})).rejects.toThrow(BadRequestException);
    await expect(service.requestCode({ email: 'a@b.co', phone: '0712345678' })).rejects.toThrow(/either an email address or a phone number/);
    await expect(service.requestCode({ email: 'not-an-email' })).rejects.toThrow(/valid email/);
    await expect(service.requestCode({ phone: '12345' })).rejects.toThrow(/valid Kenyan mobile number/);
  });

  it('refuses to flood one address with codes', async () => {
    const { service, email } = setup({ recentCodes: 3 });
    await expect(service.requestCode({ email: 'a@b.co' })).rejects.toThrow(HttpException);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('tells a shopper to use email when SMS is not set up, in production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { service, sms } = setup({ sms: false });
      await expect(service.requestCode({ phone: '0712345678' })).rejects.toThrow(/use your email/);
      expect(sms.sendSms).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('fails clearly in production when the email could not be sent, but not in development', async () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      await expect(setup({ emailSent: false }).service.requestCode({ email: 'a@b.co' })).resolves.toMatchObject({ sent: true });
      process.env.NODE_ENV = 'production';
      await expect(setup({ emailSent: false }).service.requestCode({ email: 'a@b.co' })).rejects.toThrow(/Could not send the email/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe('BuyerAuthService.verifyCode', () => {
  it('signs a shopper in with the right emailed code, creating the account by email', async () => {
    const { service, prisma, jwt } = setup({ otp: futureOtp('shopper@example.com', '123456') });
    const result = await service.verifyCode({ email: 'Shopper@Example.com', code: '123456' });
    expect(prisma.buyer.upsert).toHaveBeenCalledWith({ where: { email: 'shopper@example.com' }, create: { email: 'shopper@example.com' }, update: {} });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'buyer-1', scope: 'buyer' });
    expect(result).toEqual({ accessToken: 'signed-token', buyer: { id: 'buyer-1', email: 'shopper@example.com', phone: null, name: null } });
  });

  it('creates the account by phone for an SMS code', async () => {
    const { service, prisma } = setup({ otp: futureOtp('254712345678', '654321') });
    await service.verifyCode({ phone: '0712345678', code: '654321' });
    expect(prisma.buyer.upsert).toHaveBeenCalledWith({ where: { phone: '254712345678' }, create: { phone: '254712345678' }, update: {} });
  });

  it('refuses a wrong code, a used-up code, and no code at all', async () => {
    await expect(setup({ otp: futureOtp('a@b.co', '123456') }).service.verifyCode({ email: 'a@b.co', code: '000000' })).rejects.toThrow(UnauthorizedException);
    await expect(setup({ otp: futureOtp('a@b.co', '123456', { attempts: 5 }) }).service.verifyCode({ email: 'a@b.co', code: '123456' })).rejects.toThrow(UnauthorizedException);
    await expect(setup({ otp: null }).service.verifyCode({ email: 'a@b.co', code: '123456' })).rejects.toThrow(UnauthorizedException);
  });

  it('counts every guess, right or wrong, before comparing', async () => {
    const { service, prisma } = setup({ otp: futureOtp('a@b.co', '123456') });
    await expect(service.verifyCode({ email: 'a@b.co', code: '999999' })).rejects.toThrow();
    expect(prisma.buyerOtp.update).toHaveBeenCalledWith({ where: { id: 'otp-1' }, data: { attempts: { increment: 1 } } });
  });

  it('lets a code be used only once, even if two requests race', async () => {
    const { service, prisma, jwt } = setup({ otp: futureOtp('a@b.co', '123456') });
    prisma.buyerOtp.updateMany.mockResolvedValue({ count: 0 }); // someone else consumed it first
    await expect(service.verifyCode({ email: 'a@b.co', code: '123456' })).rejects.toThrow(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('does not accept a code that was sent to a different address', async () => {
    // The stored hash is for another@example.com; the same digits for a@b.co must not match.
    const { service } = setup({ otp: futureOtp('another@example.com', '123456') });
    await expect(service.verifyCode({ email: 'a@b.co', code: '123456' })).rejects.toThrow(UnauthorizedException);
  });
});
