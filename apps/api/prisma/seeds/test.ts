import { MembershipRole } from '@prisma/client';
import { prisma } from './shared/client';
import { TEST } from './shared/constants';
import {
  countCompanyTree,
  ensureConversationWithMessages,
  upsertCompany,
  upsertMembership,
  upsertLead,
  upsertUser,
  SeedCounts,
} from './shared/factories';

/**
 * Minimal factories for automated tests / CI.
 * Creates the smallest coherent graph: Company → User/Membership → Lead → Conversation/Message.
 */
export async function createMinimalFixture() {
  const company = await upsertCompany(prisma, {
    slug: TEST.companySlug,
    name: TEST.companyName,
    profile: 'test',
  });

  const owner = await upsertUser(prisma, {
    email: TEST.ownerEmail,
    name: TEST.ownerName,
  });

  await upsertMembership(prisma, {
    companyId: company.id,
    userId: owner.id,
    role: MembershipRole.OWNER,
    invitedBy: owner.id,
  });

  const lead = await upsertLead(prisma, {
    companyId: company.id,
    ownerId: owner.id,
    phone: TEST.leadPhone,
    name: 'Lead Test Fixture',
    status: 'NEW',
    score: 0,
    profile: 'test',
    key: 'test-1',
  });

  const conversation = await ensureConversationWithMessages(prisma, {
    companyId: company.id,
    leadId: lead.id,
    assignedUserId: owner.id,
    profile: 'test',
    key: 'test-1',
    messageCount: 2,
  });

  return { company, owner, lead, conversation };
}

export async function seedTest(): Promise<SeedCounts> {
  const fixture = await createMinimalFixture();
  return countCompanyTree(prisma, [fixture.company.id]);
}

/** Named exports for Jest/e2e factories (import from this module). */
export const testFactories = {
  createMinimalFixture,
  upsertCompany,
  upsertUser,
  upsertMembership,
  upsertLead,
};
