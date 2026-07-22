import * as Sentry from '@sentry/node';

/**
 * A missing SENTRY_DSN makes Sentry.init() a documented no-op (the SDK
 * disables itself rather than throwing) - same "degrade gracefully
 * without credentials" convention as MpesaPaymentProcessor/
 * AfricasTalkingSmsProvider, not a special case invented for Sentry.
 * Called once at the top of both main.ts and worker.ts, before either
 * process does anything else, so an exception during bootstrap itself is
 * still captured.
 */
export function initSentry(): void {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
  });
}

/**
 * Captures an exception with tenant/request context attached - called
 * from AllExceptionsFilter for anything that isn't a well-formed
 * HttpException (the same class of "unexpected, worth paging someone on"
 * error that filter already logs in full server-side rather than exposing
 * to the client). organizationId is tagged (searchable/filterable across
 * events in Sentry's UI), everything else is extra context on the one
 * event.
 */
export function captureExceptionWithContext(
  exception: unknown,
  context: {
    requestId?: string;
    organizationId?: string;
    method?: string;
    path?: string;
  },
): void {
  Sentry.withScope((scope) => {
    if (context.organizationId) {
      scope.setTag('organizationId', context.organizationId);
    }
    scope.setContext('request', {
      requestId: context.requestId,
      method: context.method,
      path: context.path,
    });
    Sentry.captureException(exception);
  });
}
