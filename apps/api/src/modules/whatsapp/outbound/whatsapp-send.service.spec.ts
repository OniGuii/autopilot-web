import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConversationStatus, WhatsAppConnectionStatus } from '@prisma/client';
import { WhatsappSendService } from './whatsapp-send.service';
import { OUTBOUND_MESSAGE_STATUS } from './message-status';

describe('WhatsappSendService', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const otherCompanyId = '99999999-9999-9999-9999-999999999999';
  const actor = {
    sub: 'user-1',
    cid: companyId,
    mid: 'mem-1',
    role: 'AGENT',
  } as never;

  const lead = {
    id: 'lead-1',
    companyId,
    phone: '5511987654321',
    deletedAt: null,
  };
  const conversation = {
    id: 'conv-1',
    companyId,
    leadId: 'lead-1',
    status: ConversationStatus.OPEN,
    deletedAt: null,
  };
  const instance = {
    id: 'inst-1',
    companyId,
    status: WhatsAppConnectionStatus.CONNECTED,
    evolutionInstanceName: 'aptest',
    deletedAt: null,
  };

  function build(opts?: {
    lead?: unknown;
    conversation?: unknown;
    instance?: unknown;
    sendError?: Error;
  }) {
    const audits: unknown[] = [];
    const messages: Array<Record<string, unknown>> = [];

    const prisma = {
      lead: {
        findFirst: jest.fn().mockResolvedValue(opts?.lead === undefined ? lead : opts.lead),
        update: jest.fn().mockResolvedValue({}),
      },
      conversation: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts?.conversation === undefined ? conversation : opts.conversation,
          ),
        update: jest.fn().mockResolvedValue({}),
      },
      whatsAppInstance: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts?.instance === undefined ? instance : opts.instance,
          ),
      },
      message: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          const row = { id: 'msg-pending', ...data };
          messages.push(row);
          return row;
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          message: {
            update: prisma.message.update,
          },
          conversation: { update: prisma.conversation.update },
          lead: { update: prisma.lead.update },
        };
        return fn(tx);
      }),
    };

    const audit = {
      write: jest.fn(async (_tx: unknown, input: unknown) => {
        audits.push(input);
        return { id: 'a1' };
      }),
    };

    const evolution = {
      sendText: opts?.sendError
        ? jest.fn().mockRejectedValue(opts.sendError)
        : jest.fn().mockResolvedValue({
            externalMessageId: 'EVO_OUT_1',
            stub: true,
          }),
    };

    const service = new WhatsappSendService(
      prisma as never,
      audit as never,
      evolution as never,
    );

    return { service, prisma, audit, evolution, audits, messages };
  }

  it('sends outbound with PENDING→SENT, timestamps and audit', async () => {
    const { service, prisma, evolution, audits, messages } = build();

    const result = await service.send(actor, {
      leadId: lead.id,
      conversationId: conversation.id,
      body: 'Olá cliente',
    });

    expect(messages[0]?.status).toBe(OUTBOUND_MESSAGE_STATUS.PENDING);
    expect(evolution.sendText).toHaveBeenCalledWith({
      instanceName: 'aptest',
      phone: lead.phone,
      text: 'Olá cliente',
    });
    expect(result).toEqual({
      ok: true,
      messageId: 'msg-pending',
      conversationId: conversation.id,
      leadId: lead.id,
      externalMessageId: 'EVO_OUT_1',
      status: OUTBOUND_MESSAGE_STATUS.SENT,
    });
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastOutboundAt: expect.any(Date) }),
      }),
    );
    expect(audits.map((a) => (a as { action: string }).action)).toContain(
      'WHATSAPP_MESSAGE_SENT',
    );
  });

  it('uses JWT.cid only — lead from other tenant is 404', async () => {
    const { service, prisma } = build({ lead: null });
    await expect(
      service.send(actor, {
        leadId: lead.id,
        conversationId: conversation.id,
        body: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId, id: lead.id }),
      }),
    );
    expect(companyId).not.toBe(otherCompanyId);
  });

  it('rejects CLOSED conversation with 400 (P3-C2)', async () => {
    const { service } = build({
      conversation: { ...conversation, status: ConversationStatus.CLOSED },
    });
    await expect(
      service.send(actor, {
        leadId: lead.id,
        conversationId: conversation.id,
        body: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when instance is not CONNECTED', async () => {
    const { service } = build({
      instance: {
        ...instance,
        status: WhatsAppConnectionStatus.DISCONNECTED,
      },
    });
    await expect(
      service.send(actor, {
        leadId: lead.id,
        conversationId: conversation.id,
        body: 'x',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps FAILED message when Evolution errors (P3-D1)', async () => {
    const { service, prisma, audits } = build({
      sendError: new Error('boom'),
    });

    await expect(
      service.send(actor, {
        leadId: lead.id,
        conversationId: conversation.id,
        body: 'x',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OUTBOUND_MESSAGE_STATUS.FAILED,
          errorMessage: 'boom',
        }),
      }),
    );
    expect(prisma.message.create).toHaveBeenCalled();
    expect(audits.map((a) => (a as { action: string }).action)).toContain(
      'WHATSAPP_MESSAGE_FAILED',
    );
  });

  it('rejects lead/conversation mismatch', async () => {
    const { service } = build({
      conversation: { ...conversation, leadId: 'other-lead' },
    });
    await expect(
      service.send(actor, {
        leadId: lead.id,
        conversationId: conversation.id,
        body: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
