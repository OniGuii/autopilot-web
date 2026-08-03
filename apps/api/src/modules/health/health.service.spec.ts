import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

describe('HealthService readiness (P0)', () => {
  function build(opts?: { postgresOk?: boolean; redisOk?: boolean }) {
    const prisma = {
      $queryRaw: jest.fn().mockImplementation(async () => {
        if (opts?.postgresOk === false) {
          throw new Error('db down');
        }
        return [{ ok: 1 }];
      }),
    };
    const redis = {
      ping: jest.fn().mockResolvedValue(opts?.redisOk !== false),
    };
    const service = new HealthService(prisma as never, redis as never);
    return { service, prisma, redis };
  }

  it('getReady ok quando Postgres e Redis estão up', async () => {
    const { service } = build();
    const result = await service.getReady();
    expect(result.status).toBe('ok');
    expect(result.postgres).toBe('up');
    expect(result.redis).toBe('up');
  });

  it('getReady 503 quando Postgres está down', async () => {
    const { service } = build({ postgresOk: false });
    await expect(service.getReady()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('getReady 503 quando Redis está down', async () => {
    const { service } = build({ redisOk: false });
    await expect(service.getReady()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
