import { LeadStatus, MessageDirection } from '@prisma/client';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import type { ParsedInboundMessage } from './parse-inbound-message';

describe('WhatsappInboundService', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const instance = {
    id: '22222222-2222-2222-2222-222222222222',
    companyId,
  };

  const dto: ParsedInboundMessage = {
    remotePhone: '5511987654321',
    remoteJid: '5511987654321@s.whatsapp.net',
    externalMessageId: 'EXT_MSG_1',
    body: 'Quero um orçamento',
    fromMe: false,
    sentAt: new Date('2026-08-03T12:00:00.000Z'),
    pushName: 'Lead',
    messageType: 'conversation',
    isGroup: false,
  };

  function buildService(opts: {
    existingMessage?: unknown;
    existingLead?: unknown;
    openConversation?: unknown;
  }) {
    const audits: unknown[] = [];
    const created: {
      lead?: unknown;
      conversation?: unknown;
      message?: unknown;
    } = {};

    const tx = {
      lead: {
        findFirst: jest.fn().mockResolvedValue(opts.existingLead ?? null),
        create: jest.fn().mockImplementation(async ({ data }) => {
          created.lead = {
            id: 'lead-new',
            ...data,
          };
          return created.lead;
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      conversation: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(opts.openConversation ?? null) // open/idle
          .mockResolvedValueOnce(null), // threadTaken
        create: jest.fn().mockImplementation(async ({ data }) => {
          created.conversation = {
            id: 'conv-new',
            ...data,
          };
          return created.conversation;
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      message: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          created.message = { id: 'msg-new', ...data };
          return created.message;
        }),
      },
    };

    const prisma = {
      message: {
        findFirst: jest.fn().mockResolvedValue(opts.existingMessage ?? null),
      },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };

    const audit = {
      write: jest.fn(async (_tx: unknown, input: unknown) => {
        audits.push(input);
        return { id: 'audit' };
      }),
    };

    const service = new WhatsappInboundService(
      prisma as never,
      audit as never,
    );

    return { service, prisma, tx, audit, audits, created };
  }

  it('returns duplicate without side effects when external_message_id exists', async () => {
    const { service, prisma, audit } = buildService({
      existingMessage: {
        id: 'msg-existing',
        conversationId: 'conv-1',
        conversation: { leadId: 'lead-1' },
      },
    });

    const result = await service.processInboundMessage(companyId, dto, instance);

    expect(result.duplicate).toBe(true);
    expect(result.messageId).toBe('msg-existing');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('auto-creates Lead CONTACTED + Conversation + Message INBOUND + audits', async () => {
    const { service, tx, audits, created } = buildService({});

    const result = await service.processInboundMessage(companyId, dto, instance);

    expect(result.leadCreated).toBe(true);
    expect(result.conversationCreated).toBe(true);
    expect(result.messageId).toBe('msg-new');

    expect(tx.lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId,
          phone: dto.remotePhone,
          status: LeadStatus.CONTACTED,
          source: 'WHATSAPP',
          ownerId: null,
          score: 0,
        }),
      }),
    );

    expect(tx.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: MessageDirection.INBOUND,
          status: 'RECEIVED',
          senderType: 'LEAD',
          externalMessageId: dto.externalMessageId,
          body: dto.body,
        }),
      }),
    );

    expect(tx.conversation.update).toHaveBeenCalled();
    expect(tx.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastInboundAt: dto.sentAt,
          lastContactAt: dto.sentAt,
        }),
      }),
    );

    const actions = audits.map((a) => (a as { action: string }).action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'LEAD_AUTO_CREATED',
        'CONVERSATION_AUTO_CREATED',
        'WHATSAPP_MESSAGE_RECEIVED',
      ]),
    );
    expect(created.message).toBeDefined();
  });

  it('reuses OPEN conversation and promotes NEW lead to CONTACTED', async () => {
    const { service, tx, audits } = buildService({
      existingLead: {
        id: 'lead-old',
        phone: dto.remotePhone,
        status: LeadStatus.NEW,
        companyId,
      },
      openConversation: {
        id: 'conv-open',
        leadId: 'lead-old',
        status: 'OPEN',
      },
    });

    const result = await service.processInboundMessage(companyId, dto, instance);

    expect(result.leadCreated).toBe(false);
    expect(result.conversationCreated).toBe(false);
    expect(tx.lead.create).not.toHaveBeenCalled();
    expect(tx.conversation.create).not.toHaveBeenCalled();
    expect(tx.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LeadStatus.CONTACTED,
        }),
      }),
    );

    const actions = audits.map((a) => (a as { action: string }).action);
    expect(actions).toContain('WHATSAPP_MESSAGE_RECEIVED');
    expect(actions).not.toContain('LEAD_AUTO_CREATED');
    expect(actions).not.toContain('CONVERSATION_AUTO_CREATED');
  });

  it('rejects tenant mismatch between companyId and instance', async () => {
    const { service } = buildService({});
    await expect(
      service.processInboundMessage(companyId, dto, {
        id: instance.id,
        companyId: '99999999-9999-9999-9999-999999999999',
      }),
    ).rejects.toThrow(/Tenant mismatch/);
  });
});
