import { INestApplication } from '@nestjs/common';
import { FollowUpStatus } from '@prisma/client';
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

describe('Outbound First Touch V1.3 (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let companyId: string;
  let ownerId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    token = await authAsOwner(app);
    const prisma = app.get(PrismaService);
    const company = await prisma.company.findFirst({
      where: { slug: E2E_COMPANY_SLUG, deletedAt: null },
    });
    companyId = company!.id;
    const owner = await prisma.user.findFirst({
      where: { email: E2E_OWNER_EMAIL, deletedAt: null },
    });
    ownerId = owner!.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('settings OFF → HUMAN_APPROVE → generate → approve', async () => {
    const suffix = String(Date.now()).slice(-6);
    const phone = `551197${suffix}`;

    const settingsRes = await request(app.getHttpServer())
      .get('/api/outbound/first-touch/settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(settingsRes.body).toEqual(
      expect.objectContaining({
        companyId,
        mode: expect.any(String),
      }),
    );

    await request(app.getHttpServer())
      .patch('/api/outbound/first-touch/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        mode: 'HUMAN_APPROVE',
        verticalPlaybook: 'financeira',
        enableKbGrounding: false,
      })
      .expect(200);

    // Create via import commit so metadata.importBatchId is present (V1.2 path).
    const pasteRes = await request(app.getHttpServer())
      .post('/api/outbound/import/batches/paste')
      .set('Authorization', `Bearer ${token}`)
      .send({
        text: `Nome,Telefone,Produto,Cidade\nFT Ana ${suffix},${phone},consórcio,SP\n`,
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

    const commitRes = await request(app.getHttpServer())
      .post(`/api/outbound/import/batches/${batchId}/commit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(commitRes.body.report.created).toBeGreaterThanOrEqual(1);

    const leadsRes = await request(app.getHttpServer())
      .get('/api/leads')
      .query({ search: phone.slice(-8), limit: 50 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const lead = (
      leadsRes.body.data as Array<{ id: string; phone: string }>
    ).find((l) => l.phone === phone || l.phone.endsWith(phone.slice(-8)));
    expect(lead?.id).toBeTruthy();

    const offRes = await request(app.getHttpServer())
      .patch('/api/outbound/first-touch/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'OFF' })
      .expect(200);
    expect(offRes.body.mode).toBe('OFF');

    await request(app.getHttpServer())
      .post('/api/outbound/first-touch/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadIds: [lead!.id] })
      .expect(409);

    await request(app.getHttpServer())
      .patch('/api/outbound/first-touch/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'HUMAN_APPROVE' })
      .expect(200);

    const genRes = await request(app.getHttpServer())
      .post('/api/outbound/first-touch/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadIds: [lead!.id], limit: 1 })
      .expect(201);

    expect(genRes.body.created).toBe(1);
    expect(genRes.body.items[0]).toEqual(
      expect.objectContaining({
        leadId: lead!.id,
        status: FollowUpStatus.SUGGESTED,
        mode: 'HUMAN_APPROVE',
      }),
    );
    expect(genRes.body.items[0].body).toMatch(/consórcio|Credi|Ana|Oi/i);
    expect(genRes.body.items[0].conversationId).toBeTruthy();

    const fuId = genRes.body.items[0].id as string;

    const listRes = await request(app.getHttpServer())
      .get('/api/outbound/first-touch/follow-ups')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body.items.some((i: { id: string }) => i.id === fuId)).toBe(
      true,
    );

    const approveRes = await request(app.getHttpServer())
      .post(`/api/outbound/first-touch/follow-ups/${fuId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(approveRes.body.status).toBe(FollowUpStatus.SCHEDULED);

    const dash = await request(app.getHttpServer())
      .get('/api/outbound/first-touch/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(dash.body.metrics.generated).toBeGreaterThanOrEqual(1);
    expect(dash.body.metrics).toEqual(
      expect.objectContaining({
        eligible: expect.any(Number),
        sent: expect.any(Number),
        replyRate: expect.any(Number),
      }),
    );

    // Cleanup soft-ish: leave data for inspection; ensure owner exists
    expect(ownerId).toBeTruthy();
  });
});
