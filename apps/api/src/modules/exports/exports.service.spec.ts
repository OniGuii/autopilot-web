import { HttpException } from '@nestjs/common';
import { EXPORT_HARD_CAP, EXPORT_LIMIT_EXCEEDED } from './exports.constants';
import { ExportsService } from './exports.service';

describe('ExportsService', () => {
  const actor = { sub: 'u1', cid: 'co-1', role: 'OWNER' } as never;

  it('returns CSV for leads under hard cap', async () => {
    const audit = { write: jest.fn().mockResolvedValue({ id: 'a1' }) };
    const prisma = {
      lead: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'l1',
            name: 'Lead',
            phone: '+5511',
            email: null,
            status: 'NEW',
            source: 'manual',
            ownerId: null,
            score: 0,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            convertedAt: null,
            firstResponseAt: null,
          },
        ]),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
    };
    const service = new ExportsService(prisma as never, audit as never);
    const result = await service.exportLeads(actor, {});
    expect(result.rowCount).toBe(1);
    expect(result.csv).toContain('id,name,phone');
    expect(result.csv).toContain('l1');
    expect(audit.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'EXPORT_LEADS' }),
    );
  });

  it('throws EXPORT_LIMIT_EXCEEDED above hard cap (D5)', async () => {
    const audit = { write: jest.fn() };
    const prisma = {
      lead: {
        count: jest.fn().mockResolvedValue(EXPORT_HARD_CAP + 1),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const service = new ExportsService(prisma as never, audit as never);
    try {
      await service.exportLeads(actor, {});
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const body = (err as HttpException).getResponse() as {
        code: string;
        limit: number;
      };
      expect(body.code).toBe(EXPORT_LIMIT_EXCEEDED);
      expect(body.limit).toBe(EXPORT_HARD_CAP);
    }
    expect(prisma.lead.findMany).not.toHaveBeenCalled();
  });
});
