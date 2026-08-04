import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
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

    const delivery = {
      applyDeliveryUpdate: jest.fn().mockResolvedValue({ kind: 'not_found' }),
      healEchoRace: jest.fn().mockResolvedValue({ kind: 'ignored' }),
    };

    const channelMetrics = {
      beginWebhook: jest.fn(),
      endWebhook: jest.fn(),
      recordWebhook: jest.fn(),
      recordConnectionFlap: jest.fn(),
    };
    const config = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'async.inboundEnabled') return false;
        return def;
      }),
    };

    const service = new WhatsappService(
      prisma as never,
      audit,
      evolution as never,
      inbound as never,
      delivery as never,
      channelMetrics as never,
      config as never,
      undefined,
    );

    return { service, prisma, inbound, delivery, webhookEvents, instance };
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

  it('enqueues webhook when ASYNC_INBOUND_ENABLED (7.1)', async () => {
    const hash = await argon2.hash(plainSecret);
    const instance = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      companyId,
      instanceKey,
      webhookSecretHash: hash,
      status: 'CONNECTED',
      deletedAt: null,
    };
    const prisma = {
      whatsAppInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      webhookEvent: {
        create: jest.fn().mockResolvedValue({ id: 'we-async-1' }),
        update: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const enqueue = jest
      .fn()
      .mockResolvedValue({ jobId: 'webhook:we-async-1' });
    const config = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'async.inboundEnabled') return true;
        return def;
      }),
    };
    const service = new WhatsappService(
      prisma as never,
      { write: jest.fn() },
      {} as never,
      { processInboundMessage: jest.fn() } as never,
      {
        applyDeliveryUpdate: jest.fn(),
        healEchoRace: jest.fn(),
      } as never,
      {
        beginWebhook: jest.fn(),
        endWebhook: jest.fn(),
        recordWebhook: jest.fn(),
        recordConnectionFlap: jest.fn(),
      } as never,
      config as never,
      { enqueue } as never,
    );

    const result = await service.handleWebhook(
      instanceKey,
      plainSecret,
      inboundPayload,
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        queued: true,
        webhookEventId: 'we-async-1',
        jobId: 'webhook:we-async-1',
        correlationId: expect.any(String),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        v: 1,
        webhookEventId: 'we-async-1',
        companyId,
        correlationId: expect.any(String),
      }),
    );
  });

  it('returns 503 when async enqueue fails (no sync fallback)', async () => {
    const hash = await argon2.hash(plainSecret);
    const instance = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      companyId,
      instanceKey,
      webhookSecretHash: hash,
      status: 'CONNECTED',
      deletedAt: null,
    };
    const update = jest.fn();
    const prisma = {
      whatsAppInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      webhookEvent: {
        create: jest.fn().mockResolvedValue({ id: 'we-async-fail' }),
        update,
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const inbound = { processInboundMessage: jest.fn() };
    const service = new WhatsappService(
      prisma as never,
      { write: jest.fn() },
      {} as never,
      inbound as never,
      {
        applyDeliveryUpdate: jest.fn(),
        healEchoRace: jest.fn(),
      } as never,
      {
        beginWebhook: jest.fn(),
        endWebhook: jest.fn(),
        recordWebhook: jest.fn(),
        recordConnectionFlap: jest.fn(),
      } as never,
      {
        get: jest.fn((key: string, def?: unknown) => {
          if (key === 'async.inboundEnabled') return true;
          return def;
        }),
      } as never,
      {
        enqueue: jest.fn().mockRejectedValue(new Error('redis timeout')),
      } as never,
    );

    await expect(
      service.handleWebhook(instanceKey, plainSecret, inboundPayload),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(inbound.processInboundMessage).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'we-async-fail' },
        data: expect.objectContaining({
          error: expect.stringContaining('ENQUEUE_FAILED'),
        }),
      }),
    );
  });

  it('claimWebhookEvent wins only once (atomic)', async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    const service = new WhatsappService(
      { webhookEvent: { updateMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        get: jest.fn((_k: string, def?: unknown) => def),
      } as never,
    );

    await expect(service.claimWebhookEvent('we-1', companyId)).resolves.toBe(
      true,
    );
    await expect(service.claimWebhookEvent('we-1', companyId)).resolves.toBe(
      false,
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [WebhookEventStatus.RECEIVED, WebhookEventStatus.FAILED],
          },
        }),
        data: expect.objectContaining({
          status: WebhookEventStatus.PROCESSING,
        }),
      }),
    );
  });

  it('processes inbound using instance.companyId (ignores payload companyId)', async () => {
    const { service, inbound, prisma, webhookEvents } = await build();

    const result = await service.handleWebhook(instanceKey, plainSecret, {
      ...inboundPayload,
      companyId: 'evil-tenant-should-be-ignored',
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        messageId: 'msg-1',
        leadId: 'lead-1',
        conversationId: 'conv-1',
        correlationId: expect.any(String),
        webhookEventId: expect.any(String),
      }),
    );

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

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        duplicate: true,
        messageId: 'msg-dup',
        leadId: 'lead-1',
        conversationId: 'conv-1',
        correlationId: expect.any(String),
      }),
    );
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WebhookEventStatus.DUPLICATE,
          error: 'DUPLICATE_EXTERNAL_MESSAGE_ID',
        }),
      }),
    );
  });

  it('ignores echo fromMe when heal finds nothing (never creates inbound)', async () => {
    const { service, inbound, delivery, prisma } = await build();

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

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        ignored: true,
        reason: 'ECHO_FROM_ME',
        correlationId: expect.any(String),
      }),
    );
    expect(inbound.processInboundMessage).not.toHaveBeenCalled();
    expect(delivery.healEchoRace).toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WebhookEventStatus.IGNORED,
          error: 'ECHO_FROM_ME',
        }),
      }),
    );
  });

  it('applies delivery ack updates for outbound messages', async () => {
    const { service, delivery, prisma } = await build();
    delivery.applyDeliveryUpdate.mockResolvedValue({
      kind: 'applied',
      messageId: 'msg-out',
      from: 'SENT',
      to: 'DELIVERED',
    });

    const result = await service.handleWebhook(instanceKey, plainSecret, {
      event: 'messages.update',
      data: {
        keyId: 'WA_OUT_1',
        status: 'DELIVERY_ACK',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('msg-out');
    expect(delivery.applyDeliveryUpdate).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({
        externalMessageId: 'WA_OUT_1',
        targetStatus: 'DELIVERED',
      }),
    );
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WebhookEventStatus.PROCESSED,
        }),
      }),
    );
  });
});
