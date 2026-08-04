import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FollowUpStatus } from '@prisma/client';
import { FollowUpService } from './follow-up.service';
import { FOLLOWUP_MAX_ATTEMPTS } from './follow-up.constants';

describe('FollowUpService Phase 4', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const otherCompany = '99999999-9999-9999-9999-999999999999';
  const actor = {
    sub: 'user-1',
    cid: companyId,
    mid: 'mem-1',
    role: 'AGENT',
  } as never;

  const baseFollowUp = {
    id: 'fu-1',
    companyId,
    leadId: 'lead-1',
    conversationId: 'conv-1',
    assignedUserId: null,
    approvedBy: 'user-1',
    approvedAt: new Date(),
    channel: 'WHATSAPP',
    status: FollowUpStatus.SCHEDULED,
    type: 'RECOVERY',
    scheduledAt: new Date(),
    executedAt: null,
    suggestedBody: 'Olá, ainda tem interesse?',
    resultMessageId: null,
    cancelReason: null,
    metadata: { attemptCount: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  function build(opts?: {
    followUp?: Record<string, unknown>;
    sendImpl?: jest.Mock;
    connected?: boolean;
  }) {
    const followUp = { ...baseFollowUp, ...(opts?.followUp ?? {}) };
    const audits: unknown[] = [];
    let stored = { ...followUp };

    const prisma = {
      followUp: {
        findFirst: jest.fn().mockImplementation(async ({ where }) => {
          if (where.companyId && where.companyId !== companyId) return null;
          if (where.id && where.id !== stored.id) return null;
          return { ...stored };
        }),
        create: jest.fn(),
        update: jest.fn().mockImplementation(async ({ data }) => {
          stored = { ...stored, ...data, updatedAt: new Date() };
          return { ...stored };
        }),
        updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
          if (where.status && where.status !== stored.status) {
            return { count: 0 };
          }
          if (
            where.status &&
            typeof where.status === 'object' &&
            'in' in where.status &&
            !where.status.in.includes(stored.status)
          ) {
            return { count: 0 };
          }
          stored = { ...stored, ...data, updatedAt: new Date() };
          return { count: 1 };
        }),
        count: jest.fn(),
        findMany: jest.fn(),
      },
      lead: {
        findFirst: jest.fn().mockResolvedValue({ id: 'lead-1' }),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conv-1',
          companyId,
          leadId: 'lead-1',
        }),
      },
      membership: { findFirst: jest.fn() },
      $transaction: jest.fn(async (fn: unknown) => {
        if (typeof fn === 'function') {
          return fn({
            followUp: prisma.followUp,
            auditLog: {},
          });
        }
        return fn;
      }),
    };

    const audit = {
      write: jest.fn(async (_tx: unknown, input: unknown) => {
        audits.push(input);
        return { id: 'a' };
      }),
    };

    const whatsappSend = {
      assertChannelAvailable: jest.fn(),
      assertConnected:
        opts?.connected === false
          ? jest
              .fn()
              .mockRejectedValue(
                new ConflictException('WhatsApp instance not CONNECTED'),
              )
          : jest.fn().mockResolvedValue(undefined),
      send:
        opts?.sendImpl ??
        jest.fn().mockResolvedValue({
          ok: true,
          messageId: 'msg-1',
          conversationId: 'conv-1',
          leadId: 'lead-1',
          externalMessageId: 'EXT_1',
          status: 'SENT',
          correlationId: 'corr-fu',
        }),
    };

    const service = new FollowUpService(
      prisma as never,
      audit as never,
      whatsappSend as never,
    );

    return { service, prisma, audit, whatsappSend, audits, getStored: () => stored };
  }

  it('approve transitions SUGGESTED → SCHEDULED (P4-A1)', async () => {
    const { service, getStored, audits } = build({
      followUp: { status: FollowUpStatus.SUGGESTED, approvedBy: null },
    });

    const result = await service.approve(actor, 'fu-1', {}, undefined);
    expect(result.status).toBe(FollowUpStatus.SCHEDULED);
    expect(getStored().status).toBe(FollowUpStatus.SCHEDULED);
    expect(audits.map((a) => (a as { action: string }).action)).toContain(
      'FOLLOWUP_APPROVE',
    );
  });

  it('approve de FollowUp AI também audita AI_SUGGESTION_APPROVED', async () => {
    const { service, audits } = build({
      followUp: {
        status: FollowUpStatus.SUGGESTED,
        approvedBy: null,
        type: 'AI_REPLY',
        metadata: { source: 'ai', model: 'gpt-4o-mini', attemptCount: 0 },
      },
    });

    await service.approve(actor, 'fu-1', {}, undefined);
    const actions = audits.map((a) => (a as { action: string }).action);
    expect(actions).toContain('FOLLOWUP_APPROVE');
    expect(actions).toContain('AI_SUGGESTION_APPROVED');
  });

  it('reject de FollowUp AI também audita AI_SUGGESTION_REJECTED', async () => {
    const { service, audits } = build({
      followUp: {
        status: FollowUpStatus.SUGGESTED,
        approvedBy: null,
        type: 'AI_REPLY',
        metadata: { source: 'ai', model: 'gpt-4o-mini', attemptCount: 0 },
      },
    });

    await service.reject(actor, 'fu-1', { reason: 'tom inadequado' }, undefined);
    const actions = audits.map((a) => (a as { action: string }).action);
    expect(actions).toContain('FOLLOWUP_REJECT');
    expect(actions).toContain('AI_SUGGESTION_REJECTED');
  });

  it('execute uses WhatsappSendService with followup metadata (P4-D1/D5)', async () => {
    const { service, whatsappSend, audits, getStored } = build();

    const result = await service.execute(actor, 'fu-1');

    expect(whatsappSend.assertConnected).toHaveBeenCalledWith(companyId);
    expect(whatsappSend.assertChannelAvailable).toHaveBeenCalled();
    expect(whatsappSend.send).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        leadId: 'lead-1',
        conversationId: 'conv-1',
        body: 'Olá, ainda tem interesse?',
        metadata: expect.objectContaining({
          source: 'followup',
          followUpId: 'fu-1',
          attempt: 1,
          correlationId: expect.any(String),
        }),
      }),
      undefined,
    );
    expect(result.status).toBe(FollowUpStatus.EXECUTED);
    expect(result.resultMessageId).toBe('msg-1');
    expect(getStored().status).toBe(FollowUpStatus.EXECUTED);
    expect(audits.map((a) => (a as { action: string }).action)).toContain(
      'FOLLOWUP_EXECUTE',
    );
  });

  it('returns 409 when instance not CONNECTED without EXECUTING (P4-F1)', async () => {
    const { service, whatsappSend, getStored } = build({ connected: false });

    await expect(service.execute(actor, 'fu-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(whatsappSend.send).not.toHaveBeenCalled();
    expect(getStored().status).toBe(FollowUpStatus.SCHEDULED);
  });

  it('marks FAILED and audits when Evolution send fails', async () => {
    const { service, audits, getStored } = build({
      sendImpl: jest.fn().mockRejectedValue(
        new BadGatewayException({
          message: 'WhatsApp send failed',
          messageId: 'msg-fail',
          status: 'FAILED',
          error: 'boom',
        }),
      ),
    });

    await expect(service.execute(actor, 'fu-1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(getStored().status).toBe(FollowUpStatus.FAILED);
    expect(getStored().resultMessageId).toBe('msg-fail');
    expect(audits.map((a) => (a as { action: string }).action)).toContain(
      'FOLLOWUP_EXECUTE_FAILED',
    );
  });

  it('retry from FAILED creates new attempt and audits FOLLOWUP_RETRY', async () => {
    const { service, whatsappSend, audits, getStored } = build({
      followUp: {
        status: FollowUpStatus.FAILED,
        metadata: { attemptCount: 1 },
        resultMessageId: 'msg-old',
      },
    });

    const result = await service.retry(actor, 'fu-1');
    expect(result.status).toBe(FollowUpStatus.EXECUTED);
    expect(whatsappSend.send).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        metadata: expect.objectContaining({ attempt: 2 }),
      }),
      undefined,
    );
    expect(getStored().metadata).toEqual(
      expect.objectContaining({ attemptCount: 2 }),
    );
    const actions = audits.map((a) => (a as { action: string }).action);
    expect(actions).toContain('FOLLOWUP_RETRY');
    expect(actions).toContain('FOLLOWUP_EXECUTE');
  });

  it('rejects retry after max attempts (P4-R4)', async () => {
    const { service, whatsappSend } = build({
      followUp: {
        status: FollowUpStatus.FAILED,
        metadata: { attemptCount: FOLLOWUP_MAX_ATTEMPTS },
      },
    });

    await expect(service.retry(actor, 'fu-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(whatsappSend.send).not.toHaveBeenCalled();
  });

  it('cancel allows SCHEDULED and forbids EXECUTED (P4-C1)', async () => {
    const ok = build({ followUp: { status: FollowUpStatus.SCHEDULED } });
    const cancelled = await ok.service.cancel(actor, 'fu-1', {
      reason: 'stop',
    });
    expect(cancelled.status).toBe(FollowUpStatus.CANCELLED);
    expect(ok.audits.map((a) => (a as { action: string }).action)).toContain(
      'FOLLOWUP_CANCEL',
    );

    const bad = build({ followUp: { status: FollowUpStatus.EXECUTED } });
    await expect(
      bad.service.cancel(actor, 'fu-1', {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('tenant isolation — follow-up of other company is 404', async () => {
    const { service } = build();
    await expect(
      service.execute(
        { ...actor, cid: otherCompany } as never,
        'fu-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects execute when status is not SCHEDULED', async () => {
    const { service } = build({
      followUp: { status: FollowUpStatus.APPROVED },
    });
    await expect(service.execute(actor, 'fu-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
