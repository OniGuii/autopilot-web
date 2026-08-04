import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createPrismaMetricsExtension } from '../observability/prisma-metrics.extension';
import { createRlsSessionExtension } from './extensions/rls-session.extension';
import { createSoftDeleteExtension } from './extensions/soft-delete.extension';
import { createTenantExtension } from './extensions/tenant.extension';

function createDomainClient() {
  return new PrismaClient()
    .$extends(createPrismaMetricsExtension())
    .$extends(
      createSoftDeleteExtension({
        filterDeleted: true,
      }),
    )
    .$extends(
      createTenantExtension({
        enforce: true,
      }),
    );
}

function createExtendedClient() {
  const domain = createDomainClient();
  return domain.$extends(createRlsSessionExtension(domain as never));
}

export type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

type PrismaServiceInstance = ExtendedPrismaClient &
  OnModuleInit &
  OnModuleDestroy;

function buildPrismaService(): PrismaServiceInstance {
  const client = createExtendedClient();
  const instance = client as PrismaServiceInstance;
  instance.onModuleInit = async () => {
    await client.$connect();
  };
  instance.onModuleDestroy = async () => {
    await client.$disconnect();
  };
  return instance;
}

/**
 * Nest injectable Prisma client:
 * metrics + soft-delete + tenant + RLS session (SET LOCAL app.company_id).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super();
    return buildPrismaService() as unknown as this;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
