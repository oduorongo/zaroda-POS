import { NotificationsQueueService } from './notifications-queue.service';
import { SEND_SMS_JOB } from './jobs';

describe('NotificationsQueueService', () => {
  it('enqueues an sms job with retry/backoff options', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const service = new NotificationsQueueService({ add } as never);

    await service.enqueueSms({
      organizationId: 'org-1',
      to: '+254700000000',
      message: 'hello',
    });

    expect(add).toHaveBeenCalledWith(
      SEND_SMS_JOB,
      { organizationId: 'org-1', to: '+254700000000', message: 'hello' },
      expect.objectContaining({ attempts: 3 }),
    );
  });
});
