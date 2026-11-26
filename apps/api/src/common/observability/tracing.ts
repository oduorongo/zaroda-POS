/**
 * Must be imported (for its side effect) as the FIRST line of main.ts/
 * worker.ts, before any other import - OpenTelemetry's auto-instrumentation
 * works by monkey-patching modules (http, express, pg, ioredis, ...) the
 * moment they're first required, so it has to be registered before
 * NestFactory (which pulls in express) or PrismaClient are ever imported
 * anywhere in the process. Importing this file later would silently just
 * not instrument whatever already loaded first.
 *
 * Tracing starts only when it has somewhere to go: OTEL_EXPORTER_OTLP_ENDPOINT
 * (a real collector - Jaeger, Tempo, an APM vendor's OTLP ingest), or
 * OTEL_CONSOLE=on for looking at spans while testing. It never prints to the
 * console by default: on Render the log is a pipe, writes to it block the
 * process, and a span for every query and Redis call froze the live API
 * (2026-11-25). OTEL_SDK_DISABLED=true switches it off whatever else is set.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
const toConsole = process.env.OTEL_CONSOLE === 'on';

if (otlpEndpoint || toConsole) {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'zaroda-api',
    traceExporter: otlpEndpoint ? new OTLPTraceExporter({ url: otlpEndpoint }) : new ConsoleSpanExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Every fs read/write would otherwise produce a span per call - noise for near-zero diagnostic value.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Best-effort flush before the process exits - same moment main.ts/worker.ts drain PrismaService/BullMQ.
  process.on('SIGTERM', () => void sdk.shutdown().catch(() => undefined));
  process.on('SIGINT', () => void sdk.shutdown().catch(() => undefined));
}
