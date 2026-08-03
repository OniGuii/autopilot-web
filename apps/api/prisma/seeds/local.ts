import { MembershipRole } from '@prisma/client';
import { prisma } from './shared/client';
import { LOCAL } from './shared/constants';
import {
  countCompanyTree,
  ensureConversationWithMessages,
  ensureFollowUps,
  ensureSeedAuditLog,
  ensureSeedEvent,
  fakeLeadName,
  fakePhone,
  statusForIndex,
  upsertCompany,
  upsertMembership,
  upsertLead,
  upsertUser,
  SeedCounts,
} from './shared/factories';

export async function seedLocal(): Promise<SeedCounts> {
  const company = await upsertCompany(prisma, {
    slug: LOCAL.companySlug,
    name: LOCAL.companyName,
    profile: 'local',
  });

  const users = [];
  for (const u of LOCAL.users) {
    const user = await upsertUser(prisma, { email: u.email, name: u.name });
    users.push({ user, role: u.role });
  }

  const owner = users.find((u) => u.role === 'OWNER')!.user;

  for (const entry of users) {
    await upsertMembership(prisma, {
      companyId: company.id,
      userId: entry.user.id,
      role: entry.role as MembershipRole,
      invitedBy: owner.id,
    });
  }

  const agent = users.find((u) => u.role === 'AGENT')!.user;

  for (let i = 1; i <= LOCAL.leadCount; i++) {
    const status = statusForIndex(i - 1);
    const lead = await upsertLead(prisma, {
      companyId: company.id,
      ownerId: agent.id,
      phone: fakePhone(LOCAL.phonePrefix, i),
      name: fakeLeadName(i, 'Local'),
      status,
      score: (i * 7) % 101,
      profile: 'local',
      key: `local-${i}`,
    });

    // Conversations/messages for non-NEW leads
    if (status !== 'NEW') {
      const conversation = await ensureConversationWithMessages(prisma, {
        companyId: company.id,
        leadId: lead.id,
        assignedUserId: agent.id,
        profile: 'local',
        key: `local-${i}`,
        messageCount: status === 'CONTACTED' ? 2 : 4,
      });

      if (['CONTACTED', 'RESPONDED', 'QUALIFIED'].includes(status)) {
        await ensureFollowUps(prisma, {
          companyId: company.id,
          leadId: lead.id,
          conversationId: conversation.id,
          assignedUserId: agent.id,
          approvedBy: owner.id,
          profile: 'local',
          key: `local-${i}`,
        });
      }

      await ensureSeedEvent(prisma, {
        companyId: company.id,
        type: 'lead.seeded',
        aggregateType: 'lead',
        aggregateId: lead.id,
        actorUserId: owner.id,
        profile: 'local',
        key: `local-${i}`,
      });
    }
  }

  await ensureSeedAuditLog(prisma, {
    companyId: company.id,
    actorUserId: owner.id,
    action: 'seed.local.completed',
    targetType: 'company',
    targetId: company.id,
    profile: 'local',
    key: 'local-run',
  });

  return countCompanyTree(prisma, [company.id]);
}
