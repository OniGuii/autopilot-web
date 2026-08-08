import { INestApplication } from '@nestjs/common';
import { Channel, ConversationStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { ObjectionEngineService } from '../src/modules/ai/objection-engine.service';
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

describe('AI Sales Agent 11E.3 Objection Engine (e2e)', () => {
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
          name: 'Objection E2E',
          source: 'e2e-11e3',
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
              score: 60,
              temperature: 'WARM',
              lastScoreAt: new Date().toISOString(),
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

  it('GET objections dashboard returns top objections', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ai/objections/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        companyId,
        topObjections: expect.any(Array),
        totals: expect.objectContaining({
          PRICE: expect.any(Number),
          TIME: expect.any(Number),
          TRUST: expect.any(Number),
          COMPARISON: expect.any(Number),
          AUTHORITY: expect.any(Number),
          NEED: expect.any(Number),
        }),
        autoAllowedTypes: expect.arrayContaining(['PRICE', 'TIME', 'TRUST']),
      }),
    );
  });

  it('handle persists lastObjection + history (tenant-scoped)', async () => {
    const engine = app.get(ObjectionEngineService);

    await runWithRlsBypassAsync(async () => {
      const result = await engine.handle({
        companyId,
        conversationId,
        leadId,
        messageId: `msg-${Date.now()}`,
        messageBody: 'Tá caro e estou sem dinheiro',
      });
      expect(result.detected).toBe(true);
      expect(result.type).toBe('PRICE');
      expect(result.canAuto).toBe(true);
    });

    const debug = await request(app.getHttpServer())
      .get(`/api/ai/sales-memory/${conversationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(debug.body.memory.lastObjection).toBe('PRICE');
    expect(debug.body.memory.objectionHistory.length).toBeGreaterThanOrEqual(1);
    expect(debug.body.memory.objectionHistory.at(-1).type).toBe('PRICE');
  });

  it('ASSIST path: memory debug stays company-scoped', async () => {
    const salesMemory = app.get(SalesMemoryService);
    await runWithRlsBypassAsync(async () => {
      const mem = await salesMemory.loadMemory(companyId, conversationId);
      expect(mem.lastObjection).toBe('PRICE');
    });
  });
});
