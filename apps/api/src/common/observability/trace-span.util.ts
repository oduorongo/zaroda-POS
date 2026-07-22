import { SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('zaroda-api');

/**
 * Wraps a unit of work in its own span, named and attributed explicitly
 * (rather than relying only on auto-instrumentation's generic HTTP/DB
 * spans) for the two flows most likely to hide a multi-step bug: sale
 * completion (SalesService.createInner) and the M-Pesa STK push
 * (MpesaPaymentProcessor.initiate) - both cross several awaited steps
 * where "which step actually failed/was slow" isn't obvious from a single
 * HTTP-request-level span alone. Records the thrown error on the span
 * (status + exception event) before letting it propagate - callers don't
 * need their own try/catch just to get this.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err instanceof Error ? err : String(err));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
