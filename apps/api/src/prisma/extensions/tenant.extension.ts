import { Prisma } from '@prisma/client';
import { getTenantCompanyId } from '../../core/tenancy/tenant-als';

/**
 * Tenant Prisma Extension (activated).
 *
 * When ALS has companyId (JWT.cid via TenantInterceptor):
 * injects/verifies companyId on tenant-scoped ops.
 * Without context (webhook/auth/system): no injection.
 */

export const TENANT_SCOPED_MODELS = [
  'membership',
  'lead',
  'conversation',
  'message',
  'followUp',
  'event',
  'auditLog',
  'whatsAppInstance',
  'webhookEvent',
  'leadNote',
  'leadActivity',
  'leadStatusTransition',
  'companyAiSettings',
  'knowledgeBaseEntry',
  'companyRecoverySettings',
  'companyOutboundProtectionSettings',
  'outboundSuppressEntry',
] as const;

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

const TENANT_SCOPED_SET = new Set<string>(TENANT_SCOPED_MODELS);

export const GLOBAL_MODELS = [
  'company',
  'user',
  'session',
  'refreshToken',
] as const;

export type TenantExtensionOptions = {
  enforce?: boolean;
};

function isTenantScoped(model: string): boolean {
  return TENANT_SCOPED_SET.has(model);
}

function assertTenantMatch(
  model: string,
  expected: string,
  actual: unknown,
  kind: 'where' | 'data',
): void {
  if (actual === undefined || actual === null) return;
  if (actual !== expected) {
    throw new Error(
      `[tenant] Cross-tenant ${kind} blocked on ${model}: expected=${expected} actual=${typeof actual === 'string' ? actual : JSON.stringify(actual)}`,
    );
  }
}

function mergeTenantWhere(
  model: string,
  where: Record<string, unknown> | undefined,
  companyId: string,
  enforce: boolean,
): Record<string, unknown> {
  if (enforce) {
    assertTenantMatch(model, companyId, where?.companyId, 'where');
  }
  return { ...(where ?? {}), companyId };
}

function mergeTenantData(
  model: string,
  data: Record<string, unknown>,
  companyId: string,
  enforce: boolean,
): Record<string, unknown> {
  if (enforce) {
    assertTenantMatch(model, companyId, data.companyId, 'data');
  }
  return { ...data, companyId };
}

export function assertSameTenant(
  expectedCompanyId: string | undefined,
  actualCompanyId: string | undefined,
  context = 'tenant-check',
): void {
  if (!expectedCompanyId) {
    throw new Error(
      `[${context}] Missing expected companyId (tenant context).`,
    );
  }
  if (!actualCompanyId) {
    throw new Error(`[${context}] Missing actual companyId on entity/input.`);
  }
  if (expectedCompanyId !== actualCompanyId) {
    throw new Error(
      `[${context}] Cross-tenant violation: expected=${expectedCompanyId} actual=${actualCompanyId}`,
    );
  }
}

type QueryArgs = {
  model: string;
  args: {
    where?: Record<string, unknown>;
    data?: unknown;
    [key: string]: unknown;
  };
  query: (args: unknown) => Promise<unknown>;
};

export function createTenantExtension(options: TenantExtensionOptions = {}) {
  const enforce = options.enforce !== false;

  const tenantQuery = {
    async findMany({ model, args, query }: QueryArgs) {
      const companyId = getTenantCompanyId();
      if (companyId && isTenantScoped(model)) {
        args = {
          ...args,
          where: mergeTenantWhere(model, args.where, companyId, enforce),
        };
      }
      return query(args);
    },
    async findFirst({ model, args, query }: QueryArgs) {
      const companyId = getTenantCompanyId();
      if (companyId && isTenantScoped(model)) {
        args = {
          ...args,
          where: mergeTenantWhere(model, args.where, companyId, enforce),
        };
      }
      return query(args);
    },
    async count({ model, args, query }: QueryArgs) {
      const companyId = getTenantCompanyId();
      if (companyId && isTenantScoped(model)) {
        args = {
          ...args,
          where: mergeTenantWhere(model, args.where, companyId, enforce),
        };
      }
      return query(args);
    },
    async create({ model, args, query }: QueryArgs) {
      const companyId = getTenantCompanyId();
      if (companyId && isTenantScoped(model)) {
        args = {
          ...args,
          data: mergeTenantData(
            model,
            args.data as Record<string, unknown>,
            companyId,
            enforce,
          ),
        };
      }
      return query(args);
    },
    async createMany({ model, args, query }: QueryArgs) {
      const companyId = getTenantCompanyId();
      if (companyId && isTenantScoped(model)) {
        const data = args.data;
        if (Array.isArray(data)) {
          args = {
            ...args,
            data: data.map((row) =>
              mergeTenantData(
                model,
                row as Record<string, unknown>,
                companyId,
                enforce,
              ),
            ),
          };
        } else if (data) {
          args = {
            ...args,
            data: mergeTenantData(
              model,
              data as Record<string, unknown>,
              companyId,
              enforce,
            ),
          };
        }
      }
      return query(args);
    },
    async updateMany({ model, args, query }: QueryArgs) {
      const companyId = getTenantCompanyId();
      if (companyId && isTenantScoped(model)) {
        args = {
          ...args,
          where: mergeTenantWhere(model, args.where, companyId, enforce),
        };
      }
      return query(args);
    },
    async deleteMany({ model, args, query }: QueryArgs) {
      const companyId = getTenantCompanyId();
      if (companyId && isTenantScoped(model)) {
        args = {
          ...args,
          where: mergeTenantWhere(model, args.where, companyId, enforce),
        };
      }
      return query(args);
    },
  };

  return Prisma.defineExtension({
    name: 'autopilot-tenant',
    query: {
      $allModels: tenantQuery,
    },
  });
}
