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

describe('AI Sales Agent 11D Recovery (e2e)', () => {
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

  it('GET recovery settings creates defaults (disabled)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ai/recovery/settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        companyId,
        enabled: expect.any(Boolean),
        maxAttempts: expect.any(Number),
        cooldownHours: expect.any(Number),
        stopOnReply: true,
        stopOnHumanTakeover: true,
        cadenceHours: expect.arrayContaining([24, 72, 168]),
        presets: expect.any(Array),
      }),
    );
    expect(res.body.maxAttempts).toBeLessThanOrEqual(3);
  });

  it('PATCH recovery settings enables policy and cadence', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/ai/recovery/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        enabled: true,
        maxAttempts: 3,
        cooldownHours: 24,
        cadenceHours: [24, 72, 168],
        allowedHoursStart: 9,
        allowedHoursEnd: 18,
      })
      .expect(200);

    expect(res.body.enabled).toBe(true);
    expect(res.body.cadenceHours).toEqual([24, 72, 168]);
    expect(res.body.allowedHoursStart).toBe(9);
    expect(res.body.allowedHoursEnd).toBe(18);

    // restore safe default
    await request(app.getHttpServer())
      .patch('/api/ai/recovery/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(200);
  });

  it('GET recovery dashboard returns operational metrics', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ai/recovery/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        companyId,
        metrics: expect.objectContaining({
          leadsInRecovery: expect.any(Number),
          attempts: expect.any(Number),
          recovered: expect.any(Number),
          converted: expect.any(Number),
          stopped: expect.any(Number),
          revenueRecovery: expect.any(Number),
        }),
      }),
    );
  });

  it('rejects non-increasing cadenceHours', async () => {
    await request(app.getHttpServer())
      .patch('/api/ai/recovery/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ cadenceHours: [72, 24, 168] })
      .expect(400);
  });
});
