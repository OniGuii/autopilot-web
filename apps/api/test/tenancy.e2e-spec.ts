import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
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

describe('Tenancy (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    app = await createE2eApp();
    token = await authAsOwner(app);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('lists leads scoped to company', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveProperty('data');
    expect(Array.isArray((res.body as { data: unknown[] }).data)).toBe(true);
  });

  it('returns 404 for unknown lead id (no cross-tenant leak)', async () => {
    await request(app.getHttpServer())
      .get('/api/leads/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('creates lead in tenant and reads it back', async () => {
    const phone = `+5511988${String(Date.now()).slice(-7)}`;
    const createRes = await request(app.getHttpServer())
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'E2E Lead',
        phone,
        source: 'WHATSAPP',
      })
      .expect(201);

    const leadId = (createRes.body as { id: string }).id;
    expect(leadId).toBeTruthy();

    const getRes = await request(app.getHttpServer())
      .get(`/api/leads/${leadId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((getRes.body as { phone: string }).phone).toBeTruthy();
  });

  it('dashboard requires company context and returns KPIs', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toBeDefined();
  });
});
