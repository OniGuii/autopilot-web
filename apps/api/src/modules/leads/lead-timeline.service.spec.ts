import { LeadTimelineService } from './lead-timeline.service';

describe('LeadTimelineService', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const leadId = '22222222-2222-2222-2222-222222222222';
  const actor = { sub: 'u1', cid: companyId } as never;

  function build(itemCount: number) {
    const lead = {
      id: leadId,
      companyId,
      status: 'NEW',
      source: 'WHATSAPP',
      phone: '5511999',
      name: 'Lead',
      createdAt: new Date('2026-08-01T00:00:00Z'),
      deletedAt: null,
    };

    const notes = Array.from({ length: itemCount }, (_, i) => ({
      id: `note-${i}`,
      companyId,
      leadId,
      userId: 'u1',
      body: `Note ${i}`,
      createdAt: new Date(`2026-08-01T0${Math.min(i, 9)}:00:00Z`),
      deletedAt: null,
    }));

    const prisma = {
      lead: { findFirst: jest.fn().mockResolvedValue(lead) },
      conversation: { findMany: jest.fn().mockResolvedValue([]) },
      followUp: { findMany: jest.fn().mockResolvedValue([]) },
      leadNote: { findMany: jest.fn().mockResolvedValue(notes) },
      leadActivity: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };

    return {
      service: new LeadTimelineService(prisma as never),
      prisma,
    };
  }

  it('paginates in memory with occurredAt ASC and meta', async () => {
    const { service } = build(5);
    const page1 = await service.getTimeline(actor, leadId, {
      page: 1,
      limit: 3,
    });
    // 1 LEAD_CREATED + 5 notes = 6
    expect(page1.meta).toEqual({
      page: 1,
      limit: 3,
      total: 6,
      totalPages: 2,
    });
    expect(page1.items).toHaveLength(3);
    expect(page1.items[0].itemType).toBe('LEAD_CREATED');
    expect(
      page1.items.every(
        (item, idx, arr) =>
          idx === 0 || item.occurredAt >= arr[idx - 1].occurredAt,
      ),
    ).toBe(true);

    const page2 = await service.getTimeline(actor, leadId, {
      page: 2,
      limit: 3,
    });
    expect(page2.items).toHaveLength(3);
    expect(page2.meta.page).toBe(2);
  });

  it('defaults page=1 limit=50', async () => {
    const { service } = build(2);
    const res = await service.getTimeline(actor, leadId, {});
    expect(res.meta.page).toBe(1);
    expect(res.meta.limit).toBe(50);
    expect(res.leadId).toBe(leadId);
    expect(res.companyId).toBe(companyId);
  });
});
