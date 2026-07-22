/**
 * Must be imported (for its side effect) as the FIRST line of main.ts/
 * worker.ts, before any other import - OpenTelemetry's auto-instrumentation
 * works by monkey-patching modules (http, express, pg, ioredis, ...) the
 * moment they're first required, so it has to be registered before
 * NestFactory (which pulls in express) or PrismaClient are ever imported
 * anywhere in the process. Importing this file later would silently just
 * not instrument whatever already loaded first.
 *
 * Exports OTLP/HTTP if OTEL_EXPORTER_OTLP_ENDPOINT is set (point this at a
 * real collector - Jaeger, Tempo, an APM vendor's OTLP ingest - in any
 * real environment); otherwise falls back to a console exporter, so
 * tracing is genuinely visible and verifiable with zero external
 * infrastructure rather than silently doing nothing until someone
 * provisions a backend.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'zaroda-api',
  traceExporter: otlpEndpoint
    ? new OTLPTraceExporter({ url: otlpEndpoint })
    : new ConsoleSpanExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Every fs read/write (config loads, template reads) would otherwise
      // produce a span per call - overwhelming noise for near-zero
      // diagnostic value in this app.
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

// Best-effort flush before the process actually exits - same
// enableShutdownHooks() moment main.ts/worker.ts already drain
// PrismaService/BullMQ through; tracing shouldn't lose its last spans to
// the same shutdown.
process.on('SIGTERM', () => void sdk.shutdown().catch(() => undefined));
process.on('SIGINT', () => void sdk.shutdown().catch(() => undefined));
