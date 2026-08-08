import { INestApplication } from '@nestjs/common';
import { Channel, ConversationStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
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

describe('AI Sales Agent 11E.1 Sales Memory (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let companyId: string;
  let conversationId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    token = await authAsOwner(app);
    const prisma = app.get(PrismaService);
    const company = await prisma.company.findFirst({
      where: { slug: E2E_COMPANY_SLUG, deletedAt: null },
    });
    companyId = company!.id;

    const phone = `+55119${String(Date.now()).slice(-8)}`;
    conversationId = await runWithRlsBypassAsync(async () => {
      const lead = await prisma.lead.create({
        data: {
          companyId,
          phone,
          name: 'Lead Memory E2E',
          source: 'e2e-11e1',
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
      return conv.id;
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET sales-memory returns empty memory for conversation', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/ai/sales-memory/${conversationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        companyId,
        conversationId,
        memory: expect.objectContaining({
          version: 0,
          budget: null,
          productInterest: [],
          purchaseIntentLevel: 'NONE',
        }),
      }),
    );
  });

  it('DELETE clears sales-memory after seed metadata', async () => {
    const salesMemory = app.get(SalesMemoryService);
    await runWithRlsBypassAsync(() =>
      salesMemory.updateMemory({
        companyId,
        conversationId,
        patch: { budget: 'R$ 100', city: 'TestCity' },
        messageId: '00000000-0000-4000-8000-0000000000e1',
      }),
    );

    const before = await request(app.getHttpServer())
      .get(`/api/ai/sales-memory/${conversationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(before.body.memory.city).toBe('TestCity');
    expect(before.body.memory.version).toBeGreaterThanOrEqual(1);

    const res = await request(app.getHttpServer())
      .delete(`/api/ai/sales-memory/${conversationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.budget).toBeNull();
    expect(res.body.city).toBeNull();
    expect(res.body.version).toBeGreaterThan(before.body.memory.version);

    const get = await request(app.getHttpServer())
      .get(`/api/ai/sales-memory/${conversationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(get.body.memory.budget).toBeNull();
  });
});
