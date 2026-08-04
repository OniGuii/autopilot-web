import { INestApplication } from '@nestjs/common';
import { MembershipRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  upsertMembership,
  upsertUser,
} from '../prisma/seeds/shared/factories';
import {
  createE2eApp,
  E2E_COMPANY_SLUG,
  E2E_OWNER_EMAIL,
  E2E_PASSWORD,
} from './helpers/e2e-app';

async function authAs(
  app: INestApplication<App>,
  email: string,
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

describe('Pilot Enablement (e2e)', () => {
  let app: INestApplication<App>;
  let ownerToken: string;
  let agentToken: string;
  let prisma: PrismaService;
  let ownerId: string;
  let companyId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    ownerToken = await authAs(app, E2E_OWNER_EMAIL);

    const owner = await prisma.user.findUnique({
      where: { email: E2E_OWNER_EMAIL },
    });
    ownerId = owner!.id;

    const company = await prisma.company.findFirst({
      where: { slug: E2E_COMPANY_SLUG, deletedAt: null },
    });
    companyId = company!.id;

    const agentEmail = 'pilot-agent@test.autopilot.dev';
    const agent = await upsertUser(prisma as never, {
      email: agentEmail,
      name: 'Pilot Agent',
    });
    await upsertMembership(prisma as never, {
      companyId,
      userId: agent.id,
      role: MembershipRole.AGENT,
      invitedBy: ownerId,
    });
    agentToken = await authAs(app, agentEmail);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('OWNER: settings → invite membership → diagnostics full → audit → export', async () => {
    const settingsRes = await request(app.getHttpServer())
      .patch('/api/settings/company')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        locale: 'pt-BR',
        currency: 'BRL',
        timezone: 'America/Sao_Paulo',
      })
      .expect(200);

    expect(settingsRes.body).toMatchObject({
      currency: 'BRL',
      locale: 'pt-BR',
    });

    const getSettings = await request(app.getHttpServer())
      .get('/api/settings/company')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(getSettings.body.currency).toBe('BRL');

    const inviteEmail = `invited-${Date.now()}@test.autopilot.dev`;
    const inviteRes = await request(app.getHttpServer())
      .post('/api/memberships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: inviteEmail,
        name: 'Invited Pilot',
        role: 'AGENT',
      })
      .expect(201);

    expect(inviteRes.body.status).toBe('INVITED');
    expect(inviteRes.body.invite.status).toBe('PENDING_INVITE');
    expect(inviteRes.body.temporaryPassword).toBeUndefined();

    const listRes = await request(app.getHttpServer())
      .get('/api/memberships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(Array.isArray(listRes.body.data)).toBe(true);

    const diag = await request(app.getHttpServer())
      .get('/api/ops/diagnostics')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(diag.body.scope).toBe('full');
    expect(diag.body.checks.postgres).toBeDefined();
    expect(diag.body.checks.openai).toBeDefined();
    expect(diag.body.checks.workers).toBeDefined();

    const audit = await request(app.getHttpServer())
      .get('/api/ops/audit')
      .query({ entity: 'COMPANY', actionPrefix: 'COMPANY_' })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(audit.body.meta).toBeDefined();

    const alias = await request(app.getHttpServer())
      .get('/api/audit')
      .query({ userId: ownerId })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(alias.body.data).toBeDefined();

    const exportRes = await request(app.getHttpServer())
      .get('/api/exports/leads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(exportRes.headers['content-type']).toMatch(/text\/csv/);
    expect(exportRes.text).toContain('id,name,phone');

    const setupStatus = await request(app.getHttpServer())
      .get('/api/setup/status')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(setupStatus.body.steps.find((s: { key: string }) => s.key === 'company').done).toBe(
      true,
    );

    const secondCompany = await request(app.getHttpServer())
      .post('/api/setup/company')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Should Fail Co', slug: `fail-${Date.now()}` })
      .expect(409);
    const limitCode =
      (secondCompany.body as { code?: string }).code ??
      (secondCompany.body as { message?: { code?: string } }).message?.code;
    expect(limitCode).toBe('SETUP_COMPANY_LIMIT');
  });

  it('AGENT: limited diagnostics; forbidden export/settings patch', async () => {
    const diag = await request(app.getHttpServer())
      .get('/api/ops/diagnostics')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    expect(diag.body.scope).toBe('limited');
    expect(diag.body.checks.openai).toBeUndefined();
    expect(diag.body.checks.workers).toBeUndefined();
    expect(diag.body.checks.postgres).toBeDefined();
    expect(diag.body.checks.whatsapp).toBeDefined();

    await request(app.getHttpServer())
      .get('/api/exports/leads')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch('/api/settings/company')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ name: 'Nope' })
      .expect(403);
  });

  it('setup wizard creates first company for user without memberships', async () => {
    const email = `setup-user-${Date.now()}@test.autopilot.dev`;
    const passwordHash = await argon2.hash(E2E_PASSWORD);
    await prisma.user.create({
      data: {
        email,
        name: 'Setup User',
        status: UserStatus.ACTIVE,
        passwordHash,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: E2E_PASSWORD })
      .expect(200);

    const token = (loginRes.body as { accessToken: string }).accessToken;
    const slug = `pilot-${Date.now()}`;

    const created = await request(app.getHttpServer())
      .post('/api/setup/company')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Pilot New Co', slug, locale: 'pt-BR' })
      .expect(201);

    expect(created.body.company.slug).toBe(slug);
    expect(created.body.membership.role).toBe('OWNER');
    expect(created.body.membership.status).toBe('ACTIVE');
  });
});
