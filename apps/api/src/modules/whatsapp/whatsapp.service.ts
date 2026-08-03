import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  WhatsAppConnectionStatus,
  WhatsAppInstance,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { EvolutionClient } from './evolution.client';

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

@Injectable()
export class WhatsappService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly evolution: EvolutionClient,
  ) {}

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
   * Public webhook — connection events only (D17).
   * Validates X-Webhook-Secret against argon2 hash (D7/D12).
   */
  async handleWebhook(
    instanceKey: string,
    secretHeader: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<{ ok: true; ignored?: boolean; status?: WhatsAppConnectionStatus }> {
    if (!secretHeader) {
      throw new UnauthorizedException('Missing X-Webhook-Secret');
    }

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

    const eventName = this.extractEventName(payload);
    if (!eventName || !this.isConnectionEvent(eventName)) {
      return { ok: true, ignored: true };
    }

    const mapped = this.mapConnectionStatus(payload);
    if (!mapped) {
      return { ok: true, ignored: true };
    }

    if (
      mapped.status === instance.status &&
      (mapped.phoneNumber === undefined ||
        mapped.phoneNumber === instance.phoneNumber)
    ) {
      return { ok: true, status: instance.status };
    }

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
