// Side-effect import, must be first - see tracing.ts's own comment on why
// (auto-instrumentation has to register before express/PrismaClient are
// ever required, which importing this any later than first would miss).
import './common/observability/tracing';
import { NestFactory } from '@nestjs/core';
import { json, NextFunction, Request, Response, urlencoded } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { initSentry } from './common/observability/sentry';

async function bootstrap() {
  initSentry();
  // The body parsers are set up here (Nest's own are off) so that ONE route can take a bigger body than the rest: a product
  // import carries up to 5,000 rows. Everything else keeps the usual 100 KB limit. The import's own parser must come first.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  // Behind the host's proxy every request arrives from the proxy's address, so without this all callers share ONE
  // rate-limit bucket (and per-IP login limits protect nothing). Trust only the hops we know of (default 1: Render's
  // proxy) so a caller cannot spoof their IP with their own X-Forwarded-For.
  const trustProxy = process.env.TRUST_PROXY ?? '1';
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy === 'false' ? false : trustProxy);
  app.disable('x-powered-by');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/products/import', json({ limit: '5mb' }));
  app.use('/products/stock-update', json({ limit: '5mb' }));
  app.use('/stock-sync', json({ limit: '5mb' }));
  app.use(json());
  app.use(urlencoded({ extended: true }));
  // a request over its limit is a clear 413, not an "internal error"
  app.use((err: { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large') return void res.status(413).json({ statusCode: 413, message: 'That request is too big' });
    next(err);
  });
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
  if (!corsOrigin && process.env.NODE_ENV === 'production') {
    app.get(Logger).warn('CORS_ORIGIN is not set: any website can call this API from a browser. Set it to your app domains.');
  }
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
