import { INestApplication } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { upsertMembership, upsertUser } from '../prisma/seeds/shared/factories';
import {
  createE2eApp,
  E2E_COMPANY_SLUG,
  E2E_OWNER_EMAIL,
  E2E_PASSWORD,
} from './helpers/e2e-app';

async function authAs(
  app: INestApplication<App>,
  email: string,
  password = E2E_PASSWORD,
): Promise<string> {
  const loginRes = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);

  const selectRes = await request(app.getHttpServer())
    .post('/api/auth/select-company')
    .set(
      'Authorization',
      `Bearer ${(loginRes.body as { accessToken: string }).accessToken}`,
    )
    .send({ companySlug: E2E_COMPANY_SLUG })
    .expect(200);

  return (selectRes.body as { accessToken: string }).accessToken;
}

describe('CRM Operations (e2e)', () => {
  let app: INestApplication<App>;
  let ownerToken: string;
  let agentToken: string | null = null;
  let ownerId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    ownerToken = await authAs(app, E2E_OWNER_EMAIL);

    const prisma = app.get(PrismaService);
    const owner = await prisma.user.findUnique({
      where: { email: E2E_OWNER_EMAIL },
    });
    ownerId = owner!.id;

    const company = await prisma.company.findFirst({
      where: { slug: E2E_COMPANY_SLUG, deletedAt: null },
    });

    if (company) {
      const agentEmail = 'agent@test.autopilot.dev';
      const agent = await upsertUser(prisma, {
        email: agentEmail,
        name: 'Agent Test',
      });
      await upsertMembership(prisma, {
        companyId: company.id,
        userId: agent.id,
        role: MembershipRole.AGENT,
        invitedBy: ownerId,
      });
      agentToken = await authAs(app, agentEmail);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('OWNER: note → activity → timeline → pipeline → bulk-assign', async () => {
    const phone = `+5511977${String(Date.now()).slice(-7)}`;
    const createLead = await request(app.getHttpServer())
      .post('/api/leads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'CRM Ops Lead', phone, source: 'WHATSAPP' })
      .expect(201);

    const leadId = (createLead.body as { id: string }).id;

    const noteRes = await request(app.getHttpServer())
      .post(`/api/leads/${leadId}/notes`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ body: 'E2E CRM note' })
      .expect(201);
    expect((noteRes.body as { body: string }).body).toBe('E2E CRM note');

    const activityRes = await request(app.getHttpServer())
      .post(`/api/leads/${leadId}/activities`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type: 'CALL', title: 'E2E call' })
      .expect(201);
    expect((activityRes.body as { status: string }).status).toBe('PLANNED');

    const timelineRes = await request(app.getHttpServer())
      .get(`/api/leads/${leadId}/timeline`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const timeline = timelineRes.body as {
      items: Array<{ itemType: string }>;
      meta: { page: number; limit: number; total: number };
    };
    expect(timeline.meta.page).toBe(1);
    expect(timeline.meta.limit).toBe(50);
    expect(timeline.meta.total).toBeGreaterThanOrEqual(1);
    expect(timeline.items.some((i) => i.itemType === 'LEAD_CREATED')).toBe(
      true,
    );
    expect(timeline.items.some((i) => i.itemType === 'NOTE')).toBe(true);
    expect(timeline.items.some((i) => i.itemType === 'ACTIVITY')).toBe(true);

    const pipelineRes = await request(app.getHttpServer())
      .get('/api/pipeline')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(pipelineRes.body).toMatchObject({
      companyId: expect.any(String),
      leadsByStage: expect.any(Object),
      leadsWithoutContact: expect.any(Number),
      leadsUnassigned: expect.any(Number),
    });

    // Fresh token: parallel auth e2e may call logout-all on the shared owner.
    ownerToken = await authAs(app, E2E_OWNER_EMAIL);

    const bulkRes = await request(app.getHttpServer())
      .post('/api/leads/bulk-assign')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ownerId, leadIds: [leadId] })
      .expect(200);

    expect(bulkRes.body).toMatchObject({
      ownerId,
      requested: 1,
      updated: 1,
      ignored: 0,
    });
  });

  it('AGENT gets 403 on bulk-assign', async () => {
    if (!agentToken) {
      // Fixture without agent membership — skip gracefully
      return;
    }

    await request(app.getHttpServer())
      .post('/api/leads/bulk-assign')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        ownerId: null,
        leadIds: ['00000000-0000-4000-8000-000000000001'],
      })
      .expect(403);
  });
});
