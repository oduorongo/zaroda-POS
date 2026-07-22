import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './common/prisma/prisma.module';
import { NotificationsModule } from './notifications/notifications.module';
import { QueueModule } from './queue/queue.module';
import { NotificationsProcessor } from './queue/notifications.processor';

/**
 * The dedicated worker process's own module - deliberately NOT AppModule.
 * AppModule wires the full HTTP surface (every controller, both guard
 * chains, the Nest HTTP adapter); this process never listens on a port at
 * all (see worker.ts) and has no business importing any of that. Only
 * what job processors actually need: QueueModule (for the queue
 * connection/registration - registering the same queue name here is what
 * lets @Processor actually attach to it), NotificationsProcessor itself,
 * and whatever a processor's real work requires (PrismaModule, in case a
 * future job needs tenant-scoped DB access - see jobs.ts's own comment on
 * how a handler must establish that itself).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Same structured JSON (prod) / pretty (dev) log shape as AppModule's
    // own LoggerModule.forRoot in app.module.ts, minus the pinoHttp
    // request-logging options - there are no HTTP requests here to log,
    // just job processing output, but a shared log aggregator should
    // still see this process's lines in the same format as the API's.
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    PrismaModule,
    NotificationsModule,
    QueueModule,
  ],
  providers: [NotificationsProcessor],
})
export class WorkerModule {}
