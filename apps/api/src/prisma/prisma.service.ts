import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createSoftDeleteExtension } from './extensions/soft-delete.extension';
import { createTenantExtension } from './extensions/tenant.extension';

function createExtendedClient() {
  return new PrismaClient()
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
 * Nest injectable Prisma client with soft-delete + tenant extensions.
 * Typed as PrismaClient for existing services; runtime is extended.
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
