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
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
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
