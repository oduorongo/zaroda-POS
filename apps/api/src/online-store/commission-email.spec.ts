import { buildInvoiceEmail, buildReceiptEmail, nextReminderStage } from './commission-email';
import { invoiceDueDate, pauseDate } from './commission.util';

const day = 24 * 60 * 60 * 1000;
const issued = new Date('2026-11-01T06:00:00Z');
const due = invoiceDueDate(issued);
const inv = (reminderStage: number, status: 'ISSUED' | 'PAID' | 'WAIVED' = 'ISSUED') => ({ status, dueDate: due, reminderStage });

describe('nextReminderStage', () => {
  it('sends the issued notice straight away', () => {
    expect(nextReminderStage(inv(0), issued)).toBe(1);
  });

  it('says nothing new until the due-soon window opens', () => {
    expect(nextReminderStage(inv(1), new Date(due.getTime() - 5 * day))).toBeNull();
    expect(nextReminderStage(inv(1), new Date(due.getTime() - 2 * day))).toBe(2);
  });

  it('then overdue, then shop hidden - each only once', () => {
    expect(nextReminderStage(inv(2), new Date(due.getTime() + day))).toBe(3);
    expect(nextReminderStage(inv(3), new Date(due.getTime() + 2 * day))).toBeNull();
    expect(nextReminderStage(inv(3), new Date(pauseDate(due).getTime() + 1))).toBe(4);
    expect(nextReminderStage(inv(4), new Date(pauseDate(due).getTime() + 30 * day))).toBeNull();
  });

  it('after a long outage jumps to the stage reached instead of replaying old notices', () => {
    expect(nextReminderStage(inv(0), new Date(pauseDate(due).getTime() + 10 * day))).toBe(4);
  });

  it('never emails a paid or waived invoice', () => {
    expect(nextReminderStage(inv(0, 'PAID'), due)).toBeNull();
    expect(nextReminderStage(inv(2, 'WAIVED'), new Date(due.getTime() + 10 * day))).toBeNull();
  });
});

const invoice = {
  invoiceNumber: 'ZC-202610-7K3Q',
  periodMonth: '2026-10',
  orderCount: 12,
  salesTotal: 20000,
  commissionTotal: 600,
  amountDue: 600,
  dueDate: due,
};

describe('buildInvoiceEmail', () => {
  it('names the invoice, amount and a pay link', () => {
    const email = buildInvoiceEmail(1, invoice, 'Mama Mboga', 'https://app.example/settings/online-shop');
    expect(email.subject).toContain('ZC-202610-7K3Q');
    expect(email.html).toContain('Pay KES 600.00 with M-Pesa');
    expect(email.html).toContain('https://app.example/settings/online-shop');
    expect(email.text).toContain('Pay online: https://app.example/settings/online-shop');
  });

  it('gets sharper at each stage, and the last warns the shop is hidden', () => {
    expect(buildInvoiceEmail(2, invoice, 'S', null).subject).toMatch(/Reminder/);
    expect(buildInvoiceEmail(3, invoice, 'S', null).subject).toMatch(/Overdue/);
    expect(buildInvoiceEmail(4, invoice, 'S', null).subject).toMatch(/hidden/);
  });

  it('omits the button when there is no pay link', () => {
    expect(buildInvoiceEmail(1, invoice, 'S', null).html).not.toContain('with M-Pesa');
  });

  it("escapes a shop name so it can't inject markup into the email", () => {
    const email = buildInvoiceEmail(1, invoice, '<script>alert(1)</script>', null);
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});

describe('buildReceiptEmail', () => {
  it('confirms the amount and M-Pesa receipt', () => {
    const email = buildReceiptEmail(invoice, 'Mama Mboga', 'QAB123', false);
    expect(email.subject).toContain('Payment received');
    expect(email.text).toContain('QAB123');
  });
});
