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

describe('Outbound Protection V1.1 (e2e)', () => {
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

  it('GET protection settings creates defaults (disabled)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/outbound/protection/settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        companyId,
        enabled: expect.any(Boolean),
        dailyProactiveCap: expect.any(Number),
        hourlyProactiveCap: expect.any(Number),
        leadCooldownMinutes: expect.any(Number),
        minSpacingSeconds: expect.any(Number),
        suppressOnKeywords: expect.arrayContaining(['pare', 'stop']),
        autoSuppressOnLost: true,
      }),
    );
  });

  it('PATCH protection settings enables caps', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/outbound/protection/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        enabled: true,
        dailyProactiveCap: 40,
        hourlyProactiveCap: 10,
        leadCooldownMinutes: 90,
        minSpacingSeconds: 45,
        allowedHoursStart: 9,
        allowedHoursEnd: 18,
        suppressOnKeywords: ['pare', 'stop', 'sair'],
      })
      .expect(200);

    expect(res.body.enabled).toBe(true);
    expect(res.body.dailyProactiveCap).toBe(40);
    expect(res.body.hourlyProactiveCap).toBe(10);
    expect(res.body.allowedHoursStart).toBe(9);

    await request(app.getHttpServer())
      .patch('/api/outbound/protection/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(200);
  });

  it('rejects hourlyCap > dailyCap', async () => {
    await request(app.getHttpServer())
      .patch('/api/outbound/protection/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ dailyProactiveCap: 10, hourlyProactiveCap: 20 })
      .expect(400);
  });

  it('GET dashboard returns protection metrics', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/outbound/protection/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        companyId,
        metrics: expect.objectContaining({
          proactiveSentToday: expect.any(Number),
          remainingDaily: expect.any(Number),
          remainingHourly: expect.any(Number),
          suppressActive: expect.any(Number),
          blocksToday: expect.any(Number),
          optOutsWeek: expect.any(Number),
        }),
      }),
    );
  });

  it('POST/GET/DELETE suppress list', async () => {
    const phone = `5511${String(Date.now()).slice(-8)}`;
    const created = await request(app.getHttpServer())
      .post('/api/outbound/protection/suppress')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone, reason: 'e2e suppress' })
      .expect(201)
      .catch(async () =>
        request(app.getHttpServer())
          .post('/api/outbound/protection/suppress')
          .set('Authorization', `Bearer ${token}`)
          .send({ phone, reason: 'e2e suppress' }),
      );

    // Nest default POST may return 200 or 201 depending on decorator.
    expect([200, 201]).toContain(created.status);
    expect(created.body).toEqual(
      expect.objectContaining({
        phone,
        active: true,
        source: 'MANUAL',
      }),
    );

    const list = await request(app.getHttpServer())
      .get('/api/outbound/protection/suppress')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(list.body.items.length).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .delete(`/api/outbound/protection/suppress/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
