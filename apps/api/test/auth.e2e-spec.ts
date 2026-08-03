import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  createE2eApp,
  E2E_COMPANY_SLUG,
  E2E_OWNER_EMAIL,
  E2E_PASSWORD,
} from './helpers/e2e-app';

type LoginBody = {
  accessToken: string;
  refreshToken: string;
};

type SelectBody = {
  accessToken: string;
  company: { slug: string };
};

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('login → select-company → /auth/me with company context', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: E2E_OWNER_EMAIL, password: E2E_PASSWORD })
      .expect(200);

    const login = loginRes.body as LoginBody;
    expect(login.accessToken).toBeTruthy();
    expect(login.refreshToken).toBeTruthy();

    const selectRes = await request(app.getHttpServer())
      .post('/api/auth/select-company')
      .set('Authorization', `Bearer ${login.accessToken}`)
      .send({ companySlug: E2E_COMPANY_SLUG })
      .expect(200);

    const selected = selectRes.body as SelectBody;
    expect(selected.accessToken).toBeTruthy();
    expect(selected.company.slug).toBe(E2E_COMPANY_SLUG);

    const meRes = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${selected.accessToken}`)
      .expect(200);

    expect(meRes.body).toMatchObject({
      user: { email: E2E_OWNER_EMAIL },
      company: { slug: E2E_COMPANY_SLUG },
    });
  });

  it('rejects invalid password', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: E2E_OWNER_EMAIL, password: 'WrongPassword1!' })
      .expect(401);
  });

  it('rejects protected route without company context', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: E2E_OWNER_EMAIL, password: E2E_PASSWORD })
      .expect(200);

    const login = loginRes.body as LoginBody;

    await request(app.getHttpServer())
      .get('/api/leads')
      .set('Authorization', `Bearer ${login.accessToken}`)
      .expect(403);
  });
});
