import { MembershipRole } from '@prisma/client';
import { prisma } from './shared/client';
import { DEMO } from './shared/constants';
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

async function seedCompanyBundle(input: {
  slug: string;
  name: string;
  phonePrefix: string;
  leadCount: number;
  label: string;
  members: Array<{
    email: string;
    name: string;
    role: 'OWNER' | 'ADMIN' | 'AGENT';
  }>;
}) {
  const company = await upsertCompany(prisma, {
    slug: input.slug,
    name: input.name,
    profile: 'demo',
  });

  const users = [];
  for (const m of input.members) {
    const user = await upsertUser(prisma, { email: m.email, name: m.name });
    users.push({ user, role: m.role });
  }

  const owner = users.find((u) => u.role === 'OWNER')!.user;
  const agent =
    users.find((u) => u.role === 'AGENT')?.user ??
    users.find((u) => u.role === 'ADMIN')?.user ??
    owner;

  for (const entry of users) {
    await upsertMembership(prisma, {
      companyId: company.id,
      userId: entry.user.id,
      role: entry.role as MembershipRole,
      invitedBy: owner.id,
    });
  }

  for (let i = 1; i <= input.leadCount; i++) {
    const status = statusForIndex(i - 1);
    const lead = await upsertLead(prisma, {
      companyId: company.id,
      ownerId: agent.id,
      phone: fakePhone(input.phonePrefix, i),
      name: fakeLeadName(i, input.label),
      status,
      score:
        status === 'CONVERTED'
          ? 80 + (i % 21)
          : status === 'LOST'
            ? i % 30
            : 20 + ((i * 11) % 61),
      profile: 'demo',
      key: `${input.slug}-${i}`,
      source: i % 5 === 0 ? 'MANUAL' : 'WHATSAPP',
    });

    const conversation = await ensureConversationWithMessages(prisma, {
      companyId: company.id,
      leadId: lead.id,
      assignedUserId: agent.id,
      profile: 'demo',
      key: `${input.slug}-${i}`,
      messageCount: status === 'NEW' ? 1 : status === 'CONVERTED' ? 8 : 5,
      status: status === 'LOST' ? 'ARCHIVED' : status === 'NEW' ? 'OPEN' : 'OPEN',
    });

    // Follow-ups for recovery narrative
    if (status !== 'LOST') {
      await ensureFollowUps(prisma, {
        companyId: company.id,
        leadId: lead.id,
        conversationId: conversation.id,
        assignedUserId: agent.id,
        approvedBy: owner.id,
        profile: 'demo',
        key: `${input.slug}-${i}`,
      });
    }

    if (i % 10 === 0) {
      await ensureSeedEvent(prisma, {
        companyId: company.id,
        type: 'lead.status_changed',
        aggregateType: 'lead',
        aggregateId: lead.id,
        actorUserId: agent.id,
        profile: 'demo',
        key: `${input.slug}-${i}`,
      });
    }
  }

  await ensureSeedAuditLog(prisma, {
    companyId: company.id,
    actorUserId: owner.id,
    action: 'seed.demo.company.completed',
    targetType: 'company',
    targetId: company.id,
    profile: 'demo',
    key: input.slug,
  });

  return company.id;
}

export async function seedDemo(): Promise<SeedCounts> {
  const dealershipMembers = DEMO.users.filter((u) => u.company === 'dealership');
  const workshopMembers = DEMO.users.filter((u) => u.company === 'workshop');

  const dealershipId = await seedCompanyBundle({
    slug: DEMO.dealership.slug,
    name: DEMO.dealership.name,
    phonePrefix: DEMO.dealershipPhonePrefix,
    leadCount: DEMO.leadCountPerCompany,
    label: 'Concessionaria',
    members: dealershipMembers.map((m) => ({
      email: m.email,
      name: m.name,
      role: m.role,
    })),
  });

  const workshopId = await seedCompanyBundle({
    slug: DEMO.workshop.slug,
    name: DEMO.workshop.name,
    phonePrefix: DEMO.workshopPhonePrefix,
    leadCount: DEMO.leadCountPerCompany,
    label: 'Oficina',
    members: workshopMembers.map((m) => ({
      email: m.email,
      name: m.name,
      role: m.role,
    })),
  });

  return countCompanyTree(prisma, [dealershipId, workshopId]);
}
