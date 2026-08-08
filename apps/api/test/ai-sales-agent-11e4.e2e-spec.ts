import { INestApplication } from '@nestjs/common';
import { Channel, ConversationStatus, LeadStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { NextBestActionService } from '../src/modules/ai/next-best-action.service';
import { runWithRlsBypassAsync } from '../src/prisma/rls-context';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2eApp,
  E2E_COMPANY_SLUG,
  E2E_OWNER_EMAIL,
  E2E_PASSWORD,
} from './helpers/e2e-app';

async function authAsOwner(app: INestApplication<App>): Promise<string> {
  const loginRes = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: E2E_OWNER_EMAIL, password: E2E_PASSWORD })
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

describe('AI Sales Agent 11E.4 Next Best Action (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let companyId: string;
  let conversationId: string;
  let leadId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    token = await authAsOwner(app);
    const prisma = app.get(PrismaService);
    const company = await prisma.company.findFirst({
      where: { slug: E2E_COMPANY_SLUG, deletedAt: null },
    });
    companyId = company!.id;

    const phone = `+55119${String(Date.now()).slice(-8)}`;
    const created = await runWithRlsBypassAsync(async () => {
      const lead = await prisma.lead.create({
        data: {
          companyId,
          phone,
          name: 'NBA E2E',
          source: 'e2e-11e4',
          status: LeadStatus.RESPONDED,
        },
      });
      const conv = await prisma.conversation.create({
        data: {
          companyId,
          leadId: lead.id,
          channel: Channel.WHATSAPP,
          status: ConversationStatus.OPEN,
          metadata: {
            salesMemory: {
              budget: null,
              productInterest: [],
              city: null,
              urgency: null,
              paymentPreference: null,
              deliveryPreference: null,
              lastObjection: null,
              objectionHistory: [],
              purchaseIntentLevel: 'NONE',
              version: 1,
              updatedAt: new Date().toISOString(),
              sourceMessageIds: [],
              score: 45,
              temperature: 'WARM',
              lastScoreAt: new Date().toISOString(),
              nextBestAction: null,
              lastActionDecisionAt: null,
            },
          },
        },
      });
      return { conversationId: conv.id, leadId: lead.id };
    });
    conversationId = created.conversationId;
    leadId = created.leadId;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET nba dashboard is tenant-scoped', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ai/nba/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        companyId,
        topActions: expect.any(Array),
        conversionsByAction: expect.any(Object),
        temperaturesByAction: expect.any(Object),
      }),
    );
  });

  it('decideAndPersist ASK_BUDGET and expose on conversation endpoint', async () => {
    const nba = app.get(NextBestActionService);
    await runWithRlsBypassAsync(async () => {
      const result = await nba.decideAndPersist({
        companyId,
        conversationId,
        leadId,
      });
      expect(result.action).toBe('ASK_BUDGET');
    });

    const res = await request(app.getHttpServer())
      .get(`/api/ai/nba/conversation/${conversationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.recommended.action).toBe('ASK_BUDGET');
    expect(res.body.persisted.nextBestAction).toBe('ASK_BUDGET');
    expect(res.body.readOnly).toBe(true);
  });

  it('GET nba/lead returns recommendation for workspace', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/ai/nba/lead/${leadId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.leadId).toBe(leadId);
    expect(res.body.conversationId).toBe(conversationId);
    expect(res.body.recommended.action).toBe('ASK_BUDGET');
  });
});
