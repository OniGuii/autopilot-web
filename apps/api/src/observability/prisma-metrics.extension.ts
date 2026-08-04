import { Prisma } from '@prisma/client';
import { recordPrismaQueryMetric } from './prisma-metrics.bridge';

/**
 * Prisma $extends query timing — duration + slow-query counter via bridge.
 * Does not alter query results or tenant/soft-delete behavior.
 */
export function createPrismaMetricsExtension() {
  return Prisma.defineExtension({
    name: 'observabilityMetrics',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const started = Date.now();
          try {
            return await query(args);
          } finally {
            recordPrismaQueryMetric(
              model ?? 'raw',
              operation,
              Date.now() - started,
            );
          }
        },
      },
    },
  });
}
