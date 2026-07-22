import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NOTIFICATIONS_QUEUE, SEND_SMS_JOB, SendSmsJobPayload } from './jobs';

@Injectable()
export class NotificationsQueueService {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Fire-and-forget from the caller's perspective - enqueues and returns
   * immediately, the actual Africa's Talking HTTP call happens later in
   * the worker process (notifications.processor.ts). 3 retries with
   * exponential backoff: a transient network blip or Africa's Talking
   * being briefly unreachable shouldn't need a human to notice and resend
   * - AfricasTalkingSmsProvider itself never throws (see its own comment),
   * so a retry only ever fires for a genuine job-processing failure
   * (Redis hiccup, worker crash mid-job), not a normal "not configured"
   * or "provider rejected it" outcome.
   */
  async enqueueSms(payload: SendSmsJobPayload): Promise<void> {
    await this.queue.add(SEND_SMS_JOB, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }
}
