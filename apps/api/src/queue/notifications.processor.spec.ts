import { NotificationsProcessor } from './notifications.processor';
import { SEND_SMS_JOB } from './jobs';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';

describe('NotificationsProcessor', () => {
  function build(sendSms: jest.Mock) {
    const sms = { sendSms } as unknown as AfricasTalkingSmsProvider;
    return new NotificationsProcessor(sms);
  }

  it('sends the SMS via the provider for a send-sms job', async () => {
    const sendSms = jest.fn().mockResolvedValue({ sent: true });
    const processor = build(sendSms);

    await processor.process({
      name: SEND_SMS_JOB,
      id: '1',
      data: { organizationId: 'org-1', to: '+254700000000', message: 'hi' },
    } as never);

    expect(sendSms).toHaveBeenCalledWith({ to: '+254700000000', message: 'hi' });
  });

  it('does not throw when the provider reports the send failed', async () => {
    const sendSms = jest.fn().mockResolvedValue({ sent: false });
    const processor = build(sendSms);

    await expect(
      processor.process({
        name: SEND_SMS_JOB,
        id: '1',
        data: { organizationId: 'org-1', to: '+254700000000', message: 'hi' },
      } as never),
    ).resolves.toBeUndefined();
  });

  it('ignores a job that is not the send-sms job (defensive - only one job type is registered on this queue today)', async () => {
    const sendSms = jest.fn();
    const processor = build(sendSms);

    await processor.process({ name: 'some-other-job', id: '1', data: {} } as never);

    expect(sendSms).not.toHaveBeenCalled();
  });
});
