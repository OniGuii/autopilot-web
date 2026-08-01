import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.SEED_DEBUG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});
