import {
  context,
  propagation,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import type { Job } from 'bullmq';
import { runWithRequestContextAsync } from './request-context';

const tracer = trace.getTracer('autopilot-bullmq');

/**
 * Propagate correlationId into ALS + OTEL span for BullMQ workers.
 */
export async function withBullJobContext<T>(
  queueName: string,
  job: Job<{ correlationId?: string; companyId?: string }>,
  fn: () => Promise<T>,
): Promise<T> {
  const correlationId = job.data?.correlationId;
  const companyId = job.data?.companyId;

  return runWithRequestContextAsync(
    {
      correlationId,
      companyId,
      module: queueName,
    },
    async () => {
      const span = tracer.startSpan(`bullmq.process ${queueName}`, {
        attributes: {
          'messaging.system': 'bullmq',
          'messaging.destination': queueName,
          'messaging.message_id': String(job.id ?? ''),
          'autopilot.correlation_id': correlationId ?? '',
          'autopilot.company_id': companyId ?? '',
        },
      });

      // Inject baggage for downstream logs/audit.
      const baggage =
        propagation.getBaggage(context.active()) ?? propagation.createBaggage();
      const nextCtx = propagation.setBaggage(
        trace.setSpan(context.active(), span),
        correlationId
          ? baggage.setEntry('correlationId', { value: correlationId })
          : baggage,
      );

      try {
        return await context.with(nextCtx, fn);
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}
