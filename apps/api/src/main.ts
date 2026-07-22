import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // bufferLogs holds Nest's own startup logs (module init, route mapping)
  // until the pino logger below is attached, so they come out as
  // structured JSON too instead of bypassing it as raw console.log lines.
  app.useLogger(app.get(Logger));
  // Wires SIGTERM/SIGINT (what a container orchestrator sends before
  // killing a pod/instance) to Nest's shutdown lifecycle - every
  // OnModuleDestroy hook (PrismaService.$disconnect, most notably) runs
  // before the process actually exits, and app.close() itself stops
  // accepting new connections while letting in-flight requests finish
  // rather than cutting them off mid-response. Without this, a rolling
  // deploy could kill a request (e.g. a sale mid-transaction) at exactly
  // the wrong moment instead of letting the orchestrator's own grace
  // period do its job.
  app.enableShutdownHooks();
  // forbidNonWhitelisted (on top of whitelist) turns an unexpected field
  // into a 400 instead of silently stripping it - catches a client trying
  // to mass-assign a server-derived field (organizationId, cashierOrgUserId,
  // ...) as a clear rejection during development rather than a
  // quietly-ignored no-op that could mask a real bug in the caller.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // The terminal PWA (and eventually the back-office app) call this API
  // from a different origin/port via browser fetch() - without CORS
  // enabled, every request from an actual browser is silently blocked
  // (curl/server-to-server calls don't enforce CORS, so this gap is easy
  // to miss without testing from a real browser). CORS_ORIGIN is a
  // comma-separated allowlist; unset defaults to allowing any origin,
  // which is fine for local dev but should be set explicitly in
  // production.
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
