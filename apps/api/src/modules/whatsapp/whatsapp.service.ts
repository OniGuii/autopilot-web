import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  WebhookEventStatus,
  WhatsAppConnectionStatus,
  WhatsAppInstance,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { EvolutionChannelMetrics } from './evolution.channel-metrics';
import {
  WEBHOOK_MAX_INFLIGHT_DEFAULT,
  WEBHOOK_SLOW_MS_DEFAULT,
} from './evolution.constants';
import { EvolutionClient } from './evolution.client';
import {
  extractExternalEventId,
  isMessageEvent,
  parseInboundMessage,
} from './inbound/parse-inbound-message';
import { WhatsappInboundService } from './inbound/whatsapp-inbound.service';
import { WhatsappDeliveryService } from './outbound/whatsapp-delivery.service';
import {
  isDeliveryEvent,
  parseDeliveryUpdate,
} from './outbound/parse-delivery-update';
import { parseEchoCandidate } from './outbound/parse-echo-candidate';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

export type WhatsAppStatusResponse = {
  companyId: string;
  status: WhatsAppConnectionStatus;
  phoneNumber: string | null;
  instanceName: string;
  instanceKey: string;
  connectedAt: Date | null;
  qrCode?: string | null;
  lastError?: string | null;
};

export type WebhookResponse = {
  ok: true;
  ignored?: boolean;
  duplicate?: boolean;
  status?: WhatsAppConnectionStatus;
  messageId?: string;
  leadId?: string;
  conversationId?: string;
  reason?: string;
};

@Injectable()
export class WhatsappService {
  private readonly webhookSlowMs: number;
  private readonly webhookMaxInflight: number;
  private webhookInflight = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly evolution: EvolutionClient,
    private readonly inbound: WhatsappInboundService,
    private readonly delivery: WhatsappDeliveryService,
    private readonly channelMetrics: EvolutionChannelMetrics,
    config: ConfigService,
  ) {
    this.webhookSlowMs = config.get<number>(
      'evolution.webhookSlowMs',
      WEBHOOK_SLOW_MS_DEFAULT,
    );
    this.webhookMaxInflight = config.get<number>(
      'evolution.webhookMaxInflight',
      WEBHOOK_MAX_INFLIGHT_DEFAULT,
    );
  }

  async connect(
    actor: CompanyActor,
    meta?: RequestMeta,
  ): Promise<WhatsAppStatusResponse> {
    const companyId = actor.cid;
    const existing = await this.findActiveByCompany(companyId);

    // D15 — idempotent when already CONNECTED
    if (existing?.status === WhatsAppConnectionStatus.CONNECTED) {
      return this.toStatusResponse(existing);
    }

    const plainSecretBase64 = randomBytes(64).toString('base64url');
    const webhookSecretHash = await argon2.hash(plainSecretBase64);

    if (existing) {
      return this.reconnectExisting(
        actor,
        existing,
        plainSecretBase64,
        webhookSecretHash,
        meta,
      );
    }

    return this.createNewInstance(
      actor,
      plainSecretBase64,
      webhookSecretHash,
      meta,
    );
  }

  async status(actor: CompanyActor): Promise<WhatsAppStatusResponse> {
    const instance = await this.findActiveByCompany(actor.cid);
    if (!instance) {
      throw new NotFoundException(
        'WhatsApp instance not found. Call POST /whatsapp/connect.',
      );
    }
    return this.toStatusResponse(instance, {
      includeQr: instance.status === WhatsAppConnectionStatus.QR_PENDING,
    });
  }

  async disconnect(
    actor: CompanyActor,
    meta?: RequestMeta,
  ): Promise<WhatsAppStatusResponse> {
    const existing = await this.findActiveByCompany(actor.cid);
    if (!existing) {
      throw new NotFoundException('WhatsApp instance not found');
    }

    try {
      await this.evolution.logout(existing.evolutionInstanceName);
    } catch {
      // Persist DISCONNECTED even if Evolution logout fails.
    }

    const instance = await this.prisma.$transaction(async (tx) => {
      // D16 — keep row; status DISCONNECTED; connectedAt = null
      const updated = await tx.whatsAppInstance.update({
        where: { id: existing.id },
        data: {
          status: WhatsAppConnectionStatus.DISCONNECTED,
          connectedAt: null,
          qrCode: null,
          qrExpiresAt: null,
          lastDisconnectedAt: new Date(),
          lastError: null,
        },
      });

      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: 'WHATSAPP_DISCONNECT',
        targetType: 'WHATSAPP_INSTANCE',
        targetId: updated.id,
        before: this.snapshot(existing),
        after: this.snapshot(updated),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return updated;
    });

    return this.toStatusResponse(instance);
  }

  /**
   * Public webhook — connection (F1) + inbound (F2) + delivery acks (F3).
   * Tenant ONLY from WhatsAppInstance.instanceKey (never payload.companyId).
   * P2-S1: inbound accepted even when status != CONNECTED.
   */
  async handleWebhook(
    instanceKey: string,
    secretHeader: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<WebhookResponse> {
    if (!secretHeader) {
      throw new UnauthorizedException('Missing X-Webhook-Secret');
    }

    if (this.webhookInflight >= this.webhookMaxInflight) {
      throw new ServiceUnavailableException('WEBHOOK_BACKPRESSURE');
    }

    this.webhookInflight += 1;
    this.channelMetrics.beginWebhook();
    const started = Date.now();

    try {
      return await this.handleWebhookInner(instanceKey, secretHeader, payload);
    } finally {
      const durationMs = Date.now() - started;
      this.webhookInflight = Math.max(0, this.webhookInflight - 1);
      this.channelMetrics.endWebhook();
      this.channelMetrics.recordWebhook(durationMs, this.webhookSlowMs);
    }
  }

  private async handleWebhookInner(
    instanceKey: string,
    secretHeader: string,
    payload: Record<string, unknown>,
  ): Promise<WebhookResponse> {
    const instance = await this.prisma.whatsAppInstance.findFirst({
      where: { instanceKey, deletedAt: null },
    });
    if (!instance) {
      throw new NotFoundException('Unknown instanceKey');
    }

    const secretOk = await argon2.verify(
      instance.webhookSecretHash,
      secretHeader,
    );
    if (!secretOk) {
      throw new ForbiddenException('Invalid webhook secret');
    }

    // companyId exclusively from instance — ignore any payload.companyId
    const companyId = instance.companyId;
    const eventName = this.extractEventName(payload) ?? 'unknown';

    const externalEventId = extractExternalEventId(payload);

    const webhookEvent = await this.registerWebhookEvent({
      companyId,
      instanceId: instance.id,
      eventType: eventName,
      externalEventId,
      payload,
    });

    if (webhookEvent.duplicate) {
      return { ok: true, duplicate: true };
    }

    try {
      if (this.isConnectionEvent(eventName)) {
        const result = await this.processConnectionEvent(instance, payload);
        await this.finalizeWebhookEvent(
          webhookEvent.id,
          result.ignored
            ? WebhookEventStatus.IGNORED
            : WebhookEventStatus.PROCESSED,
          result.ignored ? 'NO_STATUS_CHANGE_OR_UNMAPPED' : null,
        );
        return result;
      }

      if (isDeliveryEvent(eventName)) {
        return await this.processDeliveryEvent(
          companyId,
          payload,
          eventName,
          webhookEvent.id,
        );
      }

      if (isMessageEvent(eventName)) {
        return await this.processMessageEvent(
          instance,
          companyId,
          payload,
          webhookEvent.id,
        );
      }

      await this.finalizeWebhookEvent(
        webhookEvent.id,
        WebhookEventStatus.IGNORED,
        'UNSUPPORTED_EVENT',
      );
      return { ok: true, ignored: true, reason: 'UNSUPPORTED_EVENT' };
    } catch (error) {
      await this.finalizeWebhookEvent(
        webhookEvent.id,
        WebhookEventStatus.FAILED,
        error instanceof Error ? error.message.slice(0, 1000) : 'UNKNOWN_ERROR',
      );
      throw error;
    }
  }

  private async processDeliveryEvent(
    companyId: string,
    payload: Record<string, unknown>,
    eventName: string,
    webhookEventId: string,
  ): Promise<WebhookResponse> {
    const parsed = parseDeliveryUpdate(payload, eventName);
    if (!parsed.ok) {
      await this.finalizeWebhookEvent(
        webhookEventId,
        WebhookEventStatus.IGNORED,
        parsed.reason,
      );
      return { ok: true, ignored: true, reason: parsed.reason };
    }

    const result = await this.delivery.applyDeliveryUpdate(
      companyId,
      parsed.update,
    );

    if (result.kind === 'not_found') {
      await this.finalizeWebhookEvent(
        webhookEventId,
        WebhookEventStatus.IGNORED,
        'OUTBOUND_MESSAGE_NOT_FOUND',
      );
      return { ok: true, ignored: true, reason: 'OUTBOUND_MESSAGE_NOT_FOUND' };
    }

    if (result.kind === 'regression') {
      await this.finalizeWebhookEvent(
        webhookEventId,
        WebhookEventStatus.IGNORED,
        `REGRESSION_${result.from}_TO_${result.to}`,
      );
      return {
        ok: true,
        ignored: true,
        reason: 'STATUS_REGRESSION',
        messageId: result.messageId,
      };
    }

    if (result.kind === 'noop') {
      await this.finalizeWebhookEvent(
        webhookEventId,
        WebhookEventStatus.IGNORED,
        'STATUS_UNCHANGED',
      );
      return {
        ok: true,
        ignored: true,
        reason: 'STATUS_UNCHANGED',
        messageId: result.messageId,
      };
    }

    await this.finalizeWebhookEvent(
      webhookEventId,
      WebhookEventStatus.PROCESSED,
      null,
    );
    return {
      ok: true,
      messageId: result.messageId,
      status: undefined,
      reason: `${result.from}->${result.to}`,
    };
  }

  private async processMessageEvent(
    instance: WhatsAppInstance,
    companyId: string,
    payload: Record<string, unknown>,
    webhookEventId: string,
  ): Promise<WebhookResponse> {
    const parsed = parseInboundMessage(payload);
    if (!parsed.ok) {
      // P3-E1/E2 — Echo Protection + heal race
      if (parsed.reason === 'ECHO_FROM_ME') {
        const echo = parseEchoCandidate(payload);
        if (echo) {
          const healed = await this.delivery.healEchoRace(companyId, echo);
          if (healed.kind === 'healed') {
            await this.finalizeWebhookEvent(
              webhookEventId,
              WebhookEventStatus.PROCESSED,
              'ECHO_HEALED',
            );
            return {
              ok: true,
              messageId: healed.messageId,
              leadId: healed.leadId,
              conversationId: healed.conversationId,
              reason: 'ECHO_HEALED',
            };
          }
          if (healed.kind === 'duplicate') {
            await this.finalizeWebhookEvent(
              webhookEventId,
              WebhookEventStatus.DUPLICATE,
              'ECHO_DUPLICATE_EXTERNAL_ID',
            );
            return {
              ok: true,
              duplicate: true,
              messageId: healed.messageId,
              leadId: healed.leadId,
              conversationId: healed.conversationId,
              reason: 'ECHO_FROM_ME',
            };
          }
        }
      }

      await this.finalizeWebhookEvent(
        webhookEventId,
        WebhookEventStatus.IGNORED,
        parsed.reason,
      );
      return { ok: true, ignored: true, reason: parsed.reason };
    }

    const result = await this.inbound.processInboundMessage(
      companyId,
      parsed.message,
      instance,
    );

    if (result.duplicate) {
      await this.finalizeWebhookEvent(
        webhookEventId,
        WebhookEventStatus.DUPLICATE,
        'DUPLICATE_EXTERNAL_MESSAGE_ID',
      );
      return {
        ok: true,
        duplicate: true,
        messageId: result.messageId,
        leadId: result.leadId,
        conversationId: result.conversationId,
      };
    }

    await this.finalizeWebhookEvent(
      webhookEventId,
      WebhookEventStatus.PROCESSED,
      null,
    );

    return {
      ok: true,
      messageId: result.messageId,
      leadId: result.leadId,
      conversationId: result.conversationId,
    };
  }

  private async processConnectionEvent(
    instance: WhatsAppInstance,
    payload: Record<string, unknown>,
  ): Promise<WebhookResponse> {
    const mapped = this.mapConnectionStatus(payload);
    if (!mapped) {
      return { ok: true, ignored: true, reason: 'UNMAPPED_CONNECTION' };
    }

    if (
      mapped.status === instance.status &&
      (mapped.phoneNumber === undefined ||
        mapped.phoneNumber === instance.phoneNumber)
    ) {
      return { ok: true, status: instance.status };
    }

    this.channelMetrics.recordConnectionFlap();

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.whatsAppInstance.update({
        where: { id: instance.id },
        data: {
          status: mapped.status,
          phoneNumber:
            mapped.phoneNumber !== undefined
              ? mapped.phoneNumber
              : instance.phoneNumber,
          connectedAt:
            mapped.status === WhatsAppConnectionStatus.CONNECTED
              ? new Date()
              : mapped.status === WhatsAppConnectionStatus.DISCONNECTED ||
                  mapped.status === WhatsAppConnectionStatus.ERROR
                ? null
                : instance.connectedAt,
          lastDisconnectedAt:
            mapped.status === WhatsAppConnectionStatus.DISCONNECTED
              ? new Date()
              : instance.lastDisconnectedAt,
          qrCode:
            mapped.status === WhatsAppConnectionStatus.CONNECTED
              ? null
              : instance.qrCode,
          lastError:
            mapped.status === WhatsAppConnectionStatus.ERROR
              ? (mapped.error ?? 'Connection error')
              : null,
        },
      });

      await this.audit.write(tx, {
        companyId: instance.companyId,
        actorUserId: null,
        action: 'WHATSAPP_STATUS_CHANGE',
        targetType: 'WHATSAPP_INSTANCE',
        targetId: next.id,
        before: this.snapshot(instance),
        after: this.snapshot(next),
      });

      if (mapped.status === WhatsAppConnectionStatus.CONNECTED) {
        await this.audit.write(tx, {
          companyId: instance.companyId,
          actorUserId: null,
          action: 'WHATSAPP_CONNECTED',
          targetType: 'WHATSAPP_INSTANCE',
          targetId: next.id,
          before: this.snapshot(instance),
          after: this.snapshot(next),
        });
      }

      return next;
    });

    return { ok: true, status: updated.status };
  }

  private async registerWebhookEvent(input: {
    companyId: string;
    instanceId: string;
    eventType: string;
    externalEventId: string | null;
    payload: Record<string, unknown>;
  }): Promise<{ id: string; duplicate: boolean }> {
    const safePayload = this.truncatePayload(input.payload);

    try {
      const created = await this.prisma.webhookEvent.create({
        data: {
          companyId: input.companyId,
          instanceId: input.instanceId,
          eventType: input.eventType.slice(0, 120),
          externalEventId: input.externalEventId,
          payload: safePayload as Prisma.InputJsonValue,
          status: WebhookEventStatus.RECEIVED,
        },
        select: { id: true },
      });
      return { id: created.id, duplicate: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        input.externalEventId
      ) {
        const existing = await this.prisma.webhookEvent.findFirst({
          where: {
            companyId: input.companyId,
            externalEventId: input.externalEventId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existing) {
          await this.prisma.webhookEvent.update({
            where: { id: existing.id },
            data: {
              status: WebhookEventStatus.DUPLICATE,
              processedAt: new Date(),
              error: 'DUPLICATE_EXTERNAL_EVENT_ID',
            },
          });
          return { id: existing.id, duplicate: true };
        }
      }
      throw error;
    }
  }

  private async finalizeWebhookEvent(
    id: string,
    status: WebhookEventStatus,
    error: string | null,
  ): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status,
        error,
        processedAt: new Date(),
      },
    });
  }

  private truncatePayload(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    try {
      const raw = JSON.stringify(payload);
      if (raw.length <= 50_000) return payload;
      return {
        truncated: true,
        preview: raw.slice(0, 50_000),
      };
    } catch {
      return { truncated: true, error: 'UNSERIALIZABLE_PAYLOAD' };
    }
  }

  private async createNewInstance(
    actor: CompanyActor,
    plainSecretBase64: string,
    webhookSecretHash: string,
    meta?: RequestMeta,
  ): Promise<WhatsAppStatusResponse> {
    const instanceKey = randomUUID();
    const evolutionInstanceName = `ap${instanceKey.replace(/-/g, '')}`.slice(
      0,
      100,
    );

    let qrCode: string | null = null;
    let lastError: string | null = null;
    let status: WhatsAppConnectionStatus = WhatsAppConnectionStatus.QR_PENDING;
    let evolutionInstanceId: string | null = null;

    try {
      const evo = await this.evolution.ensureInstanceAndQr({
        instanceName: evolutionInstanceName,
        instanceKey,
        webhookSecretPlain: plainSecretBase64,
      });
      qrCode = evo.qrCode;
      evolutionInstanceId = evo.evolutionInstanceId ?? null;
    } catch (error) {
      status = WhatsAppConnectionStatus.ERROR;
      lastError =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : 'Evolution connect failed';
    }

    const instance = await this.prisma.$transaction(async (tx) => {
      const created = await tx.whatsAppInstance.create({
        data: {
          companyId: actor.cid,
          instanceKey,
          evolutionInstanceName,
          evolutionInstanceId,
          status,
          webhookSecretHash,
          qrCode,
          qrExpiresAt: qrCode ? new Date(Date.now() + 2 * 60 * 1000) : null,
          connectedAt: null,
          lastError,
        },
      });

      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: 'WHATSAPP_CONNECT',
        targetType: 'WHATSAPP_INSTANCE',
        targetId: created.id,
        before: null,
        after: this.snapshot(created),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return created;
    });

    return this.toStatusResponse(instance, { includeQr: true });
  }

  private async reconnectExisting(
    actor: CompanyActor,
    existing: WhatsAppInstance,
    plainSecretBase64: string,
    webhookSecretHash: string,
    meta?: RequestMeta,
  ): Promise<WhatsAppStatusResponse> {
    let qrCode: string | null = null;
    let lastError: string | null = null;
    let status: WhatsAppConnectionStatus = WhatsAppConnectionStatus.QR_PENDING;

    try {
      const evo = await this.evolution.ensureInstanceAndQr({
        instanceName: existing.evolutionInstanceName,
        instanceKey: existing.instanceKey,
        webhookSecretPlain: plainSecretBase64,
      });
      qrCode = evo.qrCode;
    } catch (error) {
      status = WhatsAppConnectionStatus.ERROR;
      lastError =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : 'Evolution connect failed';
    }

    const instance = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.whatsAppInstance.update({
        where: { id: existing.id },
        data: {
          webhookSecretHash,
          status,
          qrCode,
          qrExpiresAt: qrCode ? new Date(Date.now() + 2 * 60 * 1000) : null,
          connectedAt: null,
          lastError,
        },
      });

      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: 'WHATSAPP_CONNECT',
        targetType: 'WHATSAPP_INSTANCE',
        targetId: updated.id,
        before: this.snapshot(existing),
        after: this.snapshot(updated),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return updated;
    });

    return this.toStatusResponse(instance, { includeQr: true });
  }

  private extractEventName(payload: Record<string, unknown>): string | null {
    const event = payload.event ?? payload.type;
    return typeof event === 'string' ? event : null;
  }

  private isConnectionEvent(eventName: string): boolean {
    const normalized = eventName.toLowerCase();
    if (
      normalized === 'connection.update' ||
      normalized === 'connection_update'
    ) {
      return true;
    }
    return (
      normalized.includes('connection') && !normalized.includes('message')
    );
  }

  private mapConnectionStatus(payload: Record<string, unknown>): {
    status: WhatsAppConnectionStatus;
    phoneNumber?: string | null;
    error?: string;
  } | null {
    const data = (payload.data ?? payload) as Record<string, unknown>;
    const stateRaw =
      data.state ?? data.status ?? (data as { connection?: string }).connection;
    const state =
      typeof stateRaw === 'string' ? stateRaw.toLowerCase() : null;

    if (!state) return null;

    if (['open', 'connected', 'authenticated'].includes(state)) {
      const phoneCandidate =
        (typeof data.wuid === 'string' && data.wuid.split('@')[0]) ||
        (typeof data.phoneNumber === 'string' && data.phoneNumber) ||
        (typeof data.owner === 'string' && data.owner.split('@')[0]) ||
        null;
      return {
        status: WhatsAppConnectionStatus.CONNECTED,
        phoneNumber: phoneCandidate
          ? String(phoneCandidate).replace(/\D/g, '')
          : null,
      };
    }

    if (['connecting', 'pairingsuccess'].includes(state)) {
      return { status: WhatsAppConnectionStatus.CONNECTING };
    }

    if (['close', 'closed', 'disconnected', 'logout'].includes(state)) {
      return { status: WhatsAppConnectionStatus.DISCONNECTED };
    }

    if (['refused', 'error', 'timeout'].includes(state)) {
      return {
        status: WhatsAppConnectionStatus.ERROR,
        error: typeof data.message === 'string' ? data.message : state,
      };
    }

    return null;
  }

  private async findActiveByCompany(
    companyId: string,
  ): Promise<WhatsAppInstance | null> {
    return this.prisma.whatsAppInstance.findFirst({
      where: { companyId, deletedAt: null },
    });
  }

  private toStatusResponse(
    instance: WhatsAppInstance,
    opts?: { includeQr?: boolean },
  ): WhatsAppStatusResponse {
    return {
      companyId: instance.companyId,
      status: instance.status,
      phoneNumber: instance.phoneNumber,
      instanceName: instance.evolutionInstanceName,
      instanceKey: instance.instanceKey,
      connectedAt: instance.connectedAt,
      ...(opts?.includeQr ? { qrCode: instance.qrCode } : {}),
      lastError: instance.lastError,
    };
  }

  private snapshot(instance: WhatsAppInstance) {
    return {
      id: instance.id,
      companyId: instance.companyId,
      instanceKey: instance.instanceKey,
      evolutionInstanceName: instance.evolutionInstanceName,
      status: instance.status,
      phoneNumber: instance.phoneNumber,
      connectedAt: instance.connectedAt?.toISOString() ?? null,
      lastError: instance.lastError,
    };
  }
}
