/**
 * OpenTelemetry bootstrap — must be imported before NestFactory / PrismaClient.
 * Gated by OTEL_ENABLED (default false). Soft-fails if exporter misconfigured.
 */
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { OBS_SERVICE_NAME_DEFAULT } from './observability.constants';

let sdk: NodeSDK | null = null;
let started = false;

export function isOtelEnabled(): boolean {
  return (process.env.OTEL_ENABLED ?? 'false') === 'true';
}

export function startOpenTelemetry(): void {
  if (started || !isOtelEnabled()) return;
  started = true;

  if ((process.env.OTEL_DIAG_LOG ?? 'false') === 'true') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const serviceName =
    process.env.OTEL_SERVICE_NAME?.trim() || OBS_SERVICE_NAME_DEFAULT;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

  const traceExporter = endpoint
    ? new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` })
    : undefined;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.1.0',
    }),
    ...(traceExporter ? { traceExporter } : {}),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const url = req.url ?? '';
          return (
            url.startsWith('/health') ||
            url.startsWith('/metrics') ||
            url.includes('/health/') ||
            url === '/metrics'
          );
        },
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new IORedisInstrumentation(),
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();
}

export async function shutdownOpenTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    // ignore shutdown errors
  } finally {
    sdk = null;
  }
}
