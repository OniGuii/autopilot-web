import { INestApplication } from '@nestjs/common';
import { Channel, ConversationStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { LeadScoringService } from '../src/modules/ai/lead-scoring.service';
import { SalesMemoryService } from '../src/modules/ai/sales-memory.service';
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

describe('AI Sales Agent 11E.2 Lead Scoring (e2e)', () => {
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
          name: 'Lead Scoring E2E',
          source: 'e2e-11e2',
        },
      });
      const conv = await prisma.conversation.create({
        data: {
          companyId,
          leadId: lead.id,
          channel: Channel.WHATSAPP,
          status: ConversationStatus.OPEN,
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

  it('GET lead-scoring dashboard returns temperature buckets', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ai/lead-scoring/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        companyId,
        temperatures: expect.objectContaining({
          HOT: expect.any(Number),
          WARM: expect.any(Number),
          COLD: expect.any(Number),
        }),
        conversionsByTemperature: expect.objectContaining({
          HOT: expect.any(Number),
          WARM: expect.any(Number),
          COLD: expect.any(Number),
        }),
        bands: expect.any(Object),
        weights: expect.any(Object),
      }),
    );
  });

  it('updateScore persists temperature into sales memory', async () => {
    const salesMemory = app.get(SalesMemoryService);
    const scoring = app.get(LeadScoringService);

    await runWithRlsBypassAsync(async () => {
      await salesMemory.updateMemory({
        companyId,
        conversationId,
        patch: {
          budget: 'R$ 900',
          city: 'Curitiba',
          paymentPreference: 'Pix',
          productInterest: ['Plano Pro'],
          purchaseIntentLevel: 'HIGH',
          urgency: 'HIGH',
        },
      });
      await scoring.updateScore({
        companyId,
        conversationId,
        leadId,
      });
    });

    const debug = await request(app.getHttpServer())
      .get(`/api/ai/sales-memory/${conversationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(debug.body.memory.score).toBeGreaterThanOrEqual(70);
    expect(debug.body.memory.temperature).toBe('HOT');
    expect(debug.body.memory.lastScoreAt).toBeTruthy();
  });
});
