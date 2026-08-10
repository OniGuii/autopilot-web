import { ConflictException } from '@nestjs/common';
import { FollowUpStatus, LeadStatus } from '@prisma/client';
import { OutboundFirstTouchService } from './outbound-first-touch.service';
import { FIRST_TOUCH_MODES } from './outbound-first-touch.constants';

describe('OutboundFirstTouchService (V1.3)', () => {
  const prisma = {
    companyFirstTouchSettings: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    company: { findFirst: jest.fn() },
    lead: { findMany: jest.fn(), findFirst: jest.fn() },
    followUp: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    knowledgeBaseEntry: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { write: jest.fn() };
  const suppress = { isSuppressed: jest.fn() };
  const prom = {
    recordFirstTouchCreated: jest.fn(),
    recordFirstTouchSent: jest.fn(),
    recordFirstTouchFailed: jest.fn(),
    setFirstTouchReplyRate: jest.fn(),
  };

  let service: OutboundFirstTouchService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    suppress.isSuppressed.mockResolvedValue(false);
    prisma.knowledgeBaseEntry.findMany.mockResolvedValue([]);
    service = new OutboundFirstTouchService(
      prisma as never,
      audit as never,
      suppress as never,
      prom as never,
    );
  });

  it('getOrCreateSettings creates OFF default', async () => {
    prisma.companyFirstTouchSettings.findFirst.mockResolvedValue(null);
    const created = {
      id: 's1',
      companyId: 'c1',
      mode: FIRST_TOUCH_MODES.OFF,
      verticalPlaybook: 'generic',
      maxBatchSize: 50,
      requireImportBatch: false,
      enableKbGrounding: true,
      enableMemorySeed: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.companyFirstTouchSettings.create.mockResolvedValue(created);

    const result = await service.getOrCreateSettings({ cid: 'c1', sub: 'u1' });
    expect(result.mode).toBe('OFF');
    expect(prisma.companyFirstTouchSettings.create).toHaveBeenCalled();
  });

  it('generate rejects when mode is OFF', async () => {
    prisma.companyFirstTouchSettings.findFirst.mockResolvedValue({
      id: 's1',
      companyId: 'c1',
      mode: FIRST_TOUCH_MODES.OFF,
      verticalPlaybook: 'generic',
      maxBatchSize: 50,
      requireImportBatch: false,
      enableKbGrounding: true,
      enableMemorySeed: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.generate({ cid: 'c1', sub: 'u1' }, {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('generate creates SUGGESTED follow-up in HUMAN_APPROVE', async () => {
    prisma.companyFirstTouchSettings.findFirst.mockResolvedValue({
      id: 's1',
      companyId: 'c1',
      mode: FIRST_TOUCH_MODES.HUMAN_APPROVE,
      verticalPlaybook: 'financeira',
      maxBatchSize: 50,
      requireImportBatch: false,
      enableKbGrounding: false,
      enableMemorySeed: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.company.findFirst.mockResolvedValue({ id: 'c1', name: 'CrediX' });
    prisma.lead.findMany.mockResolvedValue([
      {
        id: 'l1',
        name: 'Ana',
        phone: '5511999999999',
        status: LeadStatus.NEW,
        metadata: { product: 'consórcio', city: 'SP' },
        lastOutboundAt: null,
      },
    ]);
    prisma.followUp.findFirst.mockResolvedValue(null);
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({
      id: 'conv1',
      metadata: null,
    });
    const fu = {
      id: 'fu1',
      leadId: 'l1',
      conversationId: 'conv1',
      status: FollowUpStatus.SUGGESTED,
      suggestedBody: 'Oi, Ana!',
      scheduledAt: null,
      executedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.followUp.create.mockResolvedValue(fu);

    const result = await service.generate({ cid: 'c1', sub: 'u1' }, { limit: 1 });

    expect(result.created).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'fu1',
        status: FollowUpStatus.SUGGESTED,
        mode: FIRST_TOUCH_MODES.HUMAN_APPROVE,
      }),
    );
    expect(prisma.followUp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'OUTBOUND_FIRST_TOUCH',
          status: FollowUpStatus.SUGGESTED,
        }),
      }),
    );
    expect(prom.recordFirstTouchCreated).toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'FIRST_TOUCH_CREATED' }),
    );
  });

  it('approve transitions SUGGESTED → SCHEDULED', async () => {
    prisma.companyFirstTouchSettings.findFirst.mockResolvedValue({
      id: 's1',
      companyId: 'c1',
      mode: FIRST_TOUCH_MODES.HUMAN_APPROVE,
      verticalPlaybook: 'generic',
      maxBatchSize: 50,
      requireImportBatch: false,
      enableKbGrounding: true,
      enableMemorySeed: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.followUp.findFirst.mockResolvedValue({
      id: 'fu1',
      companyId: 'c1',
      type: 'OUTBOUND_FIRST_TOUCH',
      status: FollowUpStatus.SUGGESTED,
      scheduledAt: null,
      leadId: 'l1',
      conversationId: 'c1',
      suggestedBody: 'Oi',
      executedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.followUp.update.mockResolvedValue({
      id: 'fu1',
      leadId: 'l1',
      conversationId: 'c1',
      status: FollowUpStatus.SCHEDULED,
      suggestedBody: 'Oi',
      scheduledAt: new Date(),
      executedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.approve({ cid: 'c1', sub: 'u1' }, 'fu1');
    expect(result.status).toBe(FollowUpStatus.SCHEDULED);
    expect(audit.write).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'FIRST_TOUCH_APPROVED' }),
    );
  });
});
