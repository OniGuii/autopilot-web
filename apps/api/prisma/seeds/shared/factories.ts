import {
  Channel,
  ConversationStatus,
  LeadStatus,
  MembershipRole,
  MessageDirection,
  Prisma,
  PrismaClient,
  UserStatus,
  FollowUpStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { LEAD_STATUSES, SEED_MARKER, SEED_PASSWORD } from './constants';

let cachedPasswordHash: string | null = null;

async function seedPasswordHash(): Promise<string> {
  if (!cachedPasswordHash) {
    cachedPasswordHash = await argon2.hash(SEED_PASSWORD);
  }
  return cachedPasswordHash;
}

type SeedMeta = {
  seed: typeof SEED_MARKER;
  profile: string;
  key?: string;
};

function meta(profile: string, key?: string): SeedMeta {
  return { seed: SEED_MARKER, profile, ...(key ? { key } : {}) };
}

export async function upsertCompany(
  prisma: PrismaClient,
  input: {
    slug: string;
    name: string;
    timezone?: string;
    profile: string;
  },
) {
  const existing = await prisma.company.findFirst({
    where: { slug: input.slug, deletedAt: null },
  });

  if (existing) {
    return prisma.company.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        timezone: input.timezone ?? 'America/Sao_Paulo',
        status: 'ACTIVE',
      },
    });
  }

  return prisma.company.create({
    data: {
      name: input.name,
      slug: input.slug,
      timezone: input.timezone ?? 'America/Sao_Paulo',
      status: 'ACTIVE',
      plan: 'starter',
    },
  });
}

export async function upsertUser(
  prisma: PrismaClient,
  input: { email: string; name: string; password?: string },
) {
  const passwordHash = input.password
    ? await argon2.hash(input.password)
    : await seedPasswordHash();
  return prisma.user.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      name: input.name,
      status: UserStatus.ACTIVE,
      passwordHash,
    },
    update: {
      name: input.name,
      status: UserStatus.ACTIVE,
      deletedAt: null,
      passwordHash,
    },
  });
}

export async function upsertMembership(
  prisma: PrismaClient,
  input: {
    companyId: string;
    userId: string;
    role: MembershipRole;
    invitedBy?: string;
  },
) {
  const existing = await prisma.membership.findFirst({
    where: {
      companyId: input.companyId,
      userId: input.userId,
      deletedAt: null,
    },
  });

  if (existing) {
    return prisma.membership.update({
      where: { id: existing.id },
      data: {
        role: input.role,
        status: 'ACTIVE',
        joinedAt: existing.joinedAt ?? new Date(),
      },
    });
  }

  return prisma.membership.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      role: input.role,
      status: 'ACTIVE',
      invitedBy: input.invitedBy,
      joinedAt: new Date(),
    },
  });
}

export function statusForIndex(index: number): LeadStatus {
  return LEAD_STATUSES[index % LEAD_STATUSES.length] as LeadStatus;
}

export function fakePhone(prefix: string, index: number): string {
  // prefix like +1555100 + zero-padded 4 digits => +15551000001
  return `${prefix}${String(index).padStart(4, '0')}`;
}

export function fakeLeadName(index: number, suffix = 'Lead'): string {
  const first = [
    'Alex',
    'Bianca',
    'Caio',
    'Diana',
    'Eduardo',
    'Fabiana',
    'Gabriel',
    'Helena',
    'Igor',
    'Julia',
  ][index % 10];
  return `${first} ${suffix} ${index}`;
}

export async function upsertLead(
  prisma: PrismaClient,
  input: {
    companyId: string;
    ownerId?: string;
    phone: string;
    name: string;
    status: LeadStatus;
    score: number;
    source?: string;
    profile: string;
    key: string;
  },
) {
  const now = new Date();
  const contacted = input.status !== 'NEW';
  const responded = ['RESPONDED', 'QUALIFIED', 'CONVERTED', 'LOST'].includes(
    input.status,
  );
  const converted = input.status === 'CONVERTED';

  const data = {
    companyId: input.companyId,
    ownerId: input.ownerId,
    phone: input.phone,
    name: input.name,
    email: `lead.${input.key}@example.com`,
    source: input.source ?? 'WHATSAPP',
    status: input.status,
    score: Math.min(100, Math.max(0, input.score)),
    lastContactAt: contacted ? now : null,
    lastOutboundAt: contacted ? now : null,
    lastInboundAt: responded ? now : null,
    firstResponseAt: responded ? now : null,
    convertedAt: converted ? now : null,
    metadata: meta(input.profile, input.key) as unknown as Prisma.InputJsonValue,
    deletedAt: null,
  };

  const existing = await prisma.lead.findFirst({
    where: {
      companyId: input.companyId,
      phone: input.phone,
      deletedAt: null,
    },
  });

  if (existing) {
    // Preserve firstResponseAt / convertedAt once set (domain rules).
    return prisma.lead.update({
      where: { id: existing.id },
      data: {
        ...data,
        firstResponseAt: existing.firstResponseAt ?? data.firstResponseAt,
        convertedAt: existing.convertedAt ?? data.convertedAt,
      },
    });
  }

  return prisma.lead.create({ data });
}

export async function ensureConversationWithMessages(
  prisma: PrismaClient,
  input: {
    companyId: string;
    leadId: string;
    assignedUserId?: string;
    profile: string;
    key: string;
    messageCount?: number;
    status?: ConversationStatus;
  },
) {
  const externalThreadId = `seed-thread-${input.profile}-${input.key}`;
  const messageCount = input.messageCount ?? 4;

  let conversation = await prisma.conversation.findFirst({
    where: {
      companyId: input.companyId,
      externalThreadId,
      deletedAt: null,
    },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        companyId: input.companyId,
        leadId: input.leadId,
        channel: Channel.WHATSAPP,
        status: input.status ?? ConversationStatus.OPEN,
        externalThreadId,
        assignedUserId: input.assignedUserId,
        lastMessageAt: new Date(),
      },
    });
  } else {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        leadId: input.leadId,
        assignedUserId: input.assignedUserId,
        status: input.status ?? conversation.status,
        lastMessageAt: new Date(),
      },
    });
  }

  const existingMessages = await prisma.message.count({
    where: { conversationId: conversation.id, deletedAt: null },
  });

  if (existingMessages === 0) {
    const rows: Prisma.MessageCreateManyInput[] = [];
    for (let i = 1; i <= messageCount; i++) {
      const inbound = i % 2 === 1;
      rows.push({
        companyId: input.companyId,
        conversationId: conversation.id,
        direction: inbound ? MessageDirection.INBOUND : MessageDirection.OUTBOUND,
        status: inbound ? 'RECEIVED' : 'SENT',
        body: inbound
          ? `[SEED] Olá, tenho interesse (${input.key}) #${i}`
          : `[SEED] Obrigado pelo contato! Em que posso ajudar? #${i}`,
        contentType: 'TEXT',
        senderType: inbound ? 'LEAD' : 'USER',
        senderUserId: inbound ? null : input.assignedUserId,
        externalMessageId: `seed-msg-${input.profile}-${input.key}-${i}`,
        sentAt: new Date(),
        metadata: meta(input.profile, `${input.key}-msg-${i}`) as unknown as Prisma.InputJsonValue,
      });
    }
    await prisma.message.createMany({ data: rows });
  }

  return conversation;
}

export async function ensureFollowUps(
  prisma: PrismaClient,
  input: {
    companyId: string;
    leadId: string;
    conversationId?: string;
    assignedUserId?: string;
    approvedBy?: string;
    profile: string;
    key: string;
  },
) {
  const specs: Array<{
    status: FollowUpStatus;
    type: string;
    needsApproval: boolean;
  }> = [
    { status: 'SUGGESTED', type: 'RECOVERY', needsApproval: false },
    { status: 'APPROVED', type: 'RECOVERY', needsApproval: true },
    { status: 'EXECUTED', type: 'REMINDER', needsApproval: true },
  ];

  const created = [];

  for (const spec of specs) {
    const seedKey = `${input.key}-${spec.status}`;
    const existing = await prisma.followUp.findFirst({
      where: {
        companyId: input.companyId,
        leadId: input.leadId,
        deletedAt: null,
        suggestedBody: { contains: `[SEED:${seedKey}]` },
      },
    });

    if (existing) {
      created.push(existing);
      continue;
    }

    let resultMessageId: string | undefined;
    if (spec.status === 'EXECUTED' && input.conversationId) {
      const msg = await prisma.message.findFirst({
        where: {
          conversationId: input.conversationId,
          direction: 'OUTBOUND',
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });
      resultMessageId = msg?.id;
    }

    const followUp = await prisma.followUp.create({
      data: {
        companyId: input.companyId,
        leadId: input.leadId,
        conversationId: input.conversationId,
        assignedUserId: input.assignedUserId,
        approvedBy: spec.needsApproval ? input.approvedBy : null,
        approvedAt: spec.needsApproval ? new Date() : null,
        channel: Channel.WHATSAPP,
        status: spec.status,
        type: spec.type,
        scheduledAt: new Date(),
        executedAt: spec.status === 'EXECUTED' ? new Date() : null,
        suggestedBody: `[SEED:${seedKey}] Follow-up fake de recuperação — perfil ${input.profile}`,
        resultMessageId,
      },
    });
    created.push(followUp);
  }

  return created;
}

export async function ensureSeedEvent(
  prisma: PrismaClient,
  input: {
    companyId: string;
    type: string;
    aggregateType: string;
    aggregateId: string;
    actorUserId?: string;
    profile: string;
    key: string;
  },
) {
  const existing = await prisma.event.findFirst({
    where: {
      companyId: input.companyId,
      type: input.type,
      aggregateId: input.aggregateId,
      deletedAt: null,
      payload: {
        path: ['seedKey'],
        equals: input.key,
      },
    },
  });

  if (existing) return existing;

  return prisma.event.create({
    data: {
      companyId: input.companyId,
      type: input.type,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      actorUserId: input.actorUserId,
      status: 'PROCESSED',
      payload: {
        ...meta(input.profile, input.key),
        seedKey: input.key,
      },
    },
  });
}

export async function ensureSeedAuditLog(
  prisma: PrismaClient,
  input: {
    companyId: string;
    actorUserId?: string;
    action: string;
    targetType: string;
    targetId: string;
    profile: string;
    key: string;
  },
) {
  const existing = await prisma.auditLog.findFirst({
    where: {
      companyId: input.companyId,
      action: input.action,
      targetId: input.targetId,
      deletedAt: null,
      after: {
        path: ['seedKey'],
        equals: input.key,
      },
    },
  });

  if (existing) return existing;

  return prisma.auditLog.create({
    data: {
      companyId: input.companyId,
      actorType: 'SYSTEM',
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      after: {
        ...meta(input.profile, input.key),
        seedKey: input.key,
      },
    },
  });
}

export type SeedCounts = {
  companies: number;
  users: number;
  memberships: number;
  leads: number;
  conversations: number;
  messages: number;
  followUps: number;
  events: number;
  auditLogs: number;
};

export async function countCompanyTree(
  prisma: PrismaClient,
  companyIds: string[],
): Promise<SeedCounts> {
  const [
    companies,
    memberships,
    leads,
    conversations,
    messages,
    followUps,
    events,
    auditLogs,
  ] = await Promise.all([
    prisma.company.count({ where: { id: { in: companyIds }, deletedAt: null } }),
    prisma.membership.count({
      where: { companyId: { in: companyIds }, deletedAt: null },
    }),
    prisma.lead.count({ where: { companyId: { in: companyIds }, deletedAt: null } }),
    prisma.conversation.count({
      where: { companyId: { in: companyIds }, deletedAt: null },
    }),
    prisma.message.count({
      where: { companyId: { in: companyIds }, deletedAt: null },
    }),
    prisma.followUp.count({
      where: { companyId: { in: companyIds }, deletedAt: null },
    }),
    prisma.event.count({
      where: { companyId: { in: companyIds }, deletedAt: null },
    }),
    prisma.auditLog.count({
      where: { companyId: { in: companyIds }, deletedAt: null },
    }),
  ]);

  const userIds = await prisma.membership.findMany({
    where: { companyId: { in: companyIds }, deletedAt: null },
    select: { userId: true },
    distinct: ['userId'],
  });

  return {
    companies,
    users: userIds.length,
    memberships,
    leads,
    conversations,
    messages,
    followUps,
    events,
    auditLogs,
  };
}
