import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
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

describe('Outbound Campaign MVP V1.4A (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let companyId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    token = await authAsOwner(app);
    const prisma = app.get(PrismaService);
    const company = await prisma.company.findFirst({
      where: { slug: E2E_COMPANY_SLUG, deletedAt: null },
    });
    companyId = company!.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('create → attach import → ready/start → metrics → pause/complete/archive', async () => {
    const suffix = String(Date.now()).slice(-6);
    const phone = `551198${suffix}`;

    const createRes = await request(app.getHttpServer())
      .post('/api/outbound/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Campanha MVP ${suffix}`,
        objective: 'reativar base importada',
        description: 'V1.4A e2e',
      })
      .expect(201);

    expect(createRes.body).toEqual(
      expect.objectContaining({
        companyId,
        name: `Campanha MVP ${suffix}`,
        status: 'DRAFT',
        leadCount: 0,
      }),
    );
    const campaignId = createRes.body.id as string;

    const pasteRes = await request(app.getHttpServer())
      .post('/api/outbound/import/batches/paste')
      .set('Authorization', `Bearer ${token}`)
      .send({
        text: `Nome,Telefone,Produto,Cidade\nCamp Lead ${suffix},${phone},consórcio,SP\n`,
        sourceDefault: 'OUTBOUND_IMPORT',
      })
      .expect(201);
    const batchId = pasteRes.body.id as string;

    await request(app.getHttpServer())
      .patch(`/api/outbound/import/batches/${batchId}/mapping`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        columnMapping: {
          phone: 'Telefone',
          name: 'Nome',
          product: 'Produto',
          city: 'Cidade',
        },
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/outbound/import/batches/${batchId}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/outbound/import/batches/${batchId}/commit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const attachRes = await request(app.getHttpServer())
      .post(`/api/outbound/campaigns/${campaignId}/attach-import`)
      .set('Authorization', `Bearer ${token}`)
      .send({ importBatchId: batchId })
      .expect(201);

    expect(attachRes.body.added).toBeGreaterThanOrEqual(1);
    expect(attachRes.body.leadCount).toBeGreaterThanOrEqual(1);

    const leadsRes = await request(app.getHttpServer())
      .get(`/api/outbound/campaigns/${campaignId}/leads`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(leadsRes.body.total).toBeGreaterThanOrEqual(1);
    const leadId = leadsRes.body.items[0].leadId as string;

    await request(app.getHttpServer())
      .post(`/api/outbound/campaigns/${campaignId}/ready`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const startRes = await request(app.getHttpServer())
      .post(`/api/outbound/campaigns/${campaignId}/start`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(startRes.body.status).toBe('RUNNING');

    await request(app.getHttpServer())
      .patch('/api/outbound/first-touch/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        mode: 'HUMAN_APPROVE',
        verticalPlaybook: 'financeira',
        enableKbGrounding: false,
      })
      .expect(200);

    const genRes = await request(app.getHttpServer())
      .post(`/api/outbound/campaigns/${campaignId}/first-touch/generate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ limit: 5 })
      .expect(201);
    expect(genRes.body.campaignId).toBe(campaignId);
    expect(genRes.body.created).toBeGreaterThanOrEqual(1);

    const detailRes = await request(app.getHttpServer())
      .get(`/api/outbound/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detailRes.body.metrics).toEqual(
      expect.objectContaining({
        totalLeads: expect.any(Number),
        eligible: expect.any(Number),
        firstTouchSent: expect.any(Number),
        responded: expect.any(Number),
        hot: expect.any(Number),
        converted: expect.any(Number),
      }),
    );
    expect(detailRes.body.metrics.totalLeads).toBeGreaterThanOrEqual(1);

    const listRes = await request(app.getHttpServer())
      .get('/api/outbound/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      listRes.body.items.some((c: { id: string }) => c.id === campaignId),
    ).toBe(true);

    const dashRes = await request(app.getHttpServer())
      .get('/api/outbound/campaigns/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(dashRes.body.metrics).toEqual(
      expect.objectContaining({
        campaignsTotal: expect.any(Number),
        totalLeads: expect.any(Number),
        replyRate: expect.any(Number),
      }),
    );

    await request(app.getHttpServer())
      .post(`/api/outbound/campaigns/${campaignId}/pause`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.status).toBe('PAUSED');
      });

    await request(app.getHttpServer())
      .post(`/api/outbound/campaigns/${campaignId}/leads/remove`)
      .set('Authorization', `Bearer ${token}`)
      .send({ leadIds: [leadId] })
      .expect(201)
      .expect((res) => {
        expect(res.body.removed).toBe(1);
      });

    await request(app.getHttpServer())
      .post(`/api/outbound/campaigns/${campaignId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.status).toBe('COMPLETED');
      });

    await request(app.getHttpServer())
      .post(`/api/outbound/campaigns/${campaignId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.status).toBe('ARCHIVED');
      });

    const prisma = app.get(PrismaService);
    const audits = await prisma.auditLog.findMany({
      where: {
        companyId,
        targetId: campaignId,
        action: {
          in: [
            'CAMPAIGN_CREATED',
            'CAMPAIGN_STARTED',
            'CAMPAIGN_PAUSED',
            'CAMPAIGN_COMPLETED',
          ],
        },
      },
      select: { action: true },
    });
    const actions = new Set(audits.map((a) => a.action));
    expect(actions.has('CAMPAIGN_CREATED')).toBe(true);
    expect(actions.has('CAMPAIGN_STARTED')).toBe(true);
    expect(actions.has('CAMPAIGN_PAUSED')).toBe(true);
    expect(actions.has('CAMPAIGN_COMPLETED')).toBe(true);
  });
});
