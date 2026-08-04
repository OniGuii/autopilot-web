import { LeadStatus } from '@prisma/client';
import { PipelineService } from './pipeline.service';

describe('PipelineService', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const actor = { sub: 'u1', cid: companyId } as never;

  function build(transitions: unknown[] = []) {
    const prisma = {
      lead: {
        groupBy: jest.fn().mockResolvedValue([
          { status: LeadStatus.NEW, _count: { _all: 2 } },
          { status: LeadStatus.CONTACTED, _count: { _all: 1 } },
        ]),
        count: jest
          .fn()
          .mockResolvedValueOnce(1) // without contact
          .mockResolvedValueOnce(2), // unassigned
      },
      leadStatusTransition: {
        findMany: jest.fn().mockResolvedValue(transitions),
      },
    };
    return {
      service: new PipelineService(prisma as never),
      prisma,
    };
  }

  it('returns partial metrics (null) when no transitions — does not throw', async () => {
    const { service } = build([]);
    const res = await service.getPipeline(actor, {});
    expect(res.leadsByStage.NEW).toBe(2);
    expect(res.leadsWithoutContact).toBe(1);
    expect(res.leadsUnassigned).toBe(2);
    expect(res.conversionByStage).toBeNull();
    expect(res.avgTimeInStageMs).toBeNull();
  });

  it('computes conversionByStage and avgTimeInStageMs from transitions', async () => {
    const t0 = new Date('2026-08-01T00:00:00Z');
    const t1 = new Date('2026-08-02T00:00:00Z');
    const t2 = new Date('2026-08-03T00:00:00Z');
    const { service } = build([
      {
        leadId: 'l1',
        fromStatus: null,
        toStatus: LeadStatus.NEW,
        createdAt: t0,
      },
      {
        leadId: 'l1',
        fromStatus: LeadStatus.NEW,
        toStatus: LeadStatus.CONTACTED,
        createdAt: t1,
      },
      {
        leadId: 'l1',
        fromStatus: LeadStatus.CONTACTED,
        toStatus: LeadStatus.CONVERTED,
        createdAt: t2,
      },
      {
        leadId: 'l2',
        fromStatus: null,
        toStatus: LeadStatus.NEW,
        createdAt: t0,
      },
    ]);

    const res = await service.getPipeline(actor, {});
    expect(res.conversionByStage).not.toBeNull();
    expect(res.conversionByStage!.NEW).toBe(0.5);
    expect(res.conversionByStage!.CONTACTED).toBe(1);
    expect(res.avgTimeInStageMs).not.toBeNull();
    expect(res.avgTimeInStageMs!.NEW).toBe(86_400_000);
  });
});
