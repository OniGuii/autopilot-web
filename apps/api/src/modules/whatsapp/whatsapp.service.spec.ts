import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { WebhookEventStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { WhatsappService } from './whatsapp.service';

describe('WhatsappService.handleWebhook (Phase 2)', () => {
  const instanceKey = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const companyId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const plainSecret = 'test-webhook-secret-plain';

  async function build(opts?: {
    instance?: Record<string, unknown> | null;
    inboundResult?: Record<string, unknown>;
  }) {
    const hash = await argon2.hash(plainSecret);
    const instance =
      opts?.instance === null
        ? null
        : {
            id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            companyId,
            instanceKey,
            webhookSecretHash: hash,
            status: 'DISCONNECTED',
            phoneNumber: null,
            evolutionInstanceName: 'aptest',
            evolutionInstanceId: null,
            qrCode: null,
            qrExpiresAt: null,
            connectedAt: null,
            lastDisconnectedAt: null,
            lastError: null,
            metadata: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            ...(opts?.instance ?? {}),
          };

    const webhookEvents: Array<Record<string, unknown>> = [];

    const prisma = {
      whatsAppInstance: {
        findFirst: jest.fn().mockResolvedValue(instance),
      },
      webhookEvent: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          const row = { id: `we-${webhookEvents.length + 1}`, ...data };
          webhookEvents.push(row);
          return { id: row.id };
        }),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const audit = { write: jest.fn() };
    const evolution = {
      ensureInstanceAndQr: jest.fn(),
      logout: jest.fn(),
    };
    const inbound = {
      processInboundMessage: jest.fn().mockResolvedValue(
        opts?.inboundResult ?? {
          messageId: 'msg-1',
          leadId: 'lead-1',
          conversationId: 'conv-1',
          leadCreated: true,
          conversationCreated: true,
        },
      ),
    };

    const service = new WhatsappService(
      prisma as never,
      audit as never,
      evolution as never,
      inbound as never,
    );

    return { service, prisma, inbound, webhookEvents, instance };
  }

  const inboundPayload = {
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '5511999990000@s.whatsapp.net',
        fromMe: false,
        id: 'WA_ID_1',
      },
      messageTimestamp: 1_720_000_000,
      message: { conversation: 'Oi' },
    },
  };

  it('rejects missing secret with 401', async () => {
    const { service } = await build();
    await expect(
      service.handleWebhook(instanceKey, undefined, inboundPayload),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects unknown instanceKey with 404', async () => {
    const { service } = await build({ instance: null });
    await expect(
      service.handleWebhook(instanceKey, plainSecret, inboundPayload),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects invalid secret with 403', async () => {
    const { service } = await build();
    await expect(
      service.handleWebhook(instanceKey, 'wrong-secret', inboundPayload),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('processes inbound using instance.companyId (ignores payload companyId)', async () => {
    const { service, inbound, prisma, webhookEvents } = await build();

    const result = await service.handleWebhook(instanceKey, plainSecret, {
      ...inboundPayload,
      companyId: 'evil-tenant-should-be-ignored',
    });

    expect(result).toEqual({
      ok: true,
      messageId: 'msg-1',
      leadId: 'lead-1',
      conversationId: 'conv-1',
    });

    expect(inbound.processInboundMessage).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({
        remotePhone: '5511999990000',
        externalMessageId: 'WA_ID_1',
        body: 'Oi',
      }),
      expect.objectContaining({ companyId, id: expect.any(String) }),
    );

    expect(prisma.webhookEvent.create).toHaveBeenCalled();
    expect(webhookEvents[0]?.companyId).toBe(companyId);
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WebhookEventStatus.PROCESSED,
        }),
      }),
    );
  });

  it('accepts inbound when instance is DISCONNECTED (P2-S1)', async () => {
    const { service, inbound } = await build({
      instance: { status: 'DISCONNECTED' },
    });

    const result = await service.handleWebhook(
      instanceKey,
      plainSecret,
      inboundPayload,
    );

    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('msg-1');
    expect(inbound.processInboundMessage).toHaveBeenCalled();
  });

  it('marks webhook DUPLICATE when inbound processor reports duplicate', async () => {
    const { service, prisma } = await build({
      inboundResult: {
        messageId: 'msg-dup',
        leadId: 'lead-1',
        conversationId: 'conv-1',
        leadCreated: false,
        conversationCreated: false,
        duplicate: true,
      },
    });

    const result = await service.handleWebhook(
      instanceKey,
      plainSecret,
      inboundPayload,
    );

    expect(result).toEqual({
      ok: true,
      duplicate: true,
      messageId: 'msg-dup',
      leadId: 'lead-1',
      conversationId: 'conv-1',
    });
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WebhookEventStatus.DUPLICATE,
          error: 'DUPLICATE_EXTERNAL_MESSAGE_ID',
        }),
      }),
    );
  });

  it('ignores echo fromMe and records IGNORED webhook event', async () => {
    const { service, inbound, prisma } = await build();

    const result = await service.handleWebhook(instanceKey, plainSecret, {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '5511999990000@s.whatsapp.net',
          fromMe: true,
          id: 'ECHO_1',
        },
        message: { conversation: 'echo' },
      },
    });

    expect(result).toEqual({
      ok: true,
      ignored: true,
      reason: 'ECHO_FROM_ME',
    });
    expect(inbound.processInboundMessage).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WebhookEventStatus.IGNORED,
          error: 'ECHO_FROM_ME',
        }),
      }),
    );
  });
});
