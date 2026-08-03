import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
          },
        },
        {
          provide: RedisService,
          useValue: {
            ping: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return health status', () => {
    const result = controller.getHealth();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('autopilot-api');
  });

  it('should return ready when dependencies are up', async () => {
    const result = await controller.getReady();
    expect(result.status).toBe('ok');
    expect(result.postgres).toBe('up');
    expect(result.redis).toBe('up');
  });
});
