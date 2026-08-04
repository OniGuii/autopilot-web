import { MessageDirection } from '@prisma/client';
import { WhatsappDeliveryService } from './whatsapp-delivery.service';
import { OUTBOUND_MESSAGE_STATUS } from './message-status';

describe('WhatsappDeliveryService', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';

  function build(message: Record<string, unknown> | null) {
    const audits: unknown[] = [];
    const prisma = {
      message: {
        findFirst: jest.fn().mockResolvedValue(message),
        updateMany: jest.fn().mockResolvedValue({ count: message ? 1 : 0 }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          message: {
            updateMany: prisma.message.updateMany,
            update: prisma.message.update,
            findFirst: prisma.message.findFirst,
          },
        };
        return fn(tx);
      }),
    };
    const audit = {
      write: jest.fn(async (_tx: unknown, input: unknown) => {
        audits.push(input);
        return { id: 'a' };
      }),
    };
    const service = new WhatsappDeliveryService(
      prisma as never,
      audit as never,
    );
    return { service, prisma, audit, audits };
  }

  it('applies SENT → DELIVERED with audit', async () => {
    const { service, audits } = build({
      id: 'msg-1',
      status: OUTBOUND_MESSAGE_STATUS.SENT,
      externalMessageId: 'EXT_1',
      sentAt: new Date(),
      deliveredAt: null,
      direction: MessageDirection.OUTBOUND,
    });

    const result = await service.applyDeliveryUpdate(companyId, {
      externalMessageId: 'EXT_1',
      targetStatus: OUTBOUND_MESSAGE_STATUS.DELIVERED,
      errorMessage: null,
      occurredAt: new Date(),
    });

    expect(result.kind).toBe('applied');
    expect(audits.map((a) => (a as { action: string }).action)).toContain(
      'WHATSAPP_MESSAGE_DELIVERED',
    );
  });

  it('audits and ignores regressions (P3-D2)', async () => {
    const { service, prisma, audits } = build({
      id: 'msg-1',
      status: OUTBOUND_MESSAGE_STATUS.DELIVERED,
      externalMessageId: 'EXT_1',
      direction: MessageDirection.OUTBOUND,
    });

    const result = await service.applyDeliveryUpdate(companyId, {
      externalMessageId: 'EXT_1',
      targetStatus: OUTBOUND_MESSAGE_STATUS.SENT,
      errorMessage: null,
      occurredAt: new Date(),
    });

    expect(result.kind).toBe('regression');
    expect(prisma.message.updateMany).not.toHaveBeenCalled();
    expect(audits.map((a) => (a as { action: string }).action)).toContain(
      'WHATSAPP_MESSAGE_STATUS_REGRESSION',
    );
  });

  it('heals echo race onto PENDING outbound without creating inbound', async () => {
    const pending = {
      id: 'msg-pending',
      status: OUTBOUND_MESSAGE_STATUS.PENDING,
      sentAt: null,
      conversationId: 'conv-1',
      conversation: { leadId: 'lead-1' },
      externalMessageId: null,
    };

    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null) // no existing by external id
      .mockResolvedValueOnce(pending); // heal candidate

    const prisma = {
      message: {
        findFirst,
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          message: { update: prisma.message.update },
        }),
      ),
    };
    const audits: unknown[] = [];
    const audit = {
      write: jest.fn(async (_t: unknown, input: unknown) => {
        audits.push(input);
        return { id: 'a' };
      }),
    };

    const service = new WhatsappDeliveryService(
      prisma as never,
      audit as never,
    );

    const result = await service.healEchoRace(companyId, {
      remotePhone: '5511987654321',
      remoteJid: '5511987654321@s.whatsapp.net',
      externalMessageId: 'ECHO_ID',
      body: 'Olá cliente',
    });

    expect(result.kind).toBe('healed');
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalMessageId: 'ECHO_ID',
          status: OUTBOUND_MESSAGE_STATUS.SENT,
        }),
      }),
    );
    expect(audits.map((a) => (a as { action: string }).action)).toContain(
      'WHATSAPP_MESSAGE_SENT',
    );
  });

  it('heals FAILED → SENT via echo after UNCERTAIN_TIMEOUT (CH3)', async () => {
    const failed = {
      id: 'msg-failed',
      status: OUTBOUND_MESSAGE_STATUS.FAILED,
      sentAt: null,
      conversationId: 'conv-1',
      conversation: { leadId: 'lead-1' },
      externalMessageId: null,
      metadata: { correlationId: 'corr-heal' },
    };

    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(failed);

    const prisma = {
      message: {
        findFirst,
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          message: { update: prisma.message.update },
        }),
      ),
    };
    const audits: unknown[] = [];
    const audit = {
      write: jest.fn(async (_t: unknown, input: unknown) => {
        audits.push(input);
        return { id: 'a' };
      }),
    };

    const service = new WhatsappDeliveryService(
      prisma as never,
      audit as never,
    );

    const result = await service.healEchoRace(companyId, {
      remotePhone: '5511987654321',
      remoteJid: '5511987654321@s.whatsapp.net',
      externalMessageId: 'ECHO_AFTER_TIMEOUT',
      body: null,
    });

    expect(result.kind).toBe('healed');
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OUTBOUND_MESSAGE_STATUS.SENT,
          failedAt: null,
          errorMessage: null,
        }),
      }),
    );
    expect(audits.map((a) => (a as { action: string }).action)).toContain(
      'WHATSAPP_MESSAGE_UNCERTAIN_RESOLVED',
    );
    expect(audits[0]).toEqual(
      expect.objectContaining({
        after: expect.objectContaining({ correlationId: 'corr-heal' }),
      }),
    );
  });
});
