import { buildJobOpenEmail, buildNewQuoteEmail, buildPickedUpEmail, buildRiderChosenEmail } from './delivery-email';
import { DeliveryNotifier, MAX_JOB_EMAILS } from './delivery-notifier';

function setup(opts: { buyerEmail?: string | null; sent?: boolean; sendThrows?: boolean; base?: string; smsSent?: boolean } = {}) {
  const prisma = { buyer: { findUnique: jest.fn().mockResolvedValue(opts.buyerEmail === undefined ? { email: 'amina@example.com' } : { email: opts.buyerEmail }) } };
  const email = {
    sendEmail: opts.sendThrows ? jest.fn().mockRejectedValue(new Error('boom')) : jest.fn().mockResolvedValue({ sent: opts.sent ?? true }),
  };
  const sms = { sendSms: jest.fn().mockResolvedValue({ sent: opts.smsSent ?? false }) };
  const config = { get: jest.fn((k: string) => (k === 'STOREFRONT_BASE_URL' ? opts.base : undefined)) };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const notifier = new DeliveryNotifier(prisma as any, email as any, sms as any, config as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { notifier, prisma, email, sms };
}

const job = { shopName: 'Demo <Shop>', pickupArea: 'Main Branch, Kisumu', dropoffSummary: 'Milimani, Kisumu', itemCount: 2, quoteDeadline: new Date('2026-10-12T12:30:00Z') };

describe('DeliveryNotifier', () => {
  it('emails the shopper about the first price, linking to their order', async () => {
    const { notifier, email } = setup();
    await notifier.newQuote('buyer-1', { orderId: 'order-1', orderNumber: 'ZR-AAAAAA', shopName: 'Demo Shop', fee: 150, deadline: job.quoteDeadline });
    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('amina@example.com');
    expect(sent.subject).toContain('ZR-AAAAAA');
    expect(sent.subject).toContain('KES 150');
    expect(sent.html).toContain('https://shop.zarodashop.com/orders/order-1');
  });

  it('does not write to a shopper who signed in by phone (no email address)', async () => {
    const { notifier, email } = setup({ buyerEmail: null });
    await notifier.newQuote('buyer-1', { orderId: 'o', orderNumber: 'ZR-1', shopName: 'S', fee: 100, deadline: job.quoteDeadline });
    await notifier.pickedUp('buyer-1', { orderId: 'o', orderNumber: 'ZR-1', shopName: 'S', agreedFee: 100 });
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('uses the configured shop address for links', async () => {
    const { notifier, email } = setup({ base: 'https://shop.example.test/' });
    await notifier.riderChosen({ email: 'juma@example.com', fullName: 'Juma' }, { shopName: 'S', pickupArea: 'A', dropoffSummary: 'B', fee: 150 });
    expect(email.sendEmail.mock.calls[0][0].html).toContain('https://shop.example.test/rider');
  });

  it('never fails the request: a provider that is down, errors or is not configured is swallowed', async () => {
    await expect(setup({ sent: false }).notifier.riderChosen({ email: 'a@b.co', fullName: null }, { shopName: 'S', pickupArea: 'A', dropoffSummary: 'B', fee: 100 })).resolves.toBeUndefined();
    await expect(setup({ sendThrows: true }).notifier.jobOpen([{ email: 'a@b.co', fullName: null }], job)).resolves.toBeUndefined();
    const broken = setup();
    broken.prisma.buyer.findUnique.mockRejectedValue(new Error('db down'));
    await expect(broken.notifier.newQuote('buyer-1', { orderId: 'o', orderNumber: 'ZR-1', shopName: 'S', fee: 100, deadline: job.quoteDeadline })).resolves.toBeUndefined();
    expect(broken.email.sendEmail).not.toHaveBeenCalled();
  });

  it('caps a job-open announcement, so asking "anyone" cannot flood the pool or the daily email allowance', async () => {
    const { notifier, email } = setup();
    const riders = Array.from({ length: MAX_JOB_EMAILS + 15 }, (_, i) => ({ email: `rider${i}@example.com`, fullName: `Rider ${i}` }));
    await notifier.jobOpen(riders, job);
    expect(email.sendEmail).toHaveBeenCalledTimes(MAX_JOB_EMAILS);
  });
});

describe('delivery emails', () => {
  const all = [
    buildJobOpenEmail('Juma', job, 'https://shop.zarodashop.com/rider'),
    buildNewQuoteEmail('ZR-AAAAAA', job.shopName, 150, job.quoteDeadline, 'https://shop.zarodashop.com/orders/o1'),
    buildRiderChosenEmail('Juma', job.shopName, job.pickupArea, job.dropoffSummary, 150, 'https://shop.zarodashop.com/rider'),
    buildPickedUpEmail('ZR-AAAAAA', job.shopName, 150, 'https://shop.zarodashop.com/orders/o1'),
  ];

  it('escape anything a shop or rider typed, so a name cannot inject markup', () => {
    for (const mail of all) {
      expect(mail.html).not.toContain('<Shop>');
      expect(mail.html.includes('Demo &lt;Shop&gt;') || !mail.html.includes('Demo')).toBe(true);
    }
  });

  it('every email has a subject, a text version and a button to the right page', () => {
    for (const mail of all) {
      expect(mail.subject.length).toBeGreaterThan(5);
      expect(mail.text.length).toBeGreaterThan(20);
      expect(mail.html).toMatch(/href="https:\/\/shop\.zarodashop\.com\/(rider|orders\/o1)"/);
    }
  });

  it('never put a phone number, a full address or the delivery code in an email', () => {
    for (const mail of all) {
      const body = `${mail.subject} ${mail.html} ${mail.text}`;
      expect(body).not.toMatch(/254\d{9}/);
      expect(body).not.toMatch(/\b0\d{9}\b/);
      expect(body).not.toMatch(/\bcode:? \d{4}\b/i);
    }
  });

  it('give the times in Nairobi time, not the server\'s', () => {
    // 12:30 UTC is 15:30 in Nairobi
    expect(all[0].html).toMatch(/3:30\s?PM|15:30/i);
  });

  it('tell the shopper to hold back the code until the goods have arrived', () => {
    expect(all[3].html).toMatch(/only AFTER/);
    expect(all[2].html).toMatch(/4-digit code/);
  });
});

describe('DeliveryNotifier texts', () => {
  it('texts a rider with a phone and does not also email them', async () => {
    const { notifier, email, sms } = setup({ smsSent: true });
    await notifier.riderChosen({ email: 'juma@example.com', phone: '254712345678', fullName: 'Juma' }, { shopName: 'S', pickupArea: 'A', dropoffSummary: 'B', fee: 150 });
    expect(sms.sendSms.mock.calls[0][0].to).toBe('+254712345678');
    expect(sms.sendSms.mock.calls[0][0].message).toContain('https://shop.zarodashop.com/rider');
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to email when the text cannot be delivered (e.g. a Safaricom number)', async () => {
    const { notifier, email, sms } = setup({ smsSent: false });
    await notifier.riderChosen({ email: 'juma@example.com', phone: '254712345678', fullName: 'Juma' }, { shopName: 'S', pickupArea: 'A', dropoffSummary: 'B', fee: 150 });
    expect(sms.sendSms).toHaveBeenCalledTimes(1);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('quietly does nothing for a rider with no email whose text cannot be delivered', async () => {
    const { notifier, email } = setup({ smsSent: false });
    await expect(notifier.jobOpen([{ email: null, phone: '254712345678', fullName: 'Juma' }], job)).resolves.toBeUndefined();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('texts a shopper who signed in by phone', async () => {
    const { notifier, prisma, sms } = setup({ smsSent: true });
    prisma.buyer.findUnique.mockResolvedValue({ email: null, phone: '254722000111' });
    await notifier.pickedUp('buyer-1', { orderId: 'o', orderNumber: 'ZR-1', shopName: 'S', agreedFee: 100 });
    expect(sms.sendSms.mock.calls[0][0].to).toBe('+254722000111');
    expect(sms.sendSms.mock.calls[0][0].message).toContain('KES 100');
  });

  it('keeps every text within one SMS even with long names', async () => {
    const { notifier, sms } = setup({ smsSent: true });
    await notifier.jobOpen([{ email: null, phone: '254712345678', fullName: null }], { ...job, shopName: 'A very long shop name that goes on and on', dropoffSummary: 'A very long drop off place name' });
    expect(sms.sendSms.mock.calls[0][0].message.length).toBeLessThanOrEqual(190);
  });
});
