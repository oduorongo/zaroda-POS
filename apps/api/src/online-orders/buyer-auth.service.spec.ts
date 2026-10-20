import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { BuyerAuthService } from './buyer-auth.service';
import { hashPin } from '../riders/rider-pin.util';
import { sha256 } from './online-orders.util';

const SECRET = 'test-buyer-secret';
const hashFor = (identifier: string, code: string) => sha256(`${identifier}:${code}:${SECRET}`);

function setup(opts: { sms?: boolean; emailSent?: boolean; smsSent?: boolean; recentCodes?: number; otp?: Record<string, unknown> | null; rider?: Record<string, unknown> | null } = {}) {
  const prisma = {
    rider: {
      findUnique: jest.fn().mockResolvedValue(opts.rider ?? null),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
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
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'buyer-1', email: null, name: null, ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'buyer-1', email: null, phone: '254712345678', name: null, pinHash: null, ...data })),
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
    expect(setup().service.methods()).toEqual({ email: true, sms: false, pin: true });
    expect(setup({ sms: true }).service.methods()).toEqual({ email: true, sms: true, pin: true });
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
    expect(result).toEqual({ accessToken: 'signed-token', buyer: { id: 'buyer-1', email: 'shopper@example.com', phone: null, name: null, hasPin: false } });
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

describe('BuyerAuthService phone + PIN', () => {
  const stored = (pin: string, extra: Record<string, unknown> = {}) => ({
    id: 'buyer-1', email: null, phone: '254712345678', name: null, pinFailCount: 0, pinLockedUntil: null, pinHash: hashPin(pin, SECRET), ...extra,
  });

  it('signs a shopper up by phone and PIN, storing only a hash', async () => {
    const { service, prisma } = setup();
    prisma.buyer.findUnique.mockResolvedValue(null);
    const result = await service.signupWithPin({ phone: '0712 345 678', pin: '4821', name: ' Amina ' });
    const data = prisma.buyer.create.mock.calls[0][0].data;
    expect(data.phone).toBe('254712345678');
    expect(data.name).toBe('Amina');
    expect(data.pinHash).not.toContain('4821');
    expect(result.accessToken).toBe('signed-token');
  });

  it('will not let a sign-up take over a number that already has an account', async () => {
    const { service, prisma } = setup();
    prisma.buyer.findUnique.mockResolvedValue(stored('4821', { pinHash: null }));
    await expect(service.signupWithPin({ phone: '0712345678', pin: '4821' })).rejects.toThrow(/already used/);
    expect(prisma.buyer.create).not.toHaveBeenCalled();
  });

  it('signs in with the right PIN and counts a wrong one', async () => {
    const ok = setup();
    ok.prisma.buyer.findUnique.mockResolvedValue(stored('4821'));
    expect((await ok.service.loginWithPin('0712345678', '4821')).accessToken).toBe('signed-token');

    const bad = setup();
    bad.prisma.buyer.findUnique.mockResolvedValue(stored('4821'));
    await expect(bad.service.loginWithPin('0712345678', '0000')).rejects.toThrow('Wrong phone number or PIN');
    expect(bad.prisma.buyer.update.mock.calls[0][0].data.pinFailCount).toBe(1);
  });

  it('locks after five wrong PINs and refuses even the right PIN while locked', async () => {
    const fifth = setup();
    fifth.prisma.buyer.findUnique.mockResolvedValue(stored('4821', { pinFailCount: 4 }));
    await expect(fifth.service.loginWithPin('0712345678', '0000')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fifth.prisma.buyer.update.mock.calls[0][0].data.pinLockedUntil).toBeInstanceOf(Date);

    const locked = setup();
    locked.prisma.buyer.findUnique.mockResolvedValue(stored('4821', { pinLockedUntil: new Date(Date.now() + 600_000) }));
    await expect(locked.service.loginWithPin('0712345678', '4821')).rejects.toBeInstanceOf(HttpException);
  });

  it('answers an unknown number and an account with no PIN exactly like a wrong PIN', async () => {
    const none = setup();
    none.prisma.buyer.findUnique.mockResolvedValue(null);
    await expect(none.service.loginWithPin('0712345678', '4821')).rejects.toThrow('Wrong phone number or PIN');
    const noPin = setup();
    noPin.prisma.buyer.findUnique.mockResolvedValue(stored('4821', { pinHash: null }));
    await expect(noPin.service.loginWithPin('0712345678', '4821')).rejects.toThrow('Wrong phone number or PIN');
  });

  it('sends a reset code by text, or by email when the text cannot be delivered', async () => {
    const texted = setup({ smsSent: true });
    texted.prisma.buyer.findUnique.mockResolvedValue(stored('4821', { email: 'amina@example.com' }));
    expect((await texted.service.requestPinReset('0712345678')).via).toBe('sms');
    const code = /\d{6}/.exec(texted.sms.sendSms.mock.calls[0][0].message)?.[0] as string;
    expect(texted.prisma.buyerOtp.create.mock.calls[0][0].data.codeHash).toBe(hashFor('254712345678', code));

    const emailed = setup({ smsSent: false, emailSent: true });
    emailed.prisma.buyer.findUnique.mockResolvedValue(stored('4821', { email: 'amina@example.com' }));
    const result = await emailed.service.requestPinReset('0712345678');
    expect(result.via).toBe('email');
    expect(result.message).not.toContain('amina@example.com');
  });

  it('points the shopper to support when neither a text nor an email can be sent', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { service, prisma } = setup({ smsSent: false });
      prisma.buyer.findUnique.mockResolvedValue(stored('4821'));
      const result = await service.requestPinReset('0712345678');
      expect(result.sent).toBe(false);
      expect(result.message).toMatch(/WhatsApp/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('sets a new PIN with a valid code and clears any lock', async () => {
    const { service, prisma } = setup({ otp: futureOtp('254712345678', '123456', { expiresAt: new Date(Date.now() + 60_000) }) });
    prisma.buyer.findUnique.mockResolvedValue(stored('4821', { pinFailCount: 3 }));
    await service.resetPin('0712345678', '123456', '9087');
    const data = prisma.buyer.update.mock.calls[0][0].data;
    expect(data.pinFailCount).toBe(0);
    expect(data.pinLockedUntil).toBeNull();
    expect(data.pinHash).not.toContain('9087');
  });

  it('lets a signed-in shopper add a phone and PIN, but not take a number that belongs to someone else', async () => {
    const free = setup();
    free.prisma.buyer.findUnique.mockResolvedValueOnce({ id: 'buyer-1', email: 'a@b.co', phone: null, pinHash: null }).mockResolvedValueOnce(null);
    const view = await free.service.setPin('buyer-1', '4821', '0712345678');
    expect(view.phone).toBe('254712345678');
    expect(view.hasPin).toBe(true);

    const taken = setup();
    taken.prisma.buyer.findUnique.mockResolvedValueOnce({ id: 'buyer-1', email: 'a@b.co', phone: null, pinHash: null }).mockResolvedValueOnce({ id: 'someone-else' });
    await expect(taken.service.setPin('buyer-1', '4821', '0712345678')).rejects.toThrow(/already used/);
  });
});

describe('BuyerAuthService one login with the rider account', () => {
  const rider = (pin: string, extra: Record<string, unknown> = {}) => ({
    id: 'rider-1', phone: '254712345678', fullName: 'Juma', pinFailCount: 0, pinLockedUntil: null, pinHash: hashPin(pin, SECRET), ...extra,
  });

  it('lets a rider in with their rider PIN, opening a shopper account for the number', async () => {
    const rid = rider('4821');
    const { service, prisma } = setup({ rider: rid });
    prisma.buyer.findUnique.mockResolvedValue(null);
    const result = await service.loginWithPin('0712345678', '4821');
    const data = prisma.buyer.create.mock.calls[0][0].data;
    expect(data.phone).toBe('254712345678');
    expect(data.name).toBe('Juma');
    expect(data.pinHash).toBe(rid.pinHash);
    expect(result.accessToken).toBe('signed-token');
  });

  it('refuses a wrong rider PIN and counts it against the rider account', async () => {
    const { service, prisma } = setup({ rider: rider('4821') });
    prisma.buyer.findUnique.mockResolvedValue(null);
    await expect(service.loginWithPin('0712345678', '0000')).rejects.toThrow('Wrong phone number or PIN');
    expect(prisma.rider.update.mock.calls[0][0].data.pinFailCount).toBe(1);
    expect(prisma.buyer.create).not.toHaveBeenCalled();
  });

  it('never takes over a shopper account that already exists for the number, even one with no PIN', async () => {
    const { service, prisma } = setup({ rider: rider('4821') });
    prisma.buyer.findUnique.mockResolvedValue({ id: 'buyer-9', phone: '254712345678', pinHash: null });
    await expect(service.loginWithPin('0712345678', '4821')).rejects.toThrow('Wrong phone number or PIN');
    expect(prisma.buyer.create).not.toHaveBeenCalled();
  });

  it('gives a new PIN to the rider account too when a code proved the number', async () => {
    const { service, prisma } = setup({ otp: futureOtp('254712345678', '123456', { expiresAt: new Date(Date.now() + 60_000) }) });
    prisma.buyer.findUnique.mockResolvedValue({ id: 'buyer-1', phone: '254712345678', email: null, name: null, pinHash: 'x' });
    await service.resetPin('0712345678', '123456', '9087');
    expect(prisma.rider.updateMany.mock.calls[0][0].where).toEqual({ phone: '254712345678' });
  });
});
