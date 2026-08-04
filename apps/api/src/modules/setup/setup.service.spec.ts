import { ConflictException } from '@nestjs/common';
import { SetupService } from './setup.service';

describe('SetupService', () => {
  it('rejects second company per user (D4)', async () => {
    const audit = { write: jest.fn() };
    const prisma = {
      membership: {
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn(),
    };
    const service = new SetupService(prisma as never, audit as never);
    await expect(
      service.createCompany({ sub: 'u1' } as never, { name: 'Second Co' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('getStatus without cid only reports company step deeply', async () => {
    const audit = { write: jest.fn() };
    const prisma = {
      membership: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new SetupService(prisma as never, audit as never);
    const status = await service.getStatus({ sub: 'u1' } as never);
    expect(status.steps[0]).toEqual({ key: 'company', done: false });
    expect(status.complete).toBe(false);
  });
});
