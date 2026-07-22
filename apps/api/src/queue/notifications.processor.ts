import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { NOTIFICATIONS_QUEUE, SEND_SMS_JOB, SendSmsJobPayload } from './jobs';

/**
 * Runs only in the worker process (see worker.ts/WorkerModule) - the API
 * process's QueueModule registers the queue for producing jobs but never
 * this processor, so an SMS send (a slow, third-party-dependent network
 * call) can never block or share resources with request handling.
 *
 * organizationId travels on every job payload (see jobs.ts's own comment)
 * but isn't used for a DB lookup here - this job's only "database" is
 * Africa's Talking's API, so there's nothing to establish tenant context
 * for. Logged on failure purely for cross-tenant-safe correlation (which
 * organization's booking confirmation didn't go out), never used to
 * bypass anything.
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly sms: AfricasTalkingSmsProvider) {
    super();
  }

  async process(job: Job<SendSmsJobPayload>): Promise<void> {
    if (job.name !== SEND_SMS_JOB) return;

    const result = await this.sms.sendSms({
      to: job.data.to,
      message: job.data.message,
    });
    if (!result.sent) {
      // Deliberately not thrown as a job failure - AfricasTalkingSmsProvider
      // returns the same {sent: false} whether the reason is "not
      // configured" (retrying 3 times would just repeat a permanent,
      // pointless failure) or a transient network error (which would very
      // likely fail identically on an immediate retry against the same
      // request anyway, since the provider itself doesn't distinguish).
      // Same "never let a notification outage become someone else's
      // problem" principle the provider already documents, just applied
      // at the job level too. This log line is the one place that outcome
      // is still visible, with the organization it was for.
      this.logger.warn(
        `SMS job ${job.id} for organization ${job.data.organizationId} did not send`,
      );
    }
  }
}
