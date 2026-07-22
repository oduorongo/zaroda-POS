import { NestFactory } from '@nestjs/core';
// nestjs-pino's Logger, NOT @nestjs/common's - LoggerModule.forRoot()
// (worker.module.ts) registers this one as the DI token; importing the
// wrong Logger class here compiles fine (both are named `Logger`) but
// app.get() then can't find it, since it's looking up an entirely
// different, unregistered token. Same import main.ts already uses.
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

/**
 * A separate deployable from main.ts/AppModule - runs no HTTP server at
 * all (createApplicationContext, not create), just the BullMQ
 * worker(s) registered in WorkerModule. Deploy this as its own process
 * (e.g. `pnpm start:worker` locally, a separate container/replica in
 * production) alongside the API, never as part of it - the entire point
 * is that a slow or misbehaving job (an Africa's Talking outage, a stuck
 * retry loop) can't starve the API process of event-loop time or
 * connections it needs to keep serving requests.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Worker process started - processing queued jobs');
}
bootstrap();
