import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma integration scaffold.
 * Eager connection is deferred so the API can boot without a live database
 * during the architectural foundation stage.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    // Connection will be enabled when entities and migrations are introduced.
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
