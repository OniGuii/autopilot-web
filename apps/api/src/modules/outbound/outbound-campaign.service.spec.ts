import { ConflictException, NotFoundException } from '@nestjs/common';
import { FollowUpStatus, LeadStatus } from '@prisma/client';
import { OutboundCampaignService } from './outbound-campaign.service';
import {
  CAMPAIGN_CREATED,
  CAMPAIGN_HOT_SCORE_THRESHOLD,
  CAMPAIGN_STARTED,
  CAMPAIGN_STATUSES,
} from './outbound-campaign.constants';
import { OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE } from './outbound-first-touch.constants';

describe('OutboundCampaignService (V1.4A)', () => {
  const prisma = {
    outboundCampaign: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    outboundCampaignLead: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    lead: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    leadImportBatch: {
      findFirst: jest.fn(),
    },
    followUp: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const audit = { write: jest.fn() };
  const firstTouch = { generate: jest.fn() };
  const prom = {
    recordCampaignCreated: jest.fn(),
    recordCampaignLeadsAdded: jest.fn(),
    setCampaignReplyRate: jest.fn(),
    setCampaignsTotal: jest.fn(),
  };

  let service: OutboundCampaignService;

  const actor = { cid: 'c1', sub: 'u1' };
  const baseCampaign = {
    id: 'camp1',
    companyId: 'c1',
    createdByUserId: 'u1',
    name: 'Reativação Q3',
    description: 'Base opt-in',
    objective: 'reativar base',
    status: CAMPAIGN_STATUSES.DRAFT,
    startedAt: null as Date | null,
    pausedAt: null as Date | null,
    completedAt: null as Date | null,
    archivedAt: null as Date | null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    deletedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    service = new OutboundCampaignService(
      prisma as never,
      audit as never,
      firstTouch as never,
      prom as never,
    );
  });

  function mockEmptyMetrics() {
    prisma.outboundCampaignLead.findMany.mockResolvedValue([]);
    prisma.followUp.findMany.mockResolvedValue([]);
  }

  it('create persists DRAFT and audits CAMPAIGN_CREATED', async () => {
    prisma.outboundCampaign.create.mockResolvedValue(baseCampaign);

    const result = await service.create(actor, {
      name: 'Reativação Q3',
      objective: 'reativar base',
      description: 'Base opt-in',
    });

    expect(result.status).toBe(CAMPAIGN_STATUSES.DRAFT);
    expect(result.leadCount).toBe(0);
    expect(audit.write).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: CAMPAIGN_CREATED }),
    );
    expect(prom.recordCampaignCreated).toHaveBeenCalled();
  });

  it('transition DRAFT → READY → RUNNING emits CAMPAIGN_STARTED', async () => {
    prisma.outboundCampaign.findFirst.mockResolvedValue(baseCampaign);
    prisma.outboundCampaignLead.count.mockResolvedValue(0);
    prisma.outboundCampaign.update.mockResolvedValue({
      ...baseCampaign,
      status: CAMPAIGN_STATUSES.READY,
    });

    const ready = await service.transition(actor, 'camp1', 'ready');
    expect(ready.status).toBe(CAMPAIGN_STATUSES.READY);

    prisma.outboundCampaign.findFirst.mockResolvedValue({
      ...baseCampaign,
      status: CAMPAIGN_STATUSES.READY,
    });
    prisma.outboundCampaign.update.mockResolvedValue({
      ...baseCampaign,
      status: CAMPAIGN_STATUSES.RUNNING,
      startedAt: new Date(),
    });

    const started = await service.transition(actor, 'camp1', 'start');
    expect(started.status).toBe(CAMPAIGN_STATUSES.RUNNING);
    expect(audit.write).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: CAMPAIGN_STARTED }),
    );
  });

  it('addLeads stamps metadata and skips duplicates', async () => {
    prisma.outboundCampaign.findFirst.mockResolvedValue(baseCampaign);
    prisma.lead.findMany
      .mockResolvedValueOnce([
        { id: 'l1', metadata: { importBatchId: 'b1' } },
        { id: 'l2', metadata: null },
      ])
      .mockResolvedValueOnce([
        {
          id: 'l1',
          status: LeadStatus.NEW,
          score: 10,
          lastOutboundAt: null,
          lastInboundAt: null,
        },
      ]);
    prisma.outboundCampaignLead.findFirst
      .mockResolvedValueOnce(null) // l1 active
      .mockResolvedValueOnce(null) // l1 soft
      .mockResolvedValueOnce({ id: 'm2' }); // l2 active → skip
    prisma.outboundCampaignLead.create.mockResolvedValue({ id: 'm1' });
    prisma.lead.update.mockResolvedValue({});
    prisma.outboundCampaignLead.findMany.mockResolvedValue([{ leadId: 'l1' }]);
    prisma.followUp.findMany.mockResolvedValue([]);

    const result = await service.addLeads(actor, 'camp1', {
      leadIds: ['l1', 'l2'],
    });

    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'l1' },
        data: {
          metadata: expect.objectContaining({ outboundCampaignId: 'camp1' }),
        },
      }),
    );
    expect(prom.recordCampaignLeadsAdded).toHaveBeenCalledWith(1);
  });

  it('removeLeads soft-deletes membership', async () => {
    prisma.outboundCampaign.findFirst.mockResolvedValue(baseCampaign);
    prisma.outboundCampaignLead.findFirst.mockResolvedValue({
      id: 'm1',
      leadId: 'l1',
    });
    prisma.lead.findFirst.mockResolvedValue({
      metadata: { outboundCampaignId: 'camp1', importBatchId: 'b1' },
    });
    prisma.outboundCampaignLead.update.mockResolvedValue({});
    prisma.lead.update.mockResolvedValue({});
    mockEmptyMetrics();

    const result = await service.removeLeads(actor, 'camp1', {
      leadIds: ['l1'],
    });
    expect(result.removed).toBe(1);
    expect(prisma.outboundCampaignLead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { deletedAt: expect.any(Date) },
      }),
    );
  });

  it('attachImportBatch rejects non-COMPLETED batch', async () => {
    prisma.outboundCampaign.findFirst.mockResolvedValue(baseCampaign);
    prisma.leadImportBatch.findFirst.mockResolvedValue({
      id: 'b1',
      status: 'VALIDATED',
    });

    await expect(
      service.attachImportBatch(actor, 'camp1', { importBatchId: 'b1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('generateFirstTouch requires RUNNING', async () => {
    prisma.outboundCampaign.findFirst.mockResolvedValue(baseCampaign);

    await expect(
      service.generateFirstTouch(actor, 'camp1', { limit: 10 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('generateFirstTouch delegates to FirstTouch when RUNNING', async () => {
    prisma.outboundCampaign.findFirst.mockResolvedValue({
      ...baseCampaign,
      status: CAMPAIGN_STATUSES.RUNNING,
    });
    prisma.outboundCampaignLead.findMany.mockResolvedValue([
      { leadId: 'l1' },
      { leadId: 'l2' },
    ]);
    firstTouch.generate.mockResolvedValue({
      created: 1,
      skipped: 1,
      items: [{ id: 'fu1', leadId: 'l1' }],
    });

    const result = await service.generateFirstTouch(actor, 'camp1', {
      limit: 5,
    });

    expect(firstTouch.generate).toHaveBeenCalledWith(
      actor,
      { leadIds: ['l1', 'l2'], limit: 5 },
      undefined,
    );
    expect(result).toEqual(
      expect.objectContaining({ campaignId: 'camp1', created: 1 }),
    );
  });

  it('computeMetrics counts HOT and reply rate', async () => {
    prisma.outboundCampaignLead.findMany.mockResolvedValue([
      { leadId: 'l1' },
      { leadId: 'l2' },
      { leadId: 'l3' },
    ]);
    prisma.lead.findMany.mockResolvedValue([
      {
        id: 'l1',
        status: LeadStatus.CONTACTED,
        score: CAMPAIGN_HOT_SCORE_THRESHOLD,
        lastOutboundAt: new Date('2026-08-01T10:00:00Z'),
        lastInboundAt: new Date('2026-08-01T12:00:00Z'),
      },
      {
        id: 'l2',
        status: LeadStatus.NEW,
        score: 20,
        lastOutboundAt: null,
        lastInboundAt: null,
      },
      {
        id: 'l3',
        status: LeadStatus.CONVERTED,
        score: 90,
        lastOutboundAt: new Date('2026-08-01T10:00:00Z'),
        lastInboundAt: null,
      },
    ]);
    prisma.followUp.findMany.mockResolvedValue([
      { leadId: 'l1' },
      { leadId: 'l3' },
    ]);

    const metrics = await service.computeMetrics('c1', 'camp1');

    expect(prisma.followUp.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE,
          status: FollowUpStatus.EXECUTED,
        }),
      }),
    );
    expect(metrics.totalLeads).toBe(3);
    expect(metrics.eligible).toBe(1);
    expect(metrics.firstTouchSent).toBe(2);
    expect(metrics.responded).toBe(1);
    expect(metrics.hot).toBe(2);
    expect(metrics.converted).toBe(1);
    expect(metrics.replyRate).toBe(0.5);
  });

  it('getById 404 when missing', async () => {
    prisma.outboundCampaign.findFirst.mockResolvedValue(null);
    await expect(service.getById(actor, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cannot add leads to ARCHIVED campaign', async () => {
    prisma.outboundCampaign.findFirst.mockResolvedValue({
      ...baseCampaign,
      status: CAMPAIGN_STATUSES.ARCHIVED,
    });
    await expect(
      service.addLeads(actor, 'camp1', { leadIds: ['l1'] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
