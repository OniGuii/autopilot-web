import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ConversationStatus,
  MessageDirection,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { TimelineQueryDto } from './dto/timeline.query.dto';

type CompanyActor = AuthenticatedUser & { cid: string };

const BODY_MAX = 2000;

const AUDIT_WHITELIST = new Set([
  'LEAD_CREATE',
  'LEAD_UPDATE',
  'LEAD_ASSIGN',
  'LEAD_UNASSIGN',
  'LEAD_DELETE',
  'LEAD_AUTO_CREATED',
  'LEAD_STATUS_CHANGE',
  'LEAD_BULK_ASSIGN',
  'NOTE_CREATE',
  'NOTE_UPDATE',
  'NOTE_DELETE',
  'ACTIVITY_CREATE',
  'ACTIVITY_UPDATE',
  'ACTIVITY_COMPLETE',
  'ACTIVITY_CANCEL',
  'CONVERSATION_CREATE',
  'CONVERSATION_UPDATE',
  'CONVERSATION_CLOSE',
  'CONVERSATION_AUTO_CREATE',
  'MESSAGE_CREATE',
  'FOLLOWUP_CREATE',
  'FOLLOWUP_UPDATE',
  'FOLLOWUP_APPROVE',
  'FOLLOWUP_REJECT',
  'FOLLOWUP_CANCEL',
  'FOLLOWUP_EXECUTE',
  'FOLLOWUP_RESCHEDULE',
  'AI_SUGGESTION_CREATED',
  'AI_SUGGESTION_APPROVED',
  'AI_SUGGESTION_REJECTED',
  'WHATSAPP_MESSAGE_SENT',
  'WHATSAPP_MESSAGE_RECEIVED',
  'WHATSAPP_MESSAGE_DELIVERED',
  'WHATSAPP_MESSAGE_READ',
  'WHATSAPP_MESSAGE_FAILED',
]);

export type TimelineItem = {
  id: string;
  itemType: string;
  occurredAt: string;
  actorUserId: string | null;
  summary: string;
  payload: Record<string, unknown>;
};

export type TimelineResponse = {
  leadId: string;
  companyId: string;
  items: TimelineItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

@Injectable()
export class LeadTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async getTimeline(
    actor: CompanyActor,
    leadId: string,
    query: TimelineQueryDto,
  ): Promise<TimelineResponse> {
    const companyId = actor.cid;
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId, deletedAt: null },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const [conversations, followUps, notes, activities] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { companyId, leadId, deletedAt: null },
        include: {
          messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      this.prisma.followUp.findMany({
        where: { companyId, leadId, deletedAt: null },
      }),
      this.prisma.leadNote.findMany({
        where: { companyId, leadId, deletedAt: null },
      }),
      this.prisma.leadActivity.findMany({
        where: { companyId, leadId, deletedAt: null },
      }),
    ]);

    const conversationIds = conversations.map((c) => c.id);
    const messageIds = conversations.flatMap((c) =>
      c.messages.map((m) => m.id),
    );
    const followUpIds = followUps.map((f) => f.id);
    const noteIds = notes.map((n) => n.id);
    const activityIds = activities.map((a) => a.id);

    const relatedIds = [
      leadId,
      ...conversationIds,
      ...messageIds,
      ...followUpIds,
      ...noteIds,
      ...activityIds,
    ];

    const audits = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        deletedAt: null,
        action: { in: [...AUDIT_WHITELIST] },
        OR: [
          { targetId: { in: relatedIds } },
          {
            after: {
              path: ['leadId'],
              equals: leadId,
            },
          },
        ],
      },
      orderBy: { occurredAt: 'asc' },
      take: 2000,
    });

    const items: TimelineItem[] = [];

    items.push({
      id: `lead:${lead.id}`,
      itemType: 'LEAD_CREATED',
      occurredAt: lead.createdAt.toISOString(),
      actorUserId: null,
      summary: 'Lead created',
      payload: {
        status: lead.status,
        source: lead.source,
        phone: lead.phone,
        name: lead.name,
      },
    });

    for (const conv of conversations) {
      items.push({
        id: `conversation:${conv.id}:opened`,
        itemType: 'CONVERSATION_OPENED',
        occurredAt: conv.createdAt.toISOString(),
        actorUserId: conv.assignedUserId,
        summary: `Conversation opened (${conv.channel})`,
        payload: {
          conversationId: conv.id,
          channel: conv.channel,
          status: conv.status,
        },
      });

      if (
        conv.status === ConversationStatus.CLOSED ||
        conv.status === ConversationStatus.ARCHIVED
      ) {
        items.push({
          id: `conversation:${conv.id}:closed`,
          itemType: 'CONVERSATION_CLOSED',
          occurredAt: conv.updatedAt.toISOString(),
          actorUserId: conv.assignedUserId,
          summary: `Conversation ${conv.status.toLowerCase()}`,
          payload: {
            conversationId: conv.id,
            status: conv.status,
          },
        });
      }

      for (const msg of conv.messages) {
        const inbound = msg.direction === MessageDirection.INBOUND;
        items.push({
          id: `message:${msg.id}`,
          itemType: inbound ? 'MESSAGE_INBOUND' : 'MESSAGE_OUTBOUND',
          occurredAt: (msg.sentAt ?? msg.createdAt).toISOString(),
          actorUserId: msg.senderUserId,
          summary: inbound ? 'Inbound message' : 'Outbound message',
          payload: {
            conversationId: conv.id,
            direction: msg.direction,
            status: msg.status,
            body: truncate(msg.body),
          },
        });
      }
    }

    for (const fu of followUps) {
      const meta = asRecord(fu.metadata);
      const isAi =
        fu.type === 'AI_REPLY' ||
        (typeof meta?.source === 'string' && meta.source === 'ai');
      items.push({
        id: `followup:${fu.id}`,
        itemType: isAi ? 'AI_SUGGESTION' : 'FOLLOW_UP',
        occurredAt: fu.createdAt.toISOString(),
        actorUserId: fu.assignedUserId,
        summary: isAi
          ? `AI suggestion (${fu.status})`
          : `Follow-up ${fu.type} (${fu.status})`,
        payload: {
          type: fu.type,
          status: fu.status,
          scheduledAt: fu.scheduledAt?.toISOString() ?? null,
          suggestedBody: truncate(fu.suggestedBody),
        },
      });
    }

    for (const note of notes) {
      items.push({
        id: `note:${note.id}`,
        itemType: 'NOTE',
        occurredAt: note.createdAt.toISOString(),
        actorUserId: note.userId,
        summary: 'Note added',
        payload: { body: truncate(note.body) },
      });
    }

    for (const activity of activities) {
      items.push({
        id: `activity:${activity.id}`,
        itemType: 'ACTIVITY',
        occurredAt: activity.createdAt.toISOString(),
        actorUserId: activity.userId,
        summary: `${activity.type} — ${activity.title} (${activity.status})`,
        payload: {
          type: activity.type,
          status: activity.status,
          title: activity.title,
          body: truncate(activity.body),
          scheduledAt: activity.scheduledAt?.toISOString() ?? null,
          completedAt: activity.completedAt?.toISOString() ?? null,
        },
      });
    }

    for (const audit of audits) {
      items.push({
        id: `audit:${audit.id}`,
        itemType: `AUDIT_${audit.action}`,
        occurredAt: audit.occurredAt.toISOString(),
        actorUserId: audit.actorUserId,
        summary: audit.action,
        payload: {
          action: audit.action,
          targetType: audit.targetType,
          targetId: audit.targetId,
          after: sanitizeJson(audit.after),
        },
      });
    }

    items.sort((a, b) => {
      const t = a.occurredAt.localeCompare(b.occurredAt);
      if (t !== 0) return t;
      return a.id.localeCompare(b.id);
    });

    const total = items.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const pageItems = items.slice(start, start + limit);

    return {
      leadId,
      companyId,
      items: pageItems,
      meta: { page, limit, total, totalPages },
    };
  }
}

function truncate(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.length > BODY_MAX ? value.slice(0, BODY_MAX) : value;
}

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function sanitizeJson(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const copy = { ...record };
  delete copy.correlationId;
  return copy;
}
