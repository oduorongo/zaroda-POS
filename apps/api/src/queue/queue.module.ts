import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';
import { NOTIFICATIONS_QUEUE } from './jobs';
import { NotificationsQueueService } from './notifications-queue.service';

const logger = new Logger('QueueModule');

/**
 * The producer side of the queue - importable from the main API process
 * (NotificationsQueueService.enqueueSms() below) without pulling in the
 * processor (see notifications.processor.ts, wired only into
 * WorkerModule/worker.ts) - the API process enqueues jobs, it never
 * processes them itself, so a slow/misbehaving job can't share a process
 * with request handling (the actual reliability goal here).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // A plain `{ url }` connection option lets BullMQ construct its own
        // ioredis client internally, with no listener attached to its
        // 'error' event - ioredis's background reconnect-retry attempts
        // (its default, sensible behavior when Redis is unreachable) then
        // surface as unhandled promise rejections, which crash the ENTIRE
        // API process, not just the queue (discovered the hard way:
        // app.e2e-spec.ts, which boots the full AppModule and has nothing
        // to do with the queue, started failing the moment
        // PublicBookingModule pulled QueueModule into the graph). Building
        // the client ourselves lets us attach an error handler before
        // BullMQ ever sees it, so "Redis is down" degrades to "this one
        // queue doesn't work right now" - consistent with every other
        // external dependency in this codebase (Africa's Talking, M-Pesa)
        // degrading gracefully instead of taking the API down with it.
        const connection = new IORedis(
          config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
          { lazyConnect: true, maxRetriesPerRequest: null },
        );
        connection.on('error', (err) => {
          logger.warn(`Redis connection error (queue jobs will not process until this recovers): ${err.message}`);
        });
        return { connection };
      },
    }),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  providers: [NotificationsQueueService],
  exports: [NotificationsQueueService, BullModule],
})
export class QueueModule {}
