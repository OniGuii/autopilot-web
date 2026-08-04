import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  E2E_COMPANY_SLUG,
  E2E_OWNER_EMAIL,
  E2E_PASSWORD,
} from './e2e-app';

export async function authAs(
  app: INestApplication<App>,
  email = E2E_OWNER_EMAIL,
  password = E2E_PASSWORD,
  companySlug = E2E_COMPANY_SLUG,
): Promise<string> {
  const loginRes = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);

  const selectRes = await request(app.getHttpServer())
    .post('/api/auth/select-company')
    .set(
      'Authorization',
      `Bearer ${(loginRes.body as { accessToken: string }).accessToken}`,
    )
    .send({ companySlug })
    .expect(200);

  return (selectRes.body as { accessToken: string }).accessToken;
}
