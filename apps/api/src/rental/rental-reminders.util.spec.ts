import { buildReminderEmail, buildReminderSms, reminderStage } from './rental-reminders.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('reminderStage', () => {
  const today = d('2026-10-14');
  it.each([
    ['2026-10-18', null], // 4 days away: too early
    ['2026-10-17', 'UPCOMING'],
    ['2026-10-15', 'UPCOMING'],
    ['2026-10-14', 'DUE'],
    ['2026-10-12', 'DUE'],
    ['2026-10-11', 'OVERDUE'],
    ['2026-10-05', 'OVERDUE'],
    ['2026-10-04', 'FINAL'],
    ['2026-08-15', 'FINAL'],
    ['2026-08-01', null], // long gone: stop nagging
  ])('due %s -> %s', (due, expected) => {
    expect(reminderStage(d(due), today)).toBe(expected);
  });
});

describe('reminder messages', () => {
  const facts = {
    business: 'Zaroda Apartments Ltd',
    tenantName: 'Wanjiku Kamau',
    property: 'Kilimani Court',
    unit: 'A4',
    description: 'Rent for October 2026',
    amount: 10000,
    totalBalance: 25000,
    dueDate: d('2026-10-05'),
    stage: 'OVERDUE' as const,
    instructions: 'Paybill 123456, account A4',
  };

  it('puts the amounts, unit and payment instructions in the email', () => {
    const mail = buildReminderEmail(facts);
    expect(mail.subject).toContain('overdue');
    expect(mail.text).toContain('KES 10,000');
    expect(mail.text).toContain('KES 25,000');
    expect(mail.text).toContain('Paybill 123456');
    expect(mail.html).toContain('Kilimani Court - A4');
  });

  it('escapes tenant-supplied text so it cannot inject markup', () => {
    const mail = buildReminderEmail({ ...facts, tenantName: '<script>alert(1)</script>', instructions: '<img src=x>' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img src=x>');
  });

  it('keeps the SMS short', () => {
    expect(buildReminderSms(facts).length).toBeLessThanOrEqual(300);
    expect(buildReminderSms(facts)).toContain('KES 25,000');
  });
});
