import { Prisma } from '@prisma/client';
import { getTenantCompanyId } from '../../core/tenancy/tenant-als';
import { getRlsTxDepth, isRlsBypass, runWithRlsTxDepth } from '../rls-context';
import { applyRlsSessionGuc } from '../rls-session';

type ExecuteRawClient = {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
};

type DomainClient = {
  $executeRaw: ExecuteRawClient['$executeRaw'];
  $transaction: (...args: never[]) => Promise<unknown>;
};

function camelModel(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * 8B — SET LOCAL app.company_id / app.rls_bypass around Prisma work.
 *
 * `domainClient` = metrics + soft-delete + tenant (no RLS) to avoid recursion.
 */
export function createRlsSessionExtension(domainClient: DomainClient) {
  return Prisma.defineExtension({
    name: 'rlsSession',
    client: {
      $transaction(...args: unknown[]) {
        const input = args[0];
        const options = args[1];
        const depth = getRlsTxDepth();

        if (typeof input === 'function') {
          const fn = input as (tx: ExecuteRawClient) => Promise<unknown>;
          if (depth > 0) {
            return (domainClient.$transaction as Function)(
              (tx: ExecuteRawClient) =>
                runWithRlsTxDepth(depth + 1, () => fn(tx)),
              options,
            );
          }
          return (domainClient.$transaction as Function)(
            async (tx: ExecuteRawClient) => {
              await applyRlsSessionGuc(tx);
              return runWithRlsTxDepth(1, () => fn(tx));
            },
            options,
          );
        }

        if (Array.isArray(input)) {
          // Array form keeps caller result indices — strip GUC preamble rows.
          const companyId = getTenantCompanyId() ?? '';
          const bypass = isRlsBypass() ? 'on' : 'off';
          const batch = [
            domainClient.$executeRaw`SELECT set_config('app.rls_bypass', ${bypass}, true)`,
            domainClient.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`,
            ...input,
          ];
          return runWithRlsTxDepth(Math.max(depth, 1), async () => {
            const results = await (domainClient.$transaction as Function)(
              batch,
              options,
            );
            return Array.isArray(results) ? results.slice(2) : results;
          });
        }

        return (domainClient.$transaction as Function)(input, options);
      },
    },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (getRlsTxDepth() > 0) {
            return query(args);
          }
          if (!model) {
            return query(args);
          }

          return (domainClient.$transaction as Function)(
            async (tx: ExecuteRawClient & Record<string, unknown>) => {
              await applyRlsSessionGuc(tx);
              const key = camelModel(model);
              const delegate = tx[key] as
                | Record<string, (a: unknown) => Promise<unknown>>
                | undefined;
              const method = delegate?.[operation];
              if (typeof method !== 'function') {
                return runWithRlsTxDepth(1, () => query(args));
              }
              return runWithRlsTxDepth(1, () => method.call(delegate, args));
            },
          );
        },
      },
    },
  });
}
