import { LeadActivityStatus, LeadActivityType, MembershipRole } from '@prisma/client';
import { prisma } from './shared/client';
import { PILOT } from './shared/constants';
import {
  countCompanyTree,
  ensureAiSuggestionFollowUp,
  ensureConversationWithMessages,
  ensureFollowUps,
  ensureLeadActivity,
  ensureLeadNote,
  ensureSeedAuditLog,
  ensureSeedEvent,
  ensureWhatsAppInstance,
  fakeLeadName,
  fakePhone,
  statusForIndex,
  upsertCompany,
  upsertLead,
  upsertMembership,
  upsertUser,
  type SeedCounts,
} from './shared/factories';

/**
 * Pilot seed — Autopilot Demo with OWNER/ADMIN/AGENT + full CRM/messaging flow.
 * Idempotent. Non-prod only (same guard as other profiles).
 */
export async function seedPilot(): Promise<SeedCounts> {
  const company = await upsertCompany(prisma, {
    slug: PILOT.companySlug,
    name: PILOT.companyName,
    timezone: 'America/Sao_Paulo',
    profile: 'pilot',
  });

  // Align pilot settings fields (schema already has defaults).
  await prisma.company.update({
    where: { id: company.id },
    data: {
      locale: 'pt-BR',
      currency: 'BRL',
      name: PILOT.companyName,
    },
  });

  const users = [];
  for (const u of PILOT.users) {
    const user = await upsertUser(prisma, { email: u.email, name: u.name });
    users.push({ user, role: u.role });
  }

  const owner = users.find((u) => u.role === 'OWNER')!.user;
  const admin = users.find((u) => u.role === 'ADMIN')!.user;
  const agent = users.find((u) => u.role === 'AGENT')!.user;

  for (const entry of users) {
    await upsertMembership(prisma, {
      companyId: company.id,
      userId: entry.user.id,
      role: entry.role as MembershipRole,
      invitedBy: owner.id,
    });
  }

  await ensureWhatsAppInstance(prisma, {
    companyId: company.id,
    instanceKey: PILOT.whatsappInstanceKey,
    webhookSecretPlain: PILOT.whatsappWebhookSecret,
    phoneNumber: PILOT.whatsappPhone,
    evolutionInstanceName: `ap-pilot-${PILOT.companySlug}`,
  });

  for (let i = 1; i <= PILOT.leadCount; i++) {
    const status = statusForIndex(i - 1);
    const ownerForLead = i % 3 === 0 ? admin.id : agent.id;
    const lead = await upsertLead(prisma, {
      companyId: company.id,
      ownerId: ownerForLead,
      phone: fakePhone(PILOT.phonePrefix, i),
      name: fakeLeadName(i, 'Pilot'),
      status,
      score: (i * 11) % 101,
      source: i % 2 === 0 ? 'WHATSAPP' : 'MANUAL',
      profile: 'pilot',
      key: `pilot-${i}`,
    });

    if (status !== 'NEW') {
      const conversation = await ensureConversationWithMessages(prisma, {
        companyId: company.id,
        leadId: lead.id,
        assignedUserId: agent.id,
        profile: 'pilot',
        key: `pilot-${i}`,
        messageCount: status === 'CONTACTED' ? 2 : 5,
      });

      if (['CONTACTED', 'RESPONDED', 'QUALIFIED'].includes(status)) {
        await ensureFollowUps(prisma, {
          companyId: company.id,
          leadId: lead.id,
          conversationId: conversation.id,
          assignedUserId: agent.id,
          approvedBy: owner.id,
          profile: 'pilot',
          key: `pilot-${i}`,
        });
        await ensureAiSuggestionFollowUp(prisma, {
          companyId: company.id,
          leadId: lead.id,
          conversationId: conversation.id,
          assignedUserId: agent.id,
          profile: 'pilot',
          key: `pilot-${i}`,
        });
      }

      await ensureLeadNote(prisma, {
        companyId: company.id,
        leadId: lead.id,
        userId: agent.id,
        body: 'Cliente pediu retorno após horário comercial.',
        profile: 'pilot',
        key: `pilot-note-${i}`,
      });

      await ensureLeadActivity(prisma, {
        companyId: company.id,
        leadId: lead.id,
        userId: agent.id,
        type: i % 2 === 0 ? LeadActivityType.CALL : LeadActivityType.MEETING,
        status:
          status === 'CONVERTED'
            ? LeadActivityStatus.DONE
            : LeadActivityStatus.PLANNED,
        title: 'Follow-up comercial',
        profile: 'pilot',
        key: `pilot-act-${i}`,
      });

      await ensureSeedEvent(prisma, {
        companyId: company.id,
        type: 'lead.seeded',
        aggregateType: 'lead',
        aggregateId: lead.id,
        actorUserId: owner.id,
        profile: 'pilot',
        key: `pilot-${i}`,
      });
    }
  }

  await ensureSeedAuditLog(prisma, {
    companyId: company.id,
    actorUserId: owner.id,
    action: 'seed.pilot.completed',
    targetType: 'company',
    targetId: company.id,
    profile: 'pilot',
    key: 'pilot-run',
  });

  // Re-apply session bypass on pooled connections before aggregate counts.
  await prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', false)`;
  return countCompanyTree(prisma, [company.id]);
}
