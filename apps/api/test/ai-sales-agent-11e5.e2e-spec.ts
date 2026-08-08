import { INestApplication } from '@nestjs/common';
import { Channel, ConversationStatus, LeadStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PurchaseIntentService } from '../src/modules/ai/purchase-intent.service';
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

describe('AI Sales Agent 11E.5 Purchase Intent (e2e)', () => {
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
          name: 'Purchase Intent E2E',
          source: 'e2e-11e5',
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
              budget: 'R$ 800',
              productInterest: ['Plano Pro'],
              city: 'Campinas',
              urgency: 'HIGH',
              paymentPreference: 'Pix',
              deliveryPreference: 'Entrega',
              lastObjection: null,
              objectionHistory: [],
              purchaseIntentLevel: 'HIGH',
              version: 1,
              updatedAt: new Date().toISOString(),
              sourceMessageIds: [],
              score: 82,
              temperature: 'HOT',
              lastScoreAt: new Date().toISOString(),
              nextBestAction: 'OFFER_CLOSE',
              lastActionDecisionAt: new Date().toISOString(),
              purchaseIntent: null,
              purchaseIntentScore: 0,
              purchaseIntentUpdatedAt: null,
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

  it('GET purchase-intent dashboard is tenant-scoped', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ai/purchase-intent/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        companyId,
        bands: expect.objectContaining({
          VERY_HIGH: expect.any(Number),
          HIGH: expect.any(Number),
          MEDIUM: expect.any(Number),
          LOW: expect.any(Number),
          VERY_LOW: expect.any(Number),
        }),
        conversionsByBand: expect.any(Object),
        estimatedRevenueByBand: expect.any(Object),
      }),
    );
  });

  it('calculateAndPersist VERY_HIGH and expose on conversation', async () => {
    const svc = app.get(PurchaseIntentService);
    await runWithRlsBypassAsync(async () => {
      const result = await svc.calculateAndPersist({
        companyId,
        conversationId,
        leadId,
      });
      expect(result.purchaseIntent).toBe('VERY_HIGH');
      expect(result.purchaseIntentScore).toBeGreaterThanOrEqual(90);
    });

    const res = await request(app.getHttpServer())
      .get(`/api/ai/purchase-intent/conversation/${conversationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.purchaseIntent).toBe('VERY_HIGH');
    expect(res.body.purchaseIntentScore).toBeGreaterThanOrEqual(90);
    expect(res.body.purchaseIntentUpdatedAt).toBeTruthy();
    expect(res.body.readOnly).toBe(true);
  });

  it('GET purchase-intent/lead for workspace', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/ai/purchase-intent/lead/${leadId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.leadId).toBe(leadId);
    expect(res.body.conversationId).toBe(conversationId);
    expect(res.body.purchaseIntent).toBe('VERY_HIGH');
  });
});
