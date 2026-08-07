import { INestApplication } from '@nestjs/common';
import { AiAgentMode, AiIntent, KnowledgeBaseKind } from '@prisma/client';
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

describe('AI Sales Agent 11C (e2e)', () => {
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

  it('default settings remain ASSIST (autoEnabled=false)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ai/settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.mode).toBe(AiAgentMode.ASSIST);
    expect(res.body.autoEnabled).toBe(false);
  });

  it('AUTO opt-in flips autoEnabled=true', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/ai/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: AiAgentMode.AUTO })
      .expect(200);

    expect(res.body.mode).toBe(AiAgentMode.AUTO);
    expect(res.body.autoEnabled).toBe(true);

    // restore ASSIST default for other suites / tenants
    await request(app.getHttpServer())
      .patch('/api/ai/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: AiAgentMode.ASSIST })
      .expect(200);
  });

  it('classifies HOURS and ADDRESS intents', async () => {
    const hours = await request(app.getHttpServer())
      .post('/api/ai/classify')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'qual o horário de funcionamento?' })
      .expect(200);
    expect(hours.body.intent).toBe(AiIntent.HOURS);

    const address = await request(app.getHttpServer())
      .post('/api/ai/classify')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'qual o endereço de vocês?' })
      .expect(200);
    expect(address.body.intent).toBe(AiIntent.ADDRESS);
  });

  it('dashboard returns automation metrics shape', async () => {
    await request(app.getHttpServer())
      .post('/api/knowledge-base')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: KnowledgeBaseKind.HOURS,
        title: `Horário e2e ${Date.now()}`,
        body: 'Seg a Sex 9h–18h',
        tags: ['horario'],
        active: true,
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/ai/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        companyId,
        mode: expect.any(String),
        autoEnabled: expect.any(Boolean),
        metrics: expect.objectContaining({
          autoReplied: expect.any(Number),
          escalatedToHuman: expect.any(Number),
          kbEntriesActive: expect.any(Number),
          pausedConversations: expect.any(Number),
        }),
      }),
    );
    expect(res.body.metrics.kbEntriesActive).toBeGreaterThanOrEqual(1);
  });

  it('COMPLAINT always escalates (never auto-safe)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/classify')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'péssimo serviço quero reclamar no procon' })
      .expect(200);

    expect(res.body.intent).toBe(AiIntent.COMPLAINT);
    expect(res.body.escalated).toBe(true);
  });
});
