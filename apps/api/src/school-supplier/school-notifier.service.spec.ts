import { detailTable, SchoolNotifierService } from './school-notifier.service';

describe('detailTable', () => {
  it('makes a table with a header row and a row for each line', () => {
    const html = detailTable(
      ['Item', 'Qty'],
      [
        ['Exercise book', '60'],
        ['Pen', '40'],
      ],
    );
    expect(html).toContain('<table');
    expect(html).toContain('Exercise book');
    expect(html.match(/<tr>/g)).toHaveLength(3);
  });
  it('escapes anything that could be taken for markup', () => {
    const html = detailTable(['Item'], [['<script>alert(1)</script> & co']]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; co');
  });
});

describe('SchoolNotifierService', () => {
  const make = (configured: boolean) => {
    const sms = { sendSms: jest.fn().mockResolvedValue({ sent: true }) };
    const email = {
      isConfigured: jest.fn().mockReturnValue(configured),
      sendEmail: jest.fn().mockResolvedValue({ sent: true }),
    };
    return {
      sms,
      email,
      service: new SchoolNotifierService(sms as never, email as never),
    };
  };
  const school = {
    name: 'Mrs Akinyi',
    phone: '254711000000',
    email: 'school@example.com',
  };

  it('texts the school and emails it with the detail and a button to the portal', async () => {
    const { service, sms, email } = make(true);
    await service.notify(
      school,
      'Ongo Enterprises',
      'Delivery DN-1',
      'your order was delivered',
      {
        detailHtml: detailTable(['Item', 'Qty'], [['Book', '60']]),
        link: {
          label: 'Open your orders',
          url: 'https://shop.example.com/schools/ongo',
        },
      },
    );
    expect(sms.sendSms).toHaveBeenCalledTimes(1);
    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('school@example.com');
    expect(sent.subject).toBe('Delivery DN-1');
    expect(sent.html).toContain('Book');
    expect(sent.html).toContain('https://shop.example.com/schools/ongo');
    expect(sent.text).toContain('https://shop.example.com/schools/ongo');
  });

  it('sends no email to a school that has none, and does not fail', async () => {
    const { service, email } = make(true);
    await expect(
      service.notify({ ...school, email: null }, 'Ongo', 's', 'm'),
    ).resolves.toBeUndefined();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('never lets a failure to message undo the work it follows', async () => {
    const { service, email } = make(true);
    email.sendEmail.mockRejectedValue(new Error('mail server down'));
    await expect(
      service.notify(school, 'Ongo', 's', 'm'),
    ).resolves.toBeUndefined();
  });

  it("emails the supplier's own people once each, and nothing when email is not set up", async () => {
    const { service, email } = make(true);
    await service.notifyStaff(
      ['a@x.com', 'a@x.com', 'b@x.com', ''],
      'Ongo',
      'New order',
      'A school ordered',
    );
    expect(email.sendEmail).toHaveBeenCalledTimes(2);
    const off = make(false);
    await off.service.notifyStaff(['a@x.com'], 'Ongo', 's', 'm');
    expect(off.email.sendEmail).not.toHaveBeenCalled();
  });
});
