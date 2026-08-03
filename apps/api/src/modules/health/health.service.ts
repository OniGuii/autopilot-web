import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  getHealth() {
    return {
      status: 'ok',
      service: 'autopilot-api',
      timestamp: new Date().toISOString(),
    };
  }

  getLive() {
    return {
      status: 'ok',
      check: 'live',
    };
  }

  /**
   * Readiness: Postgres + Redis must be up (P0).
   * Returns 503 when either dependency is down.
   */
  async getReady() {
    const [postgresUp, redisUp] = await Promise.all([
      this.checkPostgres(),
      this.redis.ping(),
    ]);

    const body = {
      status: postgresUp && redisUp ? 'ok' : 'not_ready',
      check: 'ready',
      postgres: postgresUp ? 'up' : 'down',
      redis: redisUp ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };

    if (!postgresUp || !redisUp) {
      throw new ServiceUnavailableException(body);
    }

    return body;
  }

  private async checkPostgres(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
